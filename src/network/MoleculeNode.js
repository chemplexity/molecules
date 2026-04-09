/** @module network/MoleculeNode */

/**
 * Represents a chemical entity in the ReactionNetwork.
 */
export class MoleculeNode {
  /**
   * @param {string} id - Unique ID.
   * @param {import('../core/Molecule.js').Molecule} molecule - The underlying Molecule instance (a cloned snapshot).
   */
  constructor(id, molecule) {
    this.id = id;
    this.molecule = molecule;
    /** @type {string[]} Array of ReactionNode IDs where this molecule is a reactant */
    this.consumedIn = [];
    /** @type {string[]} Array of ReactionNode IDs where this molecule is a product */
    this.producedBy = [];
  }
}
