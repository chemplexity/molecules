/** @module network/ScaffoldReactionNode */

/**
 * Represents an aggregated transformation between scaffolds in the network.
 */
export class ScaffoldReactionNode {
  /**
   * @param {string} id - Unique identifier for the scaffold reaction.
   * @param {string[]} reactants - Array of reactant ScaffoldNode IDs.
   * @param {string[]} products - Array of product ScaffoldNode IDs.
   */
  constructor(id, reactants, products) {
    this.id = id;
    this.reactants = reactants;
    this.products = products;
    
    /** @type {string[]} */
    this.reactionIds = []; // Underlying base ReactionNetwork reaction IDs
  }
}
