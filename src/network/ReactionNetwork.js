/** @module network/ReactionNetwork */

import { MoleculeNode } from './MoleculeNode.js';
import { ReactionNode } from './ReactionNode.js';
import { toCanonicalSMILES, parseSMILES } from '../io/index.js';
import { applySMIRKS } from '../smirks/index.js';
import { findSMARTS } from '../smarts/index.js';
import { renderMolSVG } from '../layout/render2d.js';
import { computeFormulaDelta } from '../descriptors/molecular.js';

/**
 * Stores molecules and reactions in a bipartite reaction network.
 */
export class ReactionNetwork {
  constructor() {
    /** @type {Map<string, MoleculeNode>} */
    this.moleculeNodes = new Map();

    /** @type {Map<string, ReactionNode>} */
    this.reactionNodes = new Map();

    /** @type {Map<string, string>} */
    this._smilesIndex = new Map();

    /** @type {Map<string, Set<function(unknown): void>>} */
    this._listeners = new Map();

    this._moleculeCounter = 0;
    this._reactionCounter = 0;
  }

  /**
   * Subscribe to graph mutation events.
   * @param {string} event - Event name.
   * @param {function(unknown): void} callback - Event listener callback.
   * @returns {void}
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
  }

  /**
   * Emits a graph mutation event to registered listeners.
   * @private
   * @param {string} event - Event name.
   * @param {unknown} data - Event payload.
   * @returns {void}
   */
  _emit(event, data) {
    const callbacks = this._listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(data);
      }
    }
  }

  /**
   * Checks if the molecule is already registered.
   * @param {import('../core/Molecule.js').Molecule} molecule - Molecule to check.
   * @returns {boolean} True when the molecule is already present.
   */
  hasMolecule(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    return this._smilesIndex.has(smiles);
  }

  /**
   * Adds a molecule to the network. Identical molecules merge into the same node.
   * @param {import('../core/Molecule.js').Molecule} molecule - The molecule to add.
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
   * @param {Array<import('../core/Molecule.js').Molecule>} reactants - Reactant molecules.
   * @param {Array<import('../core/Molecule.js').Molecule>} products - Product molecules.
   * @param {object} [conditions] - Standardized metadata. Defaults to an empty object.
   * @param {boolean} [reversible] - Whether the reaction is reversible. Defaults to `false`.
   * @returns {ReactionNode} The created reaction node.
   */
  addReaction(reactants, products, conditions = {}, reversible = false) {
    const reactantNodes = reactants.map(molecule => this.addMolecule(molecule));
    const productNodes = products.map(molecule => this.addMolecule(molecule));

    const id = `rxn_${this._reactionCounter++}`;
    const reactionNode = new ReactionNode(
      id,
      reactantNodes.map(node => node.id),
      productNodes.map(node => node.id),
      conditions,
      reversible
    );

    this.reactionNodes.set(id, reactionNode);

    for (const reactantNode of reactantNodes) {
      if (!reactantNode.consumedIn.includes(id)) {
        reactantNode.consumedIn.push(id);
      }
    }
    for (const productNode of productNodes) {
      if (!productNode.producedBy.includes(id)) {
        productNode.producedBy.push(id);
      }
    }

    this._emit('reactionAdded', reactionNode);

    for (const reactantNode of reactantNodes) {
      for (const productNode of productNodes) {
        const delta = computeFormulaDelta(reactantNode.molecule, productNode.molecule);
        this._emit('linkAdded', {
          source: reactantNode.id,
          target: productNode.id,
          reactionId: id,
          conditions: { ...conditions },
          delta
        });
      }
    }

    return reactionNode;
  }

  /**
   * Splits a molecule into disconnected component subgraphs.
   * @private
   * @param {import('../core/Molecule.js').Molecule} fullGraph - Molecule to split.
   * @returns {Array<import('../core/Molecule.js').Molecule>} Disconnected component molecules.
   */
  _splitDisconnectedComponents(fullGraph) {
    if (fullGraph.atoms.size <= 1) {
      return [fullGraph];
    }

    const visited = new Set();
    const componentAtomSets = [];

    for (const atomId of fullGraph.atoms.keys()) {
      if (visited.has(atomId)) {
        continue;
      }

      const componentAtomIds = new Set();
      const queue = [atomId];
      visited.add(atomId);
      componentAtomIds.add(atomId);

      while (queue.length > 0) {
        const currentAtomId = queue.shift();
        for (const bondId of fullGraph.atoms.get(currentAtomId).bonds) {
          const bond = fullGraph.bonds.get(bondId);
          if (!bond) {
            continue;
          }
          const neighborAtomId = bond.getOtherAtom(currentAtomId);
          if (!visited.has(neighborAtomId)) {
            visited.add(neighborAtomId);
            componentAtomIds.add(neighborAtomId);
            queue.push(neighborAtomId);
          }
        }
      }

      componentAtomSets.push(componentAtomIds);
    }

    if (componentAtomSets.length === 1) {
      return [fullGraph];
    }

    return componentAtomSets.map(componentAtomIds => {
      const subMolecule = fullGraph.clone();
      for (const atomId of [...subMolecule.atoms.keys()]) {
        if (!componentAtomIds.has(atomId)) {
          subMolecule.removeAtom(atomId);
        }
      }
      return subMolecule;
    });
  }

  /**
   * Executes a SMIRKS reaction template against one or more reactants.
   * @param {Array<import('../core/Molecule.js').Molecule>} reactants - Reactant molecules to transform.
   * @param {string} smirks_template - SMIRKS reaction template.
   * @param {object} [baseConditions] - Base reaction metadata. Defaults to an empty object.
   * @returns {ReactionNode[]} The executed and added reactions.
   */
  executeReactionTemplate(reactants, smirks_template, baseConditions = {}) {
    if (reactants.length === 0) {
      return [];
    }

    const reactantParent = reactants[0].clone();
    for (let index = 1; index < reactants.length; index++) {
      const reactantClone = reactants[index].clone();
      for (const [atomId, atom] of reactantClone.atoms) {
        reactantParent.atoms.set(`tmp_${index}_${atomId}`, atom);
      }
      for (const [bondId, bond] of reactantClone.bonds) {
        reactantParent.bonds.set(`tmp_${index}_${bondId}`, bond);
      }
    }

    const reactantSmarts = smirks_template.split('>>')[0].trim();
    const mappings = [...findSMARTS(reactantParent, reactantSmarts)];
    const uniqueProducts = new Map();

    for (const mapping of mappings) {
      const fullProductGraph = applySMIRKS(reactantParent, smirks_template, { mapping });
      if (!fullProductGraph) {
        continue;
      }

      fullProductGraph.resetIds();
      const rawComponents = this._splitDisconnectedComponents(fullProductGraph);
      const separatedComponents = rawComponents.map(component => {
        try {
          const canonicalSmiles = toCanonicalSMILES(component);
          if (!canonicalSmiles) {
            return component;
          }
          return parseSMILES(canonicalSmiles);
        } catch {
          return component;
        }
      });

      const sortedCanons = separatedComponents.map(component => toCanonicalSMILES(component)).sort();
      const macroKey = sortedCanons.join(' + ');

      if (!uniqueProducts.has(macroKey)) {
        uniqueProducts.set(macroKey, separatedComponents);
      }
    }

    const createdNodes = [];
    for (const componentArray of uniqueProducts.values()) {
      const reactionNode = this.addReaction(reactants, componentArray, { ...baseConditions, smirks_template });
      createdNodes.push(reactionNode);
    }

    return createdNodes;
  }

  /**
   * Retrieves adjacent reactions that consume a molecule.
   * @param {import('../core/Molecule.js').Molecule} molecule - Molecule to query.
   * @returns {ReactionNode[]} Reactions that consume the molecule.
   */
  getReactionsConsuming(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    const nodeId = this._smilesIndex.get(smiles);
    if (!nodeId) {
      return [];
    }
    return this.moleculeNodes.get(nodeId).consumedIn.map(reactionId => this.reactionNodes.get(reactionId));
  }

  /**
   * Retrieves adjacent reactions that produce a molecule.
   * @param {import('../core/Molecule.js').Molecule} molecule - Molecule to query.
   * @returns {ReactionNode[]} Reactions that produce the molecule.
   */
  getReactionsProducing(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    const nodeId = this._smilesIndex.get(smiles);
    if (!nodeId) {
      return [];
    }
    return this.moleculeNodes.get(nodeId).producedBy.map(reactionId => this.reactionNodes.get(reactionId));
  }

  /**
   * Unlinks a molecule and cascades deletion for orphaned reactions.
   * @param {import('../core/Molecule.js').Molecule} molecule - Molecule to remove.
   * @returns {void}
   */
  removeMolecule(molecule) {
    const smiles = toCanonicalSMILES(molecule);
    const nodeId = this._smilesIndex.get(smiles);
    if (!nodeId) {
      return;
    }

    const node = this.moleculeNodes.get(nodeId);

    for (const reactionId of node.consumedIn) {
      const reactionNode = this.reactionNodes.get(reactionId);
      if (reactionNode) {
        reactionNode.reactants = reactionNode.reactants.filter(id => id !== nodeId);
        if (reactionNode.reactants.length === 0 || reactionNode.products.length === 0) {
          this.removeReaction(reactionId);
        }
      }
    }

    for (const reactionId of node.producedBy) {
      const reactionNode = this.reactionNodes.get(reactionId);
      if (reactionNode) {
        reactionNode.products = reactionNode.products.filter(id => id !== nodeId);
        if (reactionNode.reactants.length === 0 || reactionNode.products.length === 0) {
          this.removeReaction(reactionId);
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
   * @param {string} reactionId - Reaction node ID.
   * @returns {void}
   */
  removeReaction(reactionId) {
    const reactionNode = this.reactionNodes.get(reactionId);
    if (!reactionNode) {
      return;
    }

    for (const reactantId of reactionNode.reactants) {
      const moleculeNode = this.moleculeNodes.get(reactantId);
      if (moleculeNode) {
        moleculeNode.consumedIn = moleculeNode.consumedIn.filter(id => id !== reactionId);
      }
    }
    for (const productId of reactionNode.products) {
      const moleculeNode = this.moleculeNodes.get(productId);
      if (moleculeNode) {
        moleculeNode.producedBy = moleculeNode.producedBy.filter(id => id !== reactionId);
      }
    }

    this.reactionNodes.delete(reactionId);
    this._emit('reactionRemoved', reactionNode);
  }

  /**
   * Uses BFS to find the shortest reaction path between two molecules.
   * @param {import('../core/Molecule.js').Molecule} startMolecule - Pathway start molecule.
   * @param {import('../core/Molecule.js').Molecule} targetMolecule - Pathway target molecule.
   * @returns {Array<MoleculeNode|ReactionNode>} Alternating pathway nodes, or an empty array when not found.
   */
  findShortestPathway(startMolecule, targetMolecule) {
    const startSmiles = toCanonicalSMILES(startMolecule);
    const targetSmiles = toCanonicalSMILES(targetMolecule);

    const startId = this._smilesIndex.get(startSmiles);
    const targetId = this._smilesIndex.get(targetSmiles);

    if (!startId || !targetId) {
      return [];
    }
    if (startId === targetId) {
      return [this.moleculeNodes.get(startId)];
    }

    const queue = [[startId]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const path = queue.shift();
      const currentId = path[path.length - 1];
      const moleculeNode = this.moleculeNodes.get(currentId);

      for (const reactionId of moleculeNode.consumedIn) {
        const reactionNode = this.reactionNodes.get(reactionId);
        for (const productId of reactionNode.products) {
          if (!visited.has(productId)) {
            visited.add(productId);
            const newPath = [...path, reactionId, productId];
            if (productId === targetId) {
              return newPath.map(id => this.moleculeNodes.get(id) || this.reactionNodes.get(id));
            }
            queue.push(newPath);
          }
        }
      }
    }

    return [];
  }

  /**
   * Traces backward from a product to identify synthesis pathways.
   * @param {import('../core/Molecule.js').Molecule} targetMolecule - Target product molecule.
   * @param {number} maxDepth - Maximum recursion depth.
   * @returns {Array<Array<MoleculeNode|ReactionNode>>} Backward synthesis routes.
   */
  findSynthesisRoutes(targetMolecule, maxDepth = 3) {
    const targetSmiles = toCanonicalSMILES(targetMolecule);
    const targetId = this._smilesIndex.get(targetSmiles);
    if (!targetId) {
      return [];
    }

    const routes = [];
    const dfs = (currentId, path, depth) => {
      if (depth > maxDepth) {
        return;
      }
      if (path.length > 1 && currentId !== targetId) {
        routes.push(path.map(id => this.moleculeNodes.get(id) || this.reactionNodes.get(id)));
      }

      const moleculeNode = this.moleculeNodes.get(currentId);
      for (const reactionId of moleculeNode.producedBy) {
        const reactionNode = this.reactionNodes.get(reactionId);
        for (const reactantId of reactionNode.reactants) {
          if (!path.includes(reactantId)) {
            dfs(reactantId, [reactantId, reactionId, ...path], depth + 1);
          }
        }
      }
    };

    dfs(targetId, [targetId], 0);
    return routes;
  }

  /**
   * Enumerates reachable downstream nodes.
   * @param {import('../core/Molecule.js').Molecule} startMolecule - Starting molecule.
   * @param {number} maxDepth - Maximum traversal depth.
   * @returns {Array<MoleculeNode|ReactionNode>} Reachable molecule and reaction nodes.
   */
  findReachable(startMolecule, maxDepth = 3) {
    const startSmiles = toCanonicalSMILES(startMolecule);
    const startId = this._smilesIndex.get(startSmiles);
    if (!startId) {
      return [];
    }

    const reachable = new Set();
    const dfs = (currentId, depth) => {
      if (depth > maxDepth) {
        return;
      }
      reachable.add(currentId);
      const moleculeNode = this.moleculeNodes.get(currentId);
      for (const reactionId of moleculeNode.consumedIn) {
        reachable.add(reactionId);
        const reactionNode = this.reactionNodes.get(reactionId);
        for (const productId of reactionNode.products) {
          if (!reachable.has(productId)) {
            dfs(productId, depth + 1);
          }
        }
      }
    };

    dfs(startId, 0);
    return Array.from(reachable).map(id => this.moleculeNodes.get(id) || this.reactionNodes.get(id));
  }

  /**
   * Exports the network as `{ nodes, links }`.
   * @param {object} [options] - Export options.
   * @param {boolean} [options.flatten] - Whether to collapse reactions into direct molecule links.
   * @returns {{nodes: object[], links: object[]}} Exported graph payload.
   */
  exportDirectedGraph({ flatten = false } = {}) {
    const exportData = { nodes: [], links: [] };

    for (const node of this.moleculeNodes.values()) {
      const renderObject = renderMolSVG(node.molecule.clone());
      const cellWidth = renderObject ? renderObject.cellW : 100;
      const cellHeight = renderObject ? renderObject.cellH : 100;

      exportData.nodes.push({
        id: node.id,
        type: 'molecule',
        molecule: node.molecule,
        formula: (() => {
          const formula = node.molecule.getName();
          const charge = node.molecule.getCharge();
          if (charge === 0) {
            return formula;
          }
          return `${formula}<sup>${Math.abs(charge) === 1 ? (charge > 0 ? '+' : '-') : `${Math.abs(charge)}${charge > 0 ? '+' : '-'}`}</sup>`;
        })(),
        smiles: toCanonicalSMILES(node.molecule),
        svg: renderObject
          ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${renderObject.cellW} ${renderObject.cellH}" width="${cellWidth}" height="${cellHeight}">${renderObject.svgContent}</svg>`
          : null,
        width: cellWidth,
        height: cellHeight
      });
    }

    if (!flatten) {
      for (const reaction of this.reactionNodes.values()) {
        exportData.nodes.push({
          id: reaction.id,
          type: 'reaction',
          conditions: { ...reaction.conditions }
        });

        for (const reactantId of reaction.reactants) {
          exportData.links.push({ source: reactantId, target: reaction.id, conditions: { ...reaction.conditions } });
        }
        for (const productId of reaction.products) {
          exportData.links.push({ source: reaction.id, target: productId, conditions: { ...reaction.conditions } });
        }
      }
    } else {
      const flattenedLinks = new Map();
      for (const reaction of this.reactionNodes.values()) {
        for (const sourceId of reaction.reactants) {
          for (const targetId of reaction.products) {
            const key = `${sourceId}->${targetId}`;
            if (!flattenedLinks.has(key)) {
              const sourceMolecule = this.moleculeNodes.get(sourceId).molecule;
              const targetMolecule = this.moleculeNodes.get(targetId).molecule;
              flattenedLinks.set(key, {
                source: sourceId,
                target: targetId,
                reactionIds: [],
                conditions: { ...reaction.conditions },
                delta: computeFormulaDelta(sourceMolecule, targetMolecule)
              });
            }
            flattenedLinks.get(key).reactionIds.push(reaction.id);
          }
        }
      }
      exportData.links = Array.from(flattenedLinks.values());
    }

    return exportData;
  }

  toJSON() {
    return {
      moleculeNodes: Array.from(this.moleculeNodes.entries()).map(([key, value]) => [
        key,
        {
          id: value.id,
          smiles: toCanonicalSMILES(value.molecule),
          consumedIn: value.consumedIn,
          producedBy: value.producedBy
        }
      ]),
      reactionNodes: Array.from(this.reactionNodes.entries()).map(([key, value]) => [
        key,
        {
          id: value.id,
          reactants: value.reactants,
          products: value.products,
          conditions: value.conditions,
          reversible: value.reversible
        }
      ]),
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

    for (const [key, value] of data.moleculeNodes) {
      const molecule = parseSMILES(value.smiles);
      const node = new MoleculeNode(value.id, molecule);
      node.consumedIn = value.consumedIn;
      node.producedBy = value.producedBy;
      this.moleculeNodes.set(key, node);
      this._smilesIndex.set(value.smiles, key);
    }

    for (const [key, value] of data.reactionNodes) {
      const reaction = new ReactionNode(value.id, value.reactants, value.products, value.conditions, value.reversible);
      this.reactionNodes.set(key, reaction);
    }

    return this;
  }
}
