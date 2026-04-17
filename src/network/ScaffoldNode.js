/** @module network/ScaffoldNode */

/**
 * Represents an aggregated core scaffold in the reaction network.
 * Multiple MoleculeNodes that share the same Murcko scaffold are mapped here.
 */
export class ScaffoldNode {
  /**
   * @param {string} id - Unique identifier for the scaffold node.
   * @param {string|null} smiles - Canonical SMILES of the scaffold. `null` indicates an acyclic/no-scaffold group.
   * @param {import('../core/Molecule.js').Molecule|null} scaffoldMolecule - The molecule instance representing this scaffold.
   */
  constructor(id, smiles, scaffoldMolecule) {
    this.id = id;
    this.smiles = smiles;
    this.molecule = scaffoldMolecule;

    /** @type {string[]} */
    this.moleculeIds = [];

    /** @type {string[]} */
    this.consumedIn = [];

    /** @type {string[]} */
    this.producedBy = [];
  }
}
