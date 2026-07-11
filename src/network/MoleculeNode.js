/** @module network/MoleculeNode */

/**
 * Represents a chemical entity in the ReactionNetwork.
 */
export class MoleculeNode {
  /**
   * @param {string} id - Unique ID.
   * @param {import('../core/Molecule.js').Molecule} molecule - The underlying Molecule instance (a cloned snapshot).
   * @param {string} canonicalSmiles - Canonical SMILES for the stored molecule snapshot.
   */
  constructor(id, molecule, canonicalSmiles = null) {
    this.id = id;
    this.molecule = molecule;
    this.canonicalSmiles = canonicalSmiles;
    /** @type {string[]} Array of ReactionNode IDs where this molecule is a reactant */
    this.consumedIn = [];
    /** @type {string[]} Array of ReactionNode IDs where this molecule is a product */
    this.producedBy = [];
  }
}
