/** @module network/ScaffoldNetwork */

import { ScaffoldNode } from './ScaffoldNode.js';
import { ScaffoldReactionNode } from './ScaffoldReactionNode.js';
import { extractMurckoScaffold } from '../algorithms/scaffold.js';
import { toCanonicalSMILES } from '../io/index.js';
import { Molecule } from '../core/Molecule.js';
import { renderMolSVG } from '../layout/render2d.js';

const NETWORK_RENDER_OPTIONS = { atomLabelBackplates: false, chargeBadgeBackplates: false, centerAtomLabels: true };
const ORGANIC_SUBSET_IMPLICIT_VALENCE = Object.freeze({
  B: 3,
  C: 4,
  N: 3,
  O: 2,
  P: 3,
  S: 2,
  F: 1,
  Cl: 1,
  Br: 1,
  I: 1
});

function retainedHeavyBondOrder(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return 0;
  }
  let order = 0;
  for (const bondId of atom.bonds ?? []) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const other = molecule.atoms.get(bond.getOtherAtom(atomId));
    if (!other || other.name === 'H') {
      continue;
    }
    order += bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
  }
  return order;
}

function repairNeutralizedScaffoldHydrogens(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  const targetValence = ORGANIC_SUBSET_IMPLICIT_VALENCE[atom?.name];
  if (!atom || targetValence == null) {
    return;
  }

  const hydrogenIds = [];
  for (const bondId of [...atom.bonds]) {
    const bond = molecule.bonds.get(bondId);
    const otherId = bond?.getOtherAtom(atomId);
    const other = molecule.atoms.get(otherId);
    if (other?.name === 'H' && (other.bonds?.length ?? 0) === 1) {
      hydrogenIds.push(otherId);
    }
  }

  const hydrogenCount = Math.max(0, Math.round((targetValence - retainedHeavyBondOrder(molecule, atomId)) * 1000) / 1000);
  const roundedHydrogenCount = Math.round(hydrogenCount);
  const desiredHydrogenCount = Math.abs(hydrogenCount - roundedHydrogenCount) <= 1e-6 ? roundedHydrogenCount : hydrogenIds.length;

  for (const hydrogenId of hydrogenIds.slice(desiredHydrogenCount)) {
    molecule.removeAtom?.(hydrogenId);
  }
  for (let index = hydrogenIds.length; index < desiredHydrogenCount; index++) {
    const hydrogen = molecule.addAtom?.(null, 'H', {}, { recompute: false });
    if (!hydrogen) {
      continue;
    }
    hydrogen.visible = false;
    hydrogen.x = atom.x;
    hydrogen.y = atom.y;
    hydrogen.z = atom.z;
    molecule.addBond?.(null, atomId, hydrogen.id, { order: 1 }, false);
  }
}

function neutralizeScaffoldForGrouping(scaffoldMol) {
  const neutralScaffold = scaffoldMol.clone();
  const neutralizedAtomIds = [];
  for (const atom of neutralScaffold.atoms.values()) {
    if (atom.name === 'H') {
      continue;
    }
    if ((atom.properties.charge ?? 0) !== 0) {
      atom.setCharge?.(0);
      neutralizedAtomIds.push(atom.id);
    }
  }
  for (const atomId of neutralizedAtomIds) {
    repairNeutralizedScaffoldHydrogens(neutralScaffold, atomId);
  }
  neutralScaffold._recomputeProperties?.();
  return neutralScaffold;
}

function scaffoldGroupingInfo(molecule, scaffoldOptions = {}) {
  const scaffoldMol = extractMurckoScaffold(molecule, scaffoldOptions);
  if (scaffoldMol.atoms.size === 0) {
    return {
      indexKey: 'ACYCLIC',
      canonicalSmiles: null,
      scaffoldMol: new Molecule()
    };
  }
  const neutralScaffoldMol = neutralizeScaffoldForGrouping(scaffoldMol);
  const canonicalSmiles = toCanonicalSMILES(neutralScaffoldMol);
  return {
    indexKey: canonicalSmiles ?? 'ACYCLIC',
    canonicalSmiles,
    scaffoldMol: canonicalSmiles !== null ? neutralScaffoldMol : new Molecule()
  };
}

/**
 * An abstraction over ReactionNetwork that groups molecules by their Murcko scaffolds
 * and aggregates their chemical reactions into scaffold-level transformations.
 */
export class ScaffoldNetwork {
  /**
   * @param {import('./ReactionNetwork.js').ReactionNetwork} reactionNetwork - Source reaction network to summarize by scaffold.
   * @param {object} [options] - Network synchronization options.
   * @param {boolean} [options.autoSync] - Whether to dynamically update scaffolds when underlying network changes.
   * @param {boolean} [options.preserveExocyclicMultipleBonds] - Whether scaffold identity keeps terminal heteroatoms attached by multiple bonds to retained scaffold atoms.
   */
  constructor(reactionNetwork, { autoSync = true, preserveExocyclicMultipleBonds = false } = {}) {
    this.reactionNetwork = reactionNetwork;
    this.scaffoldOptions = { preserveExocyclicMultipleBonds };

    /** @type {Map<string, ScaffoldNode>} */
    this.scaffoldNodes = new Map();

    /** @type {Map<string, ScaffoldReactionNode>} */
    this.scaffoldReactionNodes = new Map();

    /** @type {Map<string, string>} */
    this._scaffoldSmilesIndex = new Map(); // canonical SMILES (or 'ACYCLIC') -> scaffold node ID

    /** @type {Map<string, string>} */
    this._reactionSignatureIndex = new Map(); // sortedReactantScaffoldIds + '>>' + sortedProductScaffoldIds -> scaffold reaction ID

    this._scaffoldCounter = 0;
    this._reactionCounter = 0;

    this._processedMolecules = new Set();
    this._processedReactions = new Set();

    this.autoSync = autoSync;

    if (this.autoSync) {
      this.sync();

      this.reactionNetwork.on('nodeAdded', node => {
        if (!this._processedMolecules.has(node.id)) {
          this._processMolecule(node);
          this._processedMolecules.add(node.id);
        }
      });

      this.reactionNetwork.on('reactionAdded', rxnNode => {
        if (!this._processedReactions.has(rxnNode.id)) {
          this._processReaction(rxnNode);
          this._processedReactions.add(rxnNode.id);
        }
      });
    }
  }

  /**
   * Synchronizes the ScaffoldNetwork with the underlying ReactionNetwork.
   * This is safe to call repeatedly; it only processes unvisited nodes.
   * @returns {void}
   */
  sync() {
    // 1. Process all new molecules
    for (const [molId, molNode] of this.reactionNetwork.moleculeNodes.entries()) {
      if (!this._processedMolecules.has(molId)) {
        this._processMolecule(molNode);
        this._processedMolecules.add(molId);
      }
    }

    // 2. Process all new reactions
    for (const [rxnId, rxnNode] of this.reactionNetwork.reactionNodes.entries()) {
      if (!this._processedReactions.has(rxnId)) {
        this._processReaction(rxnNode);
        this._processedReactions.add(rxnId);
      }
    }
  }

  /**
   * Process a single underlying MoleculeNode to group it into a ScaffoldNode
   * @param {import('./MoleculeNode.js').MoleculeNode} molNode - Molecule node to index under its Murcko scaffold.
   * @private
   */
  _processMolecule(molNode) {
    const { indexKey, canonicalSmiles, scaffoldMol } = scaffoldGroupingInfo(molNode.molecule, this.scaffoldOptions);

    let scaffoldId;
    if (this._scaffoldSmilesIndex.has(indexKey)) {
      scaffoldId = this._scaffoldSmilesIndex.get(indexKey);
    } else {
      scaffoldId = `scaff_${this._scaffoldCounter++}`;
      const newScaffoldNode = new ScaffoldNode(scaffoldId, canonicalSmiles, scaffoldMol);
      this.scaffoldNodes.set(scaffoldId, newScaffoldNode);
      this._scaffoldSmilesIndex.set(indexKey, scaffoldId);
    }

    const scaffoldNode = this.scaffoldNodes.get(scaffoldId);
    if (!scaffoldNode.moleculeIds.includes(molNode.id)) {
      scaffoldNode.moleculeIds.push(molNode.id);
    }
  }

  /**
   * Process an underlying ReactionNode to map it onto a ScaffoldReactionNode
   * @param {import('./ReactionNode.js').ReactionNode} rxnNode - Reaction node whose scaffold transformation should be recorded.
   * @private
   */
  _processReaction(rxnNode) {
    const getScaffoldIdForMol = molId => {
      const molNode = this.reactionNetwork.moleculeNodes.get(molId);
      const { indexKey } = scaffoldGroupingInfo(molNode.molecule, this.scaffoldOptions);
      return this._scaffoldSmilesIndex.get(indexKey);
    };

    const reactantScaffolds = rxnNode.reactants.map(getScaffoldIdForMol).filter(Boolean);
    const productScaffolds = rxnNode.products.map(getScaffoldIdForMol).filter(Boolean);

    // If a reaction had no interpretable reactants or products, we skip it
    if (reactantScaffolds.length === 0 || productScaffolds.length === 0) {
      return;
    }

    // Sort to create a unique signature for this scaffold transformation
    const sigReactants = [...reactantScaffolds].sort().join(',');
    const sigProducts = [...productScaffolds].sort().join(',');
    const signature = `${sigReactants}>>${sigProducts}`;

    let scaffoldRxnId;
    let scaffoldRxnNode;

    if (this._reactionSignatureIndex.has(signature)) {
      scaffoldRxnId = this._reactionSignatureIndex.get(signature);
      scaffoldRxnNode = this.scaffoldReactionNodes.get(scaffoldRxnId);
    } else {
      scaffoldRxnId = `scaff_rxn_${this._reactionCounter++}`;
      scaffoldRxnNode = new ScaffoldReactionNode(scaffoldRxnId, reactantScaffolds, productScaffolds);
      this.scaffoldReactionNodes.set(scaffoldRxnId, scaffoldRxnNode);
      this._reactionSignatureIndex.set(signature, scaffoldRxnId);

      // Link scaffolds to this reaction
      for (const rId of reactantScaffolds) {
        const rNode = this.scaffoldNodes.get(rId);
        if (rNode && !rNode.consumedIn.includes(scaffoldRxnId)) {
          rNode.consumedIn.push(scaffoldRxnId);
        }
      }
      for (const pId of productScaffolds) {
        const pNode = this.scaffoldNodes.get(pId);
        if (pNode && !pNode.producedBy.includes(scaffoldRxnId)) {
          pNode.producedBy.push(scaffoldRxnId);
        }
      }
    }

    if (!scaffoldRxnNode.reactionIds.includes(rxnNode.id)) {
      scaffoldRxnNode.reactionIds.push(rxnNode.id);
    }
  }

  /**
   * Identifies all self-loops in the scaffold network (Scaffold A -> Scaffold A).
   * These represent internal functional group derivations that preserve the core.
   * @returns {ScaffoldReactionNode[]} Scaffold reactions whose reactant and product scaffold sets are identical.
   */
  getSelfTransformations() {
    const list = [];
    for (const rxn of this.scaffoldReactionNodes.values()) {
      // Check if reactants exactly match products
      const sortedR = [...rxn.reactants].sort();
      const sortedP = [...rxn.products].sort();
      if (sortedR.length === sortedP.length && sortedR.every((val, index) => val === sortedP[index])) {
        list.push(rxn);
      }
    }
    return list;
  }

  /**
   * Exports the scaffold network as `{ nodes, links }` for D3 visualization.
   * Renders the Murcko framework as an internal SVG.
   * @returns {{nodes: object[], links: object[]}} Exported graph payload.
   */
  exportDirectedGraph() {
    const nodes = [];
    const links = [];

    for (const node of this.scaffoldNodes.values()) {
      let renderObject = null;
      if (node.molecule && node.molecule.atoms.size > 0) {
        try {
          renderObject = renderMolSVG(node.molecule.clone(), NETWORK_RENDER_OPTIONS);
        } catch {
          // ignore layout failure
        }
      }

      const cellWidth = renderObject ? renderObject.cellW : 120;
      const cellHeight = renderObject ? renderObject.cellH : 120;

      nodes.push({
        id: node.id,
        type: 'molecule',
        molecule: node.molecule,
        formula: node.smiles === null ? 'Acyclic Group' : `Scaffold: ${node.moleculeIds.length} mols`,
        smiles: node.smiles || 'ACYCLIC',
        svg: renderObject
          ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${renderObject.cellW} ${renderObject.cellH}" width="${cellWidth}" height="${cellHeight}">${renderObject.svgContent}</svg>`
          : null,
        width: cellWidth,
        height: cellHeight,
        moleculeIds: node.moleculeIds
      });
    }

    // Export links directly from reactants to products
    const linkMap = new Map();
    for (const rxn of this.scaffoldReactionNodes.values()) {
      for (const sourceId of rxn.reactants) {
        for (const targetId of rxn.products) {
          const key = `${sourceId}->${targetId}`;
          if (!linkMap.has(key)) {
            linkMap.set(key, {
              source: sourceId,
              target: targetId,
              reactionIds: []
            });
          }
          linkMap.get(key).reactionIds.push(...rxn.reactionIds);
        }
      }
    }

    for (const l of linkMap.values()) {
      links.push({
        source: l.source,
        target: l.target,
        delta: `${l.reactionIds.length} runs`
      });
    }

    return { nodes, links };
  }

  /**
   * Exports a hierarchical graph mixing the base molecule/reaction network
   * with Scaffold nodes and membership edges connecting Scaffolds down to their constituent molecules.
   * @param {{nodes: object[], links: object[]}} baseGraph - The exported payload from ReactionNetwork.
   * @returns {{nodes: object[], links: object[]}} The combined hierarchical graph.
   */
  exportHierarchicalGraph(baseGraph) {
    const nodes = [...baseGraph.nodes];
    const links = [...baseGraph.links];

    const baseNodeIds = new Set(baseGraph.nodes.map(n => n.id));

    // Add scaffold nodes
    for (const node of this.scaffoldNodes.values()) {
      // Ignore the acyclic catch-all to prevent it from becoming a massive unreadable ultra-node
      if (node.smiles === null) {
        continue;
      }

      let renderObject = null;
      if (node.molecule && node.molecule.atoms.size > 0) {
        try {
          renderObject = renderMolSVG(node.molecule.clone(), NETWORK_RENDER_OPTIONS);
        } catch {
          // ignore layout failure
        }
      }

      const cellWidth = renderObject ? renderObject.cellW : 120;
      const cellHeight = renderObject ? renderObject.cellH : 120;

      nodes.push({
        id: node.id,
        type: 'scaffold',
        molecule: node.molecule,
        formula: `Scaffold: ${node.moleculeIds.length} instance(s)`,
        smiles: node.smiles,
        svg: renderObject
          ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${renderObject.cellW} ${renderObject.cellH}" width="${cellWidth}" height="${cellHeight}">${renderObject.svgContent}</svg>`
          : null,
        width: cellWidth,
        height: cellHeight
      });

      // Add membership links
      for (const molId of node.moleculeIds) {
        if (baseNodeIds.has(molId)) {
          links.push({
            source: node.id,
            target: molId,
            edgeType: 'membership',
            delta: ''
          });
        }
      }
    }

    return { nodes, links };
  }
}
