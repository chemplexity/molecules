/** @module network/ReactionNode */

/**
 * Represents a reaction event mechanism acting as a Hyperedge connecting multiple
 * reactant molecules to multiple product molecules.
 */
export class ReactionNode {
  /**
   * @param {string} id - Unique ID.
   * @param {string[]} reactants - Array of reactant moleculeNodeIds.
   * @param {string[]} products - Array of product moleculeNodeIds.
   * @param {object} [conditions={}] - Reaction metadata.
   * @param {boolean} [reversible=false] - Whether the reaction is in equilibrium.
   */
  constructor(id, reactants, products, conditions = {}, reversible = false) {
    this.id = id;
    this.reactants = [...reactants];
    this.products = [...products];
    this.reversible = reversible;
    
    // Enforce that conditions is an Object to guarantee clean serialization
    if (typeof conditions !== 'object' || conditions === null || Array.isArray(conditions)) {
      throw new TypeError('Reaction conditions must be an object schema.');
    }
    
    this.conditions = { ...conditions };
  }
}
