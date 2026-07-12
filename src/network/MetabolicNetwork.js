/** @module network/MetabolicNetwork */

import { ReactionNetwork } from './ReactionNetwork.js';
import { metabolismTemplates } from '../smirks/metabolism-reference.js';

/**
 * Generates and queries a metabolic (biotransformation) network by repeatedly applying a
 * curated SMIRKS rule set to a set of seed molecules across generations.
 *
 * Wraps a `ReactionNetwork` by composition (the same relationship `ScaffoldNetwork` has to
 * `ReactionNetwork`) rather than extending it — the underlying bipartite molecule/reaction
 * graph, deduplication, and pathway queries are reused as-is. This class adds only what's
 * specific to metabolism: seed/generation bookkeeping, cascading rule application with
 * explosion controls, and phase/enzyme-family-aware queries.
 */
export class MetabolicNetwork {
  /**
   * @param {object} [options] - Configuration options.
   * @param {import('./ReactionNetwork.js').ReactionNetwork} [options.reactionNetwork] - Backing
   *   reaction network. Defaults to a fresh, empty `ReactionNetwork`.
   * @param {Record<string, import('../smirks/metabolism-reference.js').BiotransformationTemplateEntry>} [options.templates] -
   *   Rule set applied by `generate()`. Defaults to the built-in `metabolismTemplates` catalogue.
   * @param {number} [options.maxGenerations] - Maximum number of expansion generations. Defaults to `3`.
   * @param {number} [options.maxNodes] - Circuit breaker on total molecule node count. Defaults to `200`.
   */
  constructor({ reactionNetwork = new ReactionNetwork(), templates = metabolismTemplates, maxGenerations = 3, maxNodes = 200 } = {}) {
    this.reactionNetwork = reactionNetwork;
    this.templates = templates;
    this.maxGenerations = maxGenerations;
    this.maxNodes = maxNodes;

    /** @type {Map<string, number>} MoleculeNode id -> generation distance from the nearest seed. */
    this._generationByMoleculeId = new Map();

    /** @type {Set<string>} MoleculeNode ids registered as seeds. */
    this._seedMoleculeIds = new Set();

    /** @type {Set<string>} `${moleculeNodeId}::${templateId}` pairs already attempted, to avoid redundant reapplication. */
    this._triedPairs = new Set();

    /** @type {boolean} True when the last `generate()` call stopped early because of `maxNodes`. */
    this.truncated = false;
  }

  /**
   * Registers a molecule as a generation-0 seed (e.g. a parent drug or endogenous substrate).
   * Identical molecules merge into the same node, matching `ReactionNetwork.addMolecule`.
   * @param {import('../core/Molecule.js').Molecule} molecule - Seed molecule.
   * @returns {import('./MoleculeNode.js').MoleculeNode} The registered node.
   */
  addSeed(molecule) {
    const node = this.reactionNetwork.addMolecule(molecule);
    this._seedMoleculeIds.add(node.id);
    if (!this._generationByMoleculeId.has(node.id)) {
      this._generationByMoleculeId.set(node.id, 0);
    }
    return node;
  }

  /**
   * Returns whether a molecule is registered as a seed.
   * @param {import('../core/Molecule.js').Molecule} molecule - Molecule to check.
   * @returns {boolean} True when the molecule is a seed.
   */
  isSeed(molecule) {
    const node = this.reactionNetwork.getMoleculeNode(molecule);
    return !!node && this._seedMoleculeIds.has(node.id);
  }

  /**
   * Returns the generation distance from the nearest seed, or `null` when the molecule is
   * unregistered or unreached by `generate()`.
   * @param {import('../core/Molecule.js').Molecule} molecule - Molecule to check.
   * @returns {number|null} Generation distance, or `null`.
   */
  getGeneration(molecule) {
    const node = this.reactionNetwork.getMoleculeNode(molecule);
    if (!node) {
      return null;
    }
    return this._generationByMoleculeId.get(node.id) ?? null;
  }

  /**
   * Returns all registered seed molecule nodes.
   * @returns {import('./MoleculeNode.js').MoleculeNode[]} Seed nodes.
   */
  getSeedMolecules() {
    return [...this._seedMoleculeIds].map(id => this.reactionNetwork.moleculeNodes.get(id)).filter(Boolean);
  }

  /**
   * Returns molecule nodes produced by at least one reaction tagged with the given phase.
   * @param {'I'|'II'} phase - Metabolism phase to filter by.
   * @returns {import('./MoleculeNode.js').MoleculeNode[]} Matching molecule nodes.
   */
  getMetabolitesByPhase(phase) {
    return this._productsWhere(reaction => reaction.conditions.phase === phase);
  }

  /**
   * Returns molecule nodes produced by at least one reaction tagged with the given enzyme family.
   * @param {string} enzymeFamily - Enzyme family to filter by (see `ENZYME_FAMILY`).
   * @returns {import('./MoleculeNode.js').MoleculeNode[]} Matching molecule nodes.
   */
  getMetabolitesByEnzymeFamily(enzymeFamily) {
    return this._productsWhere(reaction => reaction.conditions.enzymeFamily === enzymeFamily);
  }

  /**
   * @private
   * @param {function(import('./ReactionNode.js').ReactionNode): boolean} predicate - Reaction filter.
   * @returns {import('./MoleculeNode.js').MoleculeNode[]} Deduplicated product nodes across matching reactions.
   */
  _productsWhere(predicate) {
    const moleculeIds = new Set();
    for (const reaction of this.reactionNetwork.reactionNodes.values()) {
      if (predicate(reaction)) {
        for (const productId of reaction.products) {
          moleculeIds.add(productId);
        }
      }
    }
    return [...moleculeIds].map(id => this.reactionNetwork.moleculeNodes.get(id)).filter(Boolean);
  }

  /**
   * Returns molecule nodes with no outgoing reactions — candidate end-of-pathway metabolites.
   * @returns {import('./MoleculeNode.js').MoleculeNode[]} Terminal molecule nodes.
   */
  getTerminalMetabolites() {
    return [...this.reactionNetwork.moleculeNodes.values()].filter(node => node.consumedIn.length === 0);
  }

  /**
   * Cascades the rule set across the frontier of seed and newly-produced molecules,
   * generation by generation. Safe to call repeatedly (e.g. after `addSeed`ing more
   * molecules) — already-attempted molecule/template pairs are never retried.
   * @param {object} [options] - Expansion options.
   * @param {string[]} [options.templateIds] - Subset of `this.templates` keys to apply.
   *   Defaults to every template in `this.templates`.
   * @returns {{generationsRun: number, truncated: boolean, moleculeCount: number}} Expansion summary.
   */
  generate({ templateIds } = {}) {
    const templateEntries = templateIds ? templateIds.map(id => [id, this.templates[id]]).filter(([, template]) => template) : Object.entries(this.templates);

    let frontier = [...this._seedMoleculeIds];
    let generation = 0;
    this.truncated = this.reactionNetwork.moleculeNodes.size >= this.maxNodes;

    while (frontier.length > 0 && generation < this.maxGenerations && !this.truncated) {
      const nextFrontier = new Set();

      for (const moleculeNodeId of frontier) {
        if (this.truncated) {
          break;
        }
        const moleculeNode = this.reactionNetwork.moleculeNodes.get(moleculeNodeId);
        if (!moleculeNode) {
          continue;
        }

        for (const [templateId, template] of templateEntries) {
          const pairKey = `${moleculeNodeId}::${templateId}`;
          if (this._triedPairs.has(pairKey)) {
            continue;
          }
          this._triedPairs.add(pairKey);

          if (this.reactionNetwork.moleculeNodes.size >= this.maxNodes) {
            this.truncated = true;
            break;
          }

          const reactions = this.reactionNetwork.executeReactionTemplate([moleculeNode.molecule], template.smirks, {
            phase: template.phase,
            enzymeFamily: template.enzymeFamily,
            template: templateId
          });

          for (const reaction of reactions) {
            for (const productId of reaction.products) {
              if (!this._generationByMoleculeId.has(productId)) {
                this._generationByMoleculeId.set(productId, generation + 1);
              }
              if (productId !== moleculeNodeId) {
                nextFrontier.add(productId);
              }
            }
          }
        }
      }

      generation++;
      frontier = [...nextFrontier];
    }

    return {
      generationsRun: generation,
      truncated: this.truncated,
      moleculeCount: this.reactionNetwork.moleculeNodes.size
    };
  }

  /**
   * Exports the underlying network as `{ nodes, links }`, annotating each molecule node with
   * `generation` (distance from the nearest seed, or `null` if unreached) and `isSeed`.
   * @param {object} [options] - Forwarded to `ReactionNetwork.exportDirectedGraph`.
   * @returns {{nodes: object[], links: object[]}} Exported graph payload.
   */
  exportDirectedGraph(options = {}) {
    const graph = this.reactionNetwork.exportDirectedGraph(options);
    for (const node of graph.nodes) {
      if (node.type !== 'molecule') {
        continue;
      }
      node.generation = this._generationByMoleculeId.get(node.id) ?? null;
      node.isSeed = this._seedMoleculeIds.has(node.id);
    }
    return graph;
  }
}
