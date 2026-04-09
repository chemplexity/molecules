/** @module network/ReactionNetwork */

import { MoleculeNode } from './MoleculeNode.js';
import { ReactionNode } from './ReactionNode.js';
import { toCanonicalSMILES, parseSMILES } from '../io/index.js';
import { applySMIRKS } from '../smirks/index.js';
import { findSMARTS } from '../smarts/index.js';
import { renderMolSVG } from '../layout/render2d.js';
import { computeFormulaDelta } from '../descriptors/molecular.js';
import { Molecule } from '../core/Molecule.js';

export class ReactionNetwork {
  constructor() {
    /** @type {Map<string, MoleculeNode>} */
    this.moleculeNodes = new Map();
    
    /** @type {Map<string, ReactionNode>} */
    this.reactionNodes = new Map();
    /** @type {Map<string, string>} map of Canonical SMILES -> NodeID */
    this._smilesIndex = new Map();
    
    this._listeners = new Map();

    this._moleculeCounter = 0;
    this._reactionCounter = 0;
  }

  /**
   * Subscribe to graph mutation events.
   * @param {string} event - 'moleculeAdded', 'nodeAdded', 'reactionAdded', 'linkAdded', etc.
   * @param {Function} callback - Callback function.
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
  }

  /** @private */
  _emit(event, data) {
    const cbs = this._listeners.get(event);
    if (cbs) {
      for (const cb of cbs) {
        cb(data);
      }
    }
  }

  /**
   * Checks if the molecule is already registered.
   * @param {Molecule} molecule 
   * @returns {boolean}
   */
  hasMolecule(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    return this._smilesIndex.has(smiles);
  }

  /**
   * Adds a molecule to the network. Identical molecules merge into the same node.
   * @param {Molecule} molecule - The molecule to add.
   * @returns {MoleculeNode} The created or retrieved node.
   */
  addMolecule(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    if (this._smilesIndex.has(smiles)) {
      const existingNode = this.moleculeNodes.get(this._smilesIndex.get(smiles));
      this._emit('moleculeMerged', existingNode);
      return existingNode;
    }

    const id = `mol_${this._moleculeCounter++}`;
    const clone = molecule.clone();
    
    const node = new MoleculeNode(id, clone);
    this.moleculeNodes.set(id, node);
    this._smilesIndex.set(smiles, id);

    this._emit('moleculeAdded', clone);
    this._emit('nodeAdded', node);

    return node;
  }

  /**
   * Registers a multi-reactant, multi-product reaction.
   * @param {Molecule[]} reactants - Reactants.
   * @param {Molecule[]} products - Products.
   * @param {Object} [conditions={}] - Standardized metadata. Minimum {}
   * @param {boolean} [reversible=false]
   * @returns {ReactionNode}
   */
  addReaction(reactants, products, conditions = {}, reversible = false) {
    const rNodes = reactants.map(m => this.addMolecule(m));
    const pNodes = products.map(m => this.addMolecule(m));

    const id = `rxn_${this._reactionCounter++}`;
    const rxnNode = new ReactionNode(id, rNodes.map(n => n.id), pNodes.map(n => n.id), conditions, reversible);

    this.reactionNodes.set(id, rxnNode);

    for (const r of rNodes) {
      if (!r.consumedIn.includes(id)) r.consumedIn.push(id);
    }
    for (const p of pNodes) {
      if (!p.producedBy.includes(id)) p.producedBy.push(id);
    }

    this._emit('reactionAdded', rxnNode);

    for (const reactNode of rNodes) {
      for (const prodNode of pNodes) {
        const delta = computeFormulaDelta(reactNode.molecule, prodNode.molecule);
        this._emit('linkAdded', {
          source: reactNode.id,
          target: prodNode.id,
          reactionId: id,
          conditions: { ...conditions },
          delta
        });
      }
    }

    return rxnNode;
  }

  /** @private */
  _splitDisconnectedComponents(fullGraph) {
      if (fullGraph.atoms.size <= 1) return [fullGraph];
      
      const visited = new Set();
      const componentAtomSets = [];
      
      // BFS to find all disconnected component atom sets
      for (const atomId of fullGraph.atoms.keys()) {
          if (visited.has(atomId)) continue;
          
          const compAtomIds = new Set();
          const q = [atomId];
          visited.add(atomId);
          compAtomIds.add(atomId);
          
          while (q.length > 0) {
              const curr = q.shift();
              for (const bondId of fullGraph.atoms.get(curr).bonds) {
                  const bond = fullGraph.bonds.get(bondId);
                  if (!bond) continue;
                  const neighbor = bond.getOtherAtom(curr);
                  if (!visited.has(neighbor)) {
                      visited.add(neighbor);
                      compAtomIds.add(neighbor);
                      q.push(neighbor);
                  }
              }
          }
          
          componentAtomSets.push(compAtomIds);
      }
      
      // Single connected component — return as-is
      if (componentAtomSets.length === 1) return [fullGraph];
      
      // For each component: clone the full graph and remove all atoms outside this component.
      // Using clone() + removeAtom() ensures _bondIndex and all internal state stays valid.
      return componentAtomSets.map(compAtomIds => {
          const subMol = fullGraph.clone();
          for (const atomId of [...subMol.atoms.keys()]) {
              if (!compAtomIds.has(atomId)) {
                  subMol.removeAtom(atomId);
              }
          }
          return subMol;
      });
  }

  /**
   * Connects molecules representing a common reaction template, expanding the graph dynamically.
   * Supports bimolecular templates by accepting arrays of reactants.
   * @param {Molecule[]} reactants 
   * @param {string} smirks_template 
   * @param {Object} [baseConditions={}] 
   * @returns {ReactionNode[]} The executed and added reactions.
   */
  executeReactionTemplate(reactants, smirks_template, baseConditions = {}) {
    if (reactants.length === 0) return [];

    // The SMIRKS engine theoretically operates on one disconnected molecular graph for bimolecular reactions.
    // Assuming 'applySMIRKS', we merge the multiple reactants into one graph for applying if applicable.
    // However, applySMIRKS generally accepts a single parent Molecule.
    let reactantParent = reactants[0].clone();
    for (let i = 1; i < reactants.length; i++) {
        // Just merge components
        const rClone = reactants[i].clone();
        for (const [aId, a] of rClone.atoms) {
            reactantParent.atoms.set(`tmp_${i}_${aId}`, a);
        }
        for (const [bId, b] of rClone.bonds) {
            reactantParent.bonds.set(`tmp_${i}_${bId}`, b);
        }
    }
    
    // Attempt transform
    const reactantSmarts = smirks_template.split('>>')[0].trim();
    const mappings = [...findSMARTS(reactantParent, reactantSmarts)];

    const uniqueProducts = new Map();

    for (const mapping of mappings) {
        const fullProdGraph = applySMIRKS(reactantParent, smirks_template, { mapping });
        if (!fullProdGraph) continue;
        
        fullProdGraph.resetIds();
        
        const rawComponents = this._splitDisconnectedComponents(fullProdGraph);

        // Round-trip each component through canonical SMILES + re-parse to guarantee
        // a pristine, deterministic molecule state. Fall back to raw if round-trip fails.
        const separatedComponents = rawComponents.map(c => {
            try {
                const canon = toCanonicalSMILES(c);
                if (!canon) return c;
                return parseSMILES(canon);
            } catch {
                return c;
            }
        });

        const sortedCanons = separatedComponents.map(c => toCanonicalSMILES(c)).sort();
        const macroKey = sortedCanons.join(' + ');

        if (!uniqueProducts.has(macroKey)) {
            uniqueProducts.set(macroKey, separatedComponents);
        }
    }
    
    const createdNodes = [];
    for (const componentArray of uniqueProducts.values()) {
        const rxn = this.addReaction(
            reactants, 
            componentArray, 
            { ...baseConditions, smirks_template }
        );
        createdNodes.push(rxn);
    }
    return createdNodes;
  }

  /**
   * Retrieves adjacent ReactionNodes consuming a molecule.
   * @param {Molecule} molecule 
   * @returns {ReactionNode[]}
   */
  getReactionsConsuming(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    const nodeId = this._smilesIndex.get(smiles);
    if (!nodeId) return [];
    return this.moleculeNodes.get(nodeId).consumedIn.map(rid => this.reactionNodes.get(rid));
  }

  /**
   * Retrieves adjacent ReactionNodes producing a molecule.
   * @param {Molecule} molecule 
   * @returns {ReactionNode[]}
   */
  getReactionsProducing(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    const nodeId = this._smilesIndex.get(smiles);
    if (!nodeId) return [];
    return this.moleculeNodes.get(nodeId).producedBy.map(rid => this.reactionNodes.get(rid));
  }

  /**
   * Unlinks a molecule and enforces cascade delete if reactions drop to 0 participants.
   * @param {Molecule} molecule 
   */
  removeMolecule(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    const nodeId = this._smilesIndex.get(smiles);
    if (!nodeId) return;

    const node = this.moleculeNodes.get(nodeId);
    
    // Unlink from reactions
    for (const rid of node.consumedIn) {
      const rxn = this.reactionNodes.get(rid);
      if (rxn) {
        rxn.reactants = rxn.reactants.filter(id => id !== nodeId);
        if (rxn.reactants.length === 0 || rxn.products.length === 0) {
          this.removeReaction(rid);
        }
      }
    }
    
    for (const rid of node.producedBy) {
      const rxn = this.reactionNodes.get(rid);
      if (rxn) {
        rxn.products = rxn.products.filter(id => id !== nodeId);
        if (rxn.reactants.length === 0 || rxn.products.length === 0) {
          this.removeReaction(rid);
        }
      }
    }

    this.moleculeNodes.delete(nodeId);
    this._smilesIndex.delete(smiles);

    this._emit('moleculeRemoved', node.molecule);
    this._emit('nodeRemoved', node);
  }

  /**
   * Removes a reaction cleanly.
   * @param {string} reactionId 
   */
  removeReaction(reactionId) {
    const rxn = this.reactionNodes.get(reactionId);
    if (!rxn) return;

    // Unlink from molecules
    for (const rid of rxn.reactants) {
      const mn = this.moleculeNodes.get(rid);
      if (mn) mn.consumedIn = mn.consumedIn.filter(id => id !== reactionId);
    }
    for (const pid of rxn.products) {
      const mn = this.moleculeNodes.get(pid);
      if (mn) mn.producedBy = mn.producedBy.filter(id => id !== reactionId);
    }

    this.reactionNodes.delete(reactionId);
    this._emit('reactionRemoved', rxn);
  }

  /**
   * Uses BFS to find the shortest reaction path between two molecules.
   * @param {Molecule} startMolecule 
   * @param {Molecule} targetMolecule 
   * @returns {Array<MoleculeNode|ReactionNode>} An alternating pathway array. Returns empty if not found.
   */
  findShortestPathway(startMolecule, targetMolecule) {
    const startSmiles = toCanonicalSMILES(startMolecule);
    const targetSmiles = toCanonicalSMILES(targetMolecule);
    
    const startId = this._smilesIndex.get(startSmiles);
    const targetId = this._smilesIndex.get(targetSmiles);

    if (!startId || !targetId) return [];
    if (startId === targetId) return [this.moleculeNodes.get(startId)];

    const q = [[startId]];
    const visited = new Set([startId]);

    while (q.length > 0) {
      const path = q.shift();
      const currentId = path[path.length - 1];

      // Assuming current is always a Molecule for the jump logic
      const molNode = this.moleculeNodes.get(currentId);
      
      for (const rxnId of molNode.consumedIn) {
        const rxnNode = this.reactionNodes.get(rxnId);
        
        for (const pdId of rxnNode.products) {
          if (!visited.has(pdId)) {
            visited.add(pdId);
            const newPath = [...path, rxnId, pdId];
            if (pdId === targetId) {
                // translate IDs to objects
                return newPath.map(id => this.moleculeNodes.get(id) || this.reactionNodes.get(id));
            }
            q.push(newPath);
          }
        }
      }
    }
    
    return [];
  }

  /**
   * Traces backward from a product to identify synthesis pathways.
   * @param {Molecule} targetMolecule 
   * @param {number} maxDepth 
   * @returns {Array<Array<MoleculeNode|ReactionNode>>} Array of paths found
   */
  findSynthesisRoutes(targetMolecule, maxDepth = 3) {
    const targetSmiles = toCanonicalSMILES(targetMolecule);
    const targetId = this._smilesIndex.get(targetSmiles);
    if (!targetId) return [];

    const routes = [];
    const dfs = (currentId, path, depth) => {
      if (depth > maxDepth) return;
      if (path.length > 1 && path[path.length - 1] !== targetId) {
        // Translating path
        routes.push(path.map(id => this.moleculeNodes.get(id) || this.reactionNodes.get(id)));
      }

      const molNode = this.moleculeNodes.get(currentId);
      for (const rxnId of molNode.producedBy) {
        const rxnNode = this.reactionNodes.get(rxnId);
        for (const rtId of rxnNode.reactants) {
          if (!path.includes(rtId)) { // strict acyclic trace
             dfs(rtId, [rtId, rxnId, ...path], depth + 1);
          }
        }
      }
    };

    dfs(targetId, [targetId], 0);
    return routes;
  }

  /**
   * Enumerates reachable downstream nodes
   * @param {Molecule} startMolecule 
   * @param {number} maxDepth 
   */
  findReachable(startMolecule, maxDepth = 3) {
    const startSmiles = toCanonicalSMILES(startMolecule);
    const startId = this._smilesIndex.get(startSmiles);
    if (!startId) return [];

    const reachable = new Set();
    const dfs = (currentId, depth) => {
      if (depth > maxDepth) return;
      reachable.add(currentId);
      const molNode = this.moleculeNodes.get(currentId);
      for (const rxnId of molNode.consumedIn) {
        reachable.add(rxnId);
        const rxnNode = this.reactionNodes.get(rxnId);
        for (const pdId of rxnNode.products) {
          if (!reachable.has(pdId)) dfs(pdId, depth + 1);
        }
      }
    };
    dfs(startId, 0);
    return Array.from(reachable).map(id => this.moleculeNodes.get(id) || this.reactionNodes.get(id));
  }

  /**
   * Exports the network formatting it as { nodes, links }
   * @param {Object} options 
   * @param {boolean} options.flatten
   */
  exportDirectedGraph({ flatten = false } = {}) {
    const exportData = { nodes: [], links: [] };

    for (const node of this.moleculeNodes.values()) {
      // Force native offline structural coords directly into the output!
      const renderObj = renderMolSVG(node.molecule.clone());
      const cellW = renderObj ? renderObj.cellW : 100;
      const cellH = renderObj ? renderObj.cellH : 100;

      exportData.nodes.push({
        id: node.id,
        type: 'molecule',
        molecule: node.molecule,
        formula: (() => {
            const f = node.molecule.getName();
            const c = node.molecule.getCharge();
            if (c === 0) return f;
            return f + `<sup>${Math.abs(c) === 1 ? (c > 0 ? '+' : '-') : `${Math.abs(c)}${c > 0 ? '+' : '-'}`}</sup>`;
        })(),
        smiles: toCanonicalSMILES(node.molecule),
        svg: renderObj ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${renderObj.cellW} ${renderObj.cellH}" width="${cellW}" height="${cellH}">${renderObj.svgContent}</svg>` : null,
        width: cellW,
        height: cellH
      });
    }

    if (!flatten) {
      for (const rxn of this.reactionNodes.values()) {
        exportData.nodes.push({
          id: rxn.id,
          type: 'reaction',
          conditions: { ...rxn.conditions }
        });

        for (const rId of rxn.reactants) {
          exportData.links.push({ source: rId, target: rxn.id, conditions: { ...rxn.conditions } });
        }
        for (const pId of rxn.products) {
          exportData.links.push({ source: rxn.id, target: pId, conditions: { ...rxn.conditions } });
        }
      }
    } else {
      // Aggregate flattened
      const flatMap = new Map();
      for (const rxn of this.reactionNodes.values()) {
        for (const src of rxn.reactants) {
          for (const tgt of rxn.products) {
            const key = `${src}->${tgt}`;
            if (!flatMap.has(key)) {
               const sMol = this.moleculeNodes.get(src).molecule;
               const tMol = this.moleculeNodes.get(tgt).molecule;
               flatMap.set(key, {
                 source: src,
                 target: tgt,
                 reactionIds: [],
                 conditions: { ...rxn.conditions },
                 delta: computeFormulaDelta(sMol, tMol)
               });
            }
            flatMap.get(key).reactionIds.push(rxn.id);
          }
        }
      }
      exportData.links = Array.from(flatMap.values());
    }

    return exportData;
  }

  toJSON() {
    return {
      moleculeNodes: Array.from(this.moleculeNodes.entries()).map(([k, v]) => [k, {
          id: v.id,
          smiles: toCanonicalSMILES(v.molecule), // just enough to reload
          consumedIn: v.consumedIn,
          producedBy: v.producedBy
      }]),
      reactionNodes: Array.from(this.reactionNodes.entries()).map(([k, v]) => [k, {
          id: v.id,
          reactants: v.reactants,
          products: v.products,
          conditions: v.conditions,
          reversible: v.reversible
      }]),
      _moleculeCounter: this._moleculeCounter,
      _reactionCounter: this._reactionCounter
    };
  }

  fromJSON(data) {
    this.moleculeNodes.clear();
    this.reactionNodes.clear();
    this._smilesIndex.clear();
    
    this._moleculeCounter = data._moleculeCounter || 0;
    this._reactionCounter = data._reactionCounter || 0;

    for (const [key, val] of data.moleculeNodes) {
        // Rehydrate molecule from smiles to get full object back
        const mol = parseSMILES(val.smiles);
        const node = new MoleculeNode(val.id, mol);
        node.consumedIn = val.consumedIn;
        node.producedBy = val.producedBy;
        this.moleculeNodes.set(key, node);
        this._smilesIndex.set(val.smiles, key);
    }

    for (const [key, val] of data.reactionNodes) {
        const rxn = new ReactionNode(val.id, val.reactants, val.products, val.conditions, val.reversible);
        this.reactionNodes.set(key, rxn);
    }

    return this;
  }
}
