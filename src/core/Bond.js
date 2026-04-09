/** @module core/Bond */

import { randomUUID } from 'node:crypto';

/** @typedef {'covalent'|'dative'|'coordinate'|'ionic'|'haptic'|'unknown'} BondKind */

// ---------------------------------------------------------------------------
// Element-set constants (module-level to avoid repeated inline allocations)
// ---------------------------------------------------------------------------

/** Atoms that can serve as a carbonyl-like centre (C=O, C=S, S=O, P=O, …). */
const _CARBONYL_CENTERS = new Set(['C', 'S', 'P']);

/** Heteroatoms that can receive a multiple bond from a carbonyl-like centre. */
const _HETEROATOMS = new Set(['O', 'N', 'S', 'P']);

/** Supported semantic bond kinds. */
export const BOND_KINDS = Object.freeze(['covalent', 'dative', 'coordinate', 'ionic', 'haptic', 'unknown']);

const _VALID_BOND_KINDS = new Set(BOND_KINDS);

/**
 * Represents a bond (edge) in a molecular graph.
 *
 * Bond attributes (`order`, `aromatic`, `stereo`, `kind`) live under `properties` for a
 * consistent shape across Atom, Bond and Molecule.
 */
export class Bond {
  /** @type {number} Monotonically increasing counter used for auto-generated IDs. */
  static _nextId = 0;

  /**
   * @param {string|null} [id]  - Unique identifier. Auto-generated as a numeric string when omitted or null.
   * @param {[string, string]} atoms - IDs of the two connected atoms.
   * @param {object} [properties] - Property map.
   * @param {number} [properties.order] - Bond order. Integer localized bonds use 1/2/3/4;
   *   aromatic bonds may also use 1.5 as a resonance-averaged order.
   * @param {boolean} [properties.aromatic] - Whether the bond is aromatic.
   * @param {BondKind} [properties.kind] - Semantic bond kind. This is intentionally
   *   separate from `order` so coordinate and organometallic bonds can be modeled
   *   without overloading localized covalent bond orders.
   * @param {string|null} [properties.stereo] - SMILES directional-bond marker: `'/'`
   *   or `'\\'`. `atoms[0]` is the source and `atoms[1]` the target as written in SMILES.
   *   `'/'` means traversal src→tgt goes upward; `'\\'` means downward. E/Z designation is
   *   derived by `Molecule.getEZStereo()`, not stored here directly.
   * @param {{as?: 'wedge'|'dash', centerId?: string, manual?: boolean}|undefined} [properties.display] - The properties.display value.
   *   Optional renderer-facing display override metadata. Used by the 2D renderer to persist
   *   which bond should be drawn as a wedge or dash for a surviving stereocenter.
   */
  constructor(id, atoms, { order = 1, aromatic = false, kind = 'covalent', stereo = null, display = undefined } = {}) {
    /** @type {string} */
    this.id = id ?? `${++Bond._nextId}`;
    /** @type {string} Universally unique identifier, auto-generated on construction. */
    this.uuid = randomUUID();
    /** @type {[string, string]} */
    this.atoms = atoms;
    /** @type {Array} Arbitrary tags for application use. */
    this.tags = [];
    /** @type {{order: number, aromatic: boolean, kind: BondKind, stereo: string|null, display?: {as?: 'wedge'|'dash', centerId?: string, manual?: boolean}}} */
    this.properties = { order, aromatic, kind: Bond._normalizeKind(kind), stereo, ...(display !== undefined ? { display } : {}) };
  }

  /**
   * Normalizes and validates a semantic bond kind.
   * @private
   * @param {BondKind} kind - Semantic bond kind.
   * @returns {BondKind} The validated kind.
   */
  static _normalizeKind(kind) {
    if (!_VALID_BOND_KINDS.has(kind)) {
      throw new RangeError(`Bond kind must be one of ${BOND_KINDS.join(', ')}, got ${JSON.stringify(kind)}.`);
    }
    return kind;
  }

  /**
   * Returns the bond order.
   * Convenience accessor for `this.properties.order`.
   * @returns {number} The computed numeric value.
   */
  getOrder() {
    return this.properties.order;
  }

  /**
   * Returns the semantic bond kind.
   * Convenience accessor for `this.properties.kind`.
   * @returns {BondKind} The computed value.
   */
  getKind() {
    return this.properties.kind ?? 'covalent';
  }

  /**
   * Given one atom ID that participates in this bond, returns the other.
   * Returns `null` if `atomId` is not one of the bond's atoms.
   * @param {string} atomId - The atom ID.
   * @returns {string|null} The result string, or `null` if not applicable.
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
   * @param {string} atomA - First atom.
   * @param {string} atomB - Second atom.
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  connects(atomA, atomB) {
    return (this.atoms[0] === atomA && this.atoms[1] === atomB) || (this.atoms[0] === atomB && this.atoms[1] === atomA);
  }

  /**
   * Returns `true` if `atomId` is one of the two atoms in this bond.
   * @param {string} atomId - The atom ID.
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  bondedTo(atomId) {
    return this.atoms[0] === atomId || this.atoms[1] === atomId;
  }

  /**
   * Returns the nominal pi-bond contribution of this bond: `order - 1`.
   * Examples: single bonds return 0, double bonds 1, triple bonds 2,
   * and aromatic 1.5-order bonds return 0.5.
   * @returns {number} The computed numeric value.
   */
  getPiOrder() {
    return (this.properties.order ?? 1) - 1;
  }

  /**
   * Returns the two `Atom` instances connected by this bond.
   * Returns `[null, null]` for either atom that is not found in the molecule.
   * @param {import('./Molecule.js').Molecule} molecule - The molecule graph.
   * @returns {[import('./Atom.js').Atom|null, import('./Atom.js').Atom|null]} The computed result.
   */
  getAtomObjects(molecule) {
    return [molecule.atoms.get(this.atoms[0]) ?? null, molecule.atoms.get(this.atoms[1]) ?? null];
  }

  /**
   * Returns `true` when this bond is part of a ring.
   * A bond is in a ring if and only if both of its endpoint atoms are in a
   * ring AND they share at least two independent paths (detected by temporarily
   * removing this bond and checking reachability).
   * @param {import('./Molecule.js').Molecule} molecule - The molecule graph.
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  isInRing(molecule) {
    const [idA, idB] = this.atoms;
    // BFS from idA to idB through paths that do NOT use this bond.
    const visited = new Set([idA]);
    const queue = [idA];
    let queueHead = 0;
    while (queueHead < queue.length) {
      const current = queue[queueHead++];
      for (const bId of molecule.atoms.get(current)?.bonds ?? []) {
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
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }

  /**
   * Sets the bond order and returns `this` for chaining.
   * Automatically clears the `aromatic` flag when an integer order is set,
   * because an explicit integer order unambiguously describes a localised bond.
   * @param {number} order - New bond order (must be a positive integer).
   * @returns {this} The computed result.
   * @throws {RangeError} If `order` is not a positive integer.
   */
  setOrder(order) {
    if (!Number.isInteger(order) || order < 1) {
      throw new RangeError(`Bond order must be a positive integer, got ${order}.`);
    }
    this.properties.order = order;
    this.properties.aromatic = false;
    return this;
  }

  /**
   * Sets whether this bond is aromatic and returns `this` for chaining.
   *
   * The two fields are kept in sync automatically:
   * - `setAromatic(true)`  sets `order` to `1.5` (resonance-averaged).
   * - `setAromatic(false)` sets `order` to `1`   (single bond).
   * @param {boolean} value - The value.
   * @returns {this} The computed result.
   * @throws {TypeError} If `value` is not a boolean.
   */
  setAromatic(value) {
    if (typeof value !== 'boolean') {
      throw new TypeError(`aromatic must be a boolean, got ${JSON.stringify(value)}`);
    }
    this.properties.aromatic = value;
    this.properties.order = value ? 1.5 : 1;
    return this;
  }

  /**
   * Sets the semantic bond kind and returns `this` for chaining.
   * @param {BondKind} kind - The new semantic bond kind.
   * @returns {this} The computed result.
   */
  setKind(kind) {
    this.properties.kind = Bond._normalizeKind(kind);
    return this;
  }

  /**
   * Returns the directional stereo marker stored on this bond: `'/'`, `'\\'`, or `null`.
   * @returns {'/'|'\\'|null} The computed result.
   */
  getStereo() {
    return this.properties.stereo;
  }

  /**
   * Sets the directional stereo marker on this bond.
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
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  hasStereo() {
    return this.properties.stereo !== null;
  }

  /**
   * Returns `true` when this bond is an ordinary covalent bond.
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  isCovalent() {
    return this.getKind() === 'covalent';
  }

  /**
   * Returns `true` when this bond represents a coordination-style attachment.
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  isCoordinateLike() {
    const kind = this.getKind();
    return kind === 'dative' || kind === 'coordinate' || kind === 'haptic';
  }

  /**
   * Returns `true` when this bond is rotatable by the standard cheminformatics
   * definition used by this codebase: a single, non-aromatic, non-ring bond
   * between two non-terminal heavy atoms, excluding conjugated amide-like bonds.
   *
   * "Non-terminal" means the atom has at least one other heavy-atom neighbor
   * besides the atom it shares this bond with.
   * @param {import('./Molecule.js').Molecule} molecule - The molecule graph.
   * @returns {boolean} `true` if the condition holds, `false` otherwise.
   */
  isRotatable(molecule) {
    if (!this.isCovalent()) {
      return false;
    }
    if ((this.properties.order ?? 1) !== 1) {
      return false;
    }
    if (this.properties.aromatic) {
      return false;
    }
    if (this.isInRing(molecule)) {
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

    const hasOtherHeavy = atomId => {
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

    const isConjugatedAmideLike = () => {
      const endpoints = [
        [atomA, atomB, idA],
        [atomB, atomA, idB]
      ];
      for (const [hetero, center, _heteroId] of endpoints) {
        if (!hetero || !center) {
          continue;
        }
        if (hetero.name !== 'N') {
          continue;
        }
        if (!_CARBONYL_CENTERS.has(center.name)) {
          continue;
        }
        for (const bId of center.bonds) {
          if (bId === this.id) {
            continue;
          }
          const b = molecule.bonds.get(bId);
          if (!b || (b.properties.order ?? 1) < 2) {
            continue;
          }
          const otherId = b.getOtherAtom(center.id);
          const other = molecule.atoms.get(otherId);
          if (other && _HETEROATOMS.has(other.name)) {
            return true;
          }
        }
      }
      return false;
    };

    return hasOtherHeavy(idA) && hasOtherHeavy(idB) && !isConjugatedAmideLike();
  }
}
