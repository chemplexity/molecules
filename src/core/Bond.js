/** @module core/Bond */

import { randomUUID } from 'node:crypto';

/**
 * Represents a bond (edge) in a molecular graph.
 *
 * Bond attributes (`order`, `aromatic`) live under `properties` for a
 * consistent shape across Atom, Bond and Molecule.
 */
export class Bond {
  /** @type {number} Monotonically increasing counter used for auto-generated IDs. */
  static _nextId = 0;

  /**
   * @param {string|null} [id]  - Unique identifier. Auto-generated as a numeric string when omitted or null.
   * @param {[string, string]} atoms - IDs of the two connected atoms.
   * @param {object} [properties={}]
   * @param {number}      [properties.order=1]        - Bond order: 1 (single), 2 (double), 3 (triple), 4 (quadruple).
   * @param {boolean}     [properties.aromatic=false] - Whether the bond is aromatic.
   * @param {string|null} [properties.stereo=null]    - SMILES directional-bond marker: `'/'`
   *   or `'\\'`. `atoms[0]` is the source and `atoms[1]` the target as written in SMILES.
   *   `'/'` means traversal src→tgt goes upward; `'\\'` means downward. E/Z designation is
   *   derived by `Molecule.getEZStereo()`, not stored here directly.
   */
  constructor(id, atoms, { order = 1, aromatic = false, stereo = null } = {}) {
    /** @type {string} */
    this.id = id ?? `${++Bond._nextId}`;
    /** @type {string} Universally unique identifier, auto-generated on construction. */
    this.uuid = randomUUID();
    /** @type {[string, string]} */
    this.atoms = atoms;
    /** @type {Array} Arbitrary tags for application use. */
    this.tags = [];
    /** @type {{order: number, aromatic: boolean, stereo: string|null}} */
    this.properties = { order, aromatic, stereo };
  }

  /**
   * Returns the bond order.
   * Convenience accessor for `this.properties.order`.
   *
   * @returns {number}
   */
  getOrder() {
    return this.properties.order;
  }

  /**
   * Given one atom ID that participates in this bond, returns the other.
   * Returns `null` if `atomId` is not one of the bond's atoms.
   *
   * @param {string} atomId
   * @returns {string|null}
   */
  getOtherAtom(atomId) {
    if (this.atoms[0] === atomId) {
      return this.atoms[1];
    }
    if (this.atoms[1] === atomId) {
      return this.atoms[0];
    }
    return null;
  }

  /**
   * Returns `true` if this bond connects the two given atom IDs (in either order).
   *
   * @param {string} atomA
   * @param {string} atomB
   * @returns {boolean}
   */
  connects(atomA, atomB) {
    return (this.atoms[0] === atomA && this.atoms[1] === atomB) ||
           (this.atoms[0] === atomB && this.atoms[1] === atomA);
  }

  /**
   * Returns `true` if `atomId` is one of the two atoms in this bond.
   *
   * @param {string} atomId
   * @returns {boolean}
   */
  bondedTo(atomId) {
    return this.atoms[0] === atomId || this.atoms[1] === atomId;
  }

  /**
   * Returns the π-bond contribution of this bond: `order − 1`.
   * Single bonds return 0, double bonds 1, triple bonds 2.
   *
   * @returns {number}
   */
  getPiOrder() {
    return (this.properties.order ?? 1) - 1;
  }

  /**
   * Returns the two `Atom` instances connected by this bond.
   * Returns `[null, null]` for either atom that is not found in the molecule.
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {[import('./Atom.js').Atom|null, import('./Atom.js').Atom|null]}
   */
  getAtomObjects(molecule) {
    return [
      molecule.atoms.get(this.atoms[0]) ?? null,
      molecule.atoms.get(this.atoms[1]) ?? null
    ];
  }

  /**
   * Returns `true` when this bond is part of a ring.
   * A bond is in a ring if and only if both of its endpoint atoms are in a
   * ring AND they share at least two independent paths (detected by temporarily
   * removing this bond and checking reachability).
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {boolean}
   */
  isInRing(molecule) {
    const [idA, idB] = this.atoms;
    // BFS from idA to idB through paths that do NOT use this bond.
    const visited = new Set([idA]);
    const queue   = [idA];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const bId of (molecule.atoms.get(current)?.bonds ?? [])) {
        if (bId === this.id) {
          continue;
        } // skip this bond
        const b = molecule.bonds.get(bId);
        if (!b) {
          continue;
        }
        const next = b.getOtherAtom(current);
        if (next === idB) {
          return true;
        }
        if (!visited.has(next)) {
          visited.add(next); queue.push(next);
        }
      }
    }
    return false;
  }

  /**
   * Sets the bond order and returns `this` for chaining.
   *
   * @param {number} order - New bond order (must be a positive integer).
   * @returns {this}
   * @throws {RangeError} If `order` is not a positive integer.
   */
  setOrder(order) {
    if (!Number.isInteger(order) || order < 1) {
      throw new RangeError(`Bond order must be a positive integer, got ${order}.`);
    }
    this.properties.order = order;
    return this;
  }

  /**
   * Returns the directional stereo marker stored on this bond: `'/'`, `'\\'`, or `null`.
   *
   * @returns {'/'|'\\'|null}
   */
  getStereo() {
    return this.properties.stereo;
  }

  /**
   * Sets the directional stereo marker on this bond.
   *
   * @param {'/'|'\\'|null} value - SMILES directional marker, or `null` to clear.
   * @returns {this} The bond instance, for chaining.
   * @throws {RangeError} If `value` is not `'/'`, `'\\'`, or `null`.
   */
  setStereo(value) {
    if (value !== '/' && value !== '\\' && value !== null) {
      throw new RangeError(`stereo must be '/', '\\\\', or null, got ${JSON.stringify(value)}`);
    }
    this.properties.stereo = value;
    return this;
  }

  /**
   * Returns `true` when this bond carries a directional stereo annotation (`'/'` or `'\\'`).
   *
   * @returns {boolean}
   */
  hasStereo() {
    return this.properties.stereo !== null;
  }

  /**
   * Returns `true` when this bond is rotatable by the standard cheminformatics
   * definition: a single, non-aromatic bond between two non-terminal heavy atoms.
   *
   * "Non-terminal" means the atom has at least one other heavy-atom neighbor
   * besides the atom it shares this bond with.
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {boolean}
   */
  isRotatable(molecule) {
    if ((this.properties.order ?? 1) !== 1) {
      return false;
    }
    if (this.properties.aromatic) {
      return false;
    }
    const [idA, idB] = this.atoms;
    const atomA = molecule.atoms.get(idA);
    const atomB = molecule.atoms.get(idB);
    if (!atomA || !atomB) {
      return false;
    }
    if (atomA.name === 'H' || atomB.name === 'H') {
      return false;
    }

    const hasOtherHeavy = (atomId) => {
      const atom = molecule.atoms.get(atomId);
      return atom.bonds.some(bId => {
        if (bId === this.id) {
          return false;
        }
        const b = molecule.bonds.get(bId);
        if (!b) {
          return false;
        }
        const otherId = b.getOtherAtom(atomId);
        const other = molecule.atoms.get(otherId);
        return other && other.name !== 'H';
      });
    };

    return hasOtherHeavy(idA) && hasOtherHeavy(idB);
  }
}
