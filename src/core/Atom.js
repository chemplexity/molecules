/** @module core/Atom */

import { randomUUID } from 'node:crypto';
import elements from '../data/elements.js';

/**
 * Represents an atom (vertex) in a molecular graph.
 *
 * Element-specific data (`charge`, `aromatic`, `protons`, `neutrons`,
 * `electrons`, `group`, `period`) is stored under `properties` to keep the
 * top-level shape minimal and consistent with the Bond / Molecule pattern.
 * `parseSMILES` populates `properties` from the periodic-table data;
 * manually-constructed atoms leave the numeric fields as `undefined` so that
 * `molecularMass` can fall back to the elements table.
 */
export class Atom {
  /** @type {number} Monotonically increasing counter used for auto-generated IDs. */
  static _nextId = 0;

  /**
   * @param {string|null} [id]                              - Unique identifier. Auto-generated as a numeric string when omitted or null.
   * @param {string} name                                   - Element symbol (e.g. 'C', 'N', 'O').
   * @param {object} [properties={}]
   * @param {number}       [properties.charge=0]            - Formal charge.
   * @param {boolean}      [properties.aromatic=false]      - Whether the atom is aromatic.
   * @param {number}       [properties.protons=undefined]   - Atomic number (set by parseSMILES).
   * @param {number}       [properties.neutrons=undefined]  - Neutron count; isotope-adjusted by parseSMILES.
   * @param {number}       [properties.electrons=undefined] - Electron count (set by parseSMILES).
   * @param {number}       [properties.group=0]             - Periodic table group (1–18).
   * @param {number}       [properties.period=0]            - Periodic table period (1–7).
   * @param {'R'|'S'|null} [properties.chirality=null]      - CIP chirality designation: `'R'` (rectus) or `'S'` (sinister); `null` if no chirality annotation or not determinable.
   */
  constructor(id, name, {
    charge    = 0,
    aromatic  = false,
    protons   = undefined,
    neutrons  = undefined,
    electrons = undefined,
    group     = 0,
    period    = 0,
    chirality = null
  } = {}) {
    /** @type {string} Unique identifier for this atom. */
    this.id = id ?? `${++Atom._nextId}`;
    /** @type {string} Universally unique identifier, auto-generated on construction. */
    this.uuid = randomUUID();
    /** @type {string} Element symbol. */
    this.name = name;
    /** @type {Array} Arbitrary tags for application use. */
    this.tags = [];
    /** @type {string[]} Bond IDs connected to this atom. */
    this.bonds = [];
    /** @type {number|null} X coordinate in Å; `null` until `generateCoords` is called. */
    this.x = null;
    /** @type {number|null} Y coordinate in Å; `null` until `generateCoords` is called. */
    this.y = null;
    /** @type {number|null} Z coordinate in Å; `null` until `generateCoords` is called. */
    this.z = null;
    /** @type {boolean} Whether the atom should be shown in 2D rendering. Defaults to true. */
    this.visible = true;
    /** @type {{charge: number, aromatic: boolean, protons: number|undefined, neutrons: number|undefined, electrons: number|undefined, group: number, period: number, chirality: 'R'|'S'|null, hybridization: 'sp'|'sp2'|'sp3'|null}} Chemistry-specific element data. */
    this.properties = { charge, aromatic, protons, neutrons, electrons, group, period, chirality, hybridization: null };
  }

  /**
   * Returns the explicit formal charge stored on this atom.
   * Convenience accessor for `this.properties.charge`.
   *
   * @returns {number}
   */
  getCharge() {
    return this.properties.charge;
  }

  /**
   * Sets the formal charge and derives the electron count as
   * `electrons = protons − charge`.
   * If `protons` is not yet set (manually-built atom), `electrons` is left
   * unchanged.
   *
   * @param {number} charge - The new formal charge.
   * @returns {this} The atom instance, for chaining.
   */
  setCharge(charge) {
    if (this.properties.protons !== undefined && this.properties.protons - charge < 0) {
      throw new RangeError(
        `Charge ${charge} would result in negative electron count for ${this.name} (protons: ${this.properties.protons}).`
      );
    }
    this.properties.charge = charge;
    if (this.properties.protons !== undefined) {
      this.properties.electrons = this.properties.protons - charge;
    }
    return this;
  }

  /**
   * Computes the formal charge from element identity and total bond order,
   * using the same valence logic as the v1 SMILES implicit-hydrogen algorithm.
   *
   * - Groups 1–2  (s-block): neutral valence = group (H forms 1 bond, Be forms 2, …)
   * - Groups 3–12 (transition metals): returns 0 (valence is too variable)
   * - Groups 13–18 (p-block): neutral valence = 18 − group (B=3, C=4, N=3, O=2, F=1, …)
   *
   * `formal charge = totalBondOrder − neutral valence`
   *
   * Returns 0 when `group` is not set.
   *
   * @param {number} [totalBondOrder=0] - Sum of all bond orders on this atom.
   * @returns {number}
   */
  computeCharge(totalBondOrder = 0) {
    const group = this.properties.group;
    if (!group) {
      return 0;
    }
    if (group <= 2)  {
      return totalBondOrder - group;
    }   // s-block (H=1, Be=2 …)
    if (group <= 12) {
      return 0;
    }                        // transition metals
    return totalBondOrder - (18 - group);             // p-block
  }

  /**
   * Looks up `this.name` in the periodic-table data and assigns `group`,
   * `period`, `protons`, `neutrons`, and `electrons` to `this.properties`.
   * No-ops silently if the element symbol is not found in the table.
   *
   * @returns {this} The atom instance, for chaining.
   */
  resolveElement() {
    const el = elements[this.name];
    if (!el) {
      return this;
    }
    this.properties.group     = el.group;
    this.properties.period    = el.period;
    this.properties.protons   = el.protons;
    this.properties.neutrons  = el.neutrons;
    this.properties.electrons = el.electrons;
    return this;
  }

  /**
   * Returns the sum of all bond orders on this atom (total bond order / valence used).
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {number}
   */
  getValence(molecule) {
    return this.bonds.reduce((sum, bondId) => {
      return sum + (molecule.bonds.get(bondId)?.properties.order ?? 1);
    }, 0);
  }

  /**
   * Returns `true` when this atom's current bond order meets or exceeds its
   * neutral valence (i.e. no unsatisfied valence remaining).
   *
   * Uses the same group-based valence rules as `_adjustImplicitHydrogens`:
   * groups 1–2 → valence = group; groups 13–17 → valence = 18 − group.
   * Returns `true` for transition metals, noble gases, and unknown elements.
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {boolean}
   */
  isSaturated(molecule) {
    const el = elements[this.name];
    if (!el) {
      return true;
    }
    const { group } = el;
    let neutralValence;
    if (group >= 1 && group <= 2)        {
      neutralValence = group;
    } else if (group >= 13 && group <= 17) {
      neutralValence = 18 - group;
    } else {
      return true;
    }
    return this.getValence(molecule) >= neutralValence;
  }

  /**
   * Returns the number of implicit hydrogen atoms this atom would bear given
   * its current bonding, without mutating the molecule.
   *
   * Counts only non-H bond order toward the neutral valence; pendant H atoms
   * already attached are not counted as implicit.
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {number}
   */
  implicitHydrogenCount(molecule) {
    const el = elements[this.name];
    if (!el) {
      return 0;
    }
    const { group } = el;
    let valence;
    if (group >= 1 && group <= 2)        {
      valence = group;
    } else if (group >= 13 && group <= 17) {
      valence = 18 - group;
    } else {
      return 0;
    }
    return Math.max(0, valence - this.getValence(molecule));
  }

  /**
   * Returns all heavy-atom (non-hydrogen) neighbours of this atom.
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {Atom[]}
   */
  getHeavyNeighbors(molecule) {
    return this.bonds
      .map(bId => {
        const b = molecule.bonds.get(bId);
        if (!b) {
          return null;
        }
        return molecule.atoms.get(b.getOtherAtom(this.id));
      })
      .filter(a => a && a.name !== 'H');
  }

  /**
   * Returns all neighbouring `Atom` instances of this atom.
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {Atom[]}
   */
  getNeighbors(molecule) {
    return this.bonds
      .map(bId => {
        const b = molecule.bonds.get(bId);
        if (!b) {
          return null;
        }
        return molecule.atoms.get(b.getOtherAtom(this.id));
      })
      .filter(Boolean);
  }

  /**
   * Returns the degree (number of bonds) of this atom.
   *
   * @returns {number}
   */
  getDegree() {
    return this.bonds.length;
  }

  /**
   * Returns `true` when this atom has exactly one bond (i.e. it is a leaf
   * node in the molecular graph).
   *
   * @returns {boolean}
   */
  isTerminal() {
    return this.bonds.length === 1;
  }

  /**
   * Returns all hydrogen neighbours of this atom.
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {Atom[]}
   */
  getHydrogenNeighbors(molecule) {
    return this.bonds
      .map(bId => {
        const b = molecule.bonds.get(bId);
        if (!b) {
          return null;
        }
        return molecule.atoms.get(b.getOtherAtom(this.id));
      })
      .filter(a => a?.name === 'H');
  }

  /**
   * Returns the CIP chirality designation stored on this atom: `'R'`, `'S'`, or `null`.
   *
   * @returns {'R'|'S'|null}
   */
  getChirality() {
    return this.properties.chirality;
  }

  /**
   * Sets the CIP chirality designation on this atom.
   *
   * When `molecule` is provided, setting `'R'` or `'S'` is only permitted if
   * the atom passes the full tetrahedral chiral-centre test
   * (`isChiralCenter(molecule)`).  Passing `null` to clear the designation is
   * always allowed regardless of eligibility.
   *
   * @param {'R'|'S'|null} value    - CIP designation, or `null` to clear.
   * @param {import('./Molecule.js').Molecule} [molecule] - Host molecule used
   *   for the eligibility check.  Omit to skip the check (existing behaviour).
   * @returns {this} The atom instance, for chaining.
   * @throws {RangeError} If `value` is not `'R'`, `'S'`, or `null`.
   * @throws {Error}      If `value` is `'R'`/`'S'`, `molecule` is provided,
   *   and the atom is not a tetrahedral chiral centre.
   */
  setChirality(value, molecule) {
    if (value !== 'R' && value !== 'S' && value !== null) {
      throw new RangeError(`chirality must be 'R', 'S', or null, got ${JSON.stringify(value)}`);
    }
    if (value !== null && molecule && !_isTetrahedralCenter(this, molecule)) {
      throw new Error(`atom '${this.id}' is not a tetrahedral chiral centre`);
    }
    this.properties.chirality = value;
    return this;
  }

  /**
   * Returns `true` when this atom is a tetrahedral chiral centre.
   *
   * **Without** `molecule` — returns `true` when a CIP designation (`'R'` or
   * `'S'`) has already been stored on `properties.chirality` (e.g. by
   * `parseSMILES`).
   *
   * **With** `molecule` — performs a full graph-based test regardless of
   * whether chirality has been annotated:
   *   1. The atom must be sp3-like (no double/triple/aromatic bonds).
   *   2. It must have exactly 4 explicit substituents (counting H atoms).
   *   3. All 4 CIP priority subtrees must be pairwise distinct.
   *
   * For best results pass a molecule where hydrogens are explicit (as returned
   * directly by `parseSMILES`).
   *
   * @param {import('./Molecule.js').Molecule} [molecule]
   * @returns {boolean}
   */
  isChiralCenter(molecule) {
    if (!molecule) {
      return this.properties.chirality === 'R' || this.properties.chirality === 'S';
    }
    return _isTetrahedralCenter(this, molecule);
  }

  /**
   * Tests whether this atom is part of a ring (cycle) in the molecular graph.
   *
   * Uses a vertex-cut check: this atom is excluded from traversal, then a BFS
   * is run from one neighbour. If any other neighbour is reachable, the atom
   * lies on at least one cycle.
   *
   * @param {import('./Molecule.js').Molecule} molecule
   * @returns {boolean}
   */
  isInRing(molecule) {

    if (this.bonds.length < 2) {
      return false;
    }
    const id = this.id;
    // Exclude H (always terminal) so they don't produce false negatives.
    const neighborIds = this.bonds
      .map(bId => molecule.bonds.get(bId)?.getOtherAtom(id))
      .filter(nId => {
        if (!nId) {
          return false;
        }
        const a = molecule.atoms.get(nId);
        return a && a.name !== 'H';
      });
    if (neighborIds.length < 2) {
      return false;
    }

    // For each neighbor, BFS to see if any OTHER neighbor is reachable
    // without going back through this atom.  Using every neighbor as a
    // potential source handles pendant non-H substituents (e.g. C=O on a
    // ring carbon) that would dead-end if chosen as the lone root.
    for (let i = 0; i < neighborIds.length; i++) {
      const src     = neighborIds[i];
      const targets = new Set(neighborIds.filter((_, j) => j !== i));
      const visited = new Set([id, src]);
      const queue   = [src];

      while (queue.length > 0) {
        const current     = queue.shift();
        const currentAtom = molecule.atoms.get(current);
        if (!currentAtom) {
          continue;
        }
        for (const bId of currentAtom.bonds) {
          const b = molecule.bonds.get(bId);
          if (!b) {
            continue;
          }
          const next = b.getOtherAtom(current);
          if (targets.has(next)) {
            return true;
          }
          if (!visited.has(next)) {
            visited.add(next); queue.push(next);
          }
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Private helpers for isChiralCenter(molecule)
// ---------------------------------------------------------------------------

/**
 * CIP priority key for an atom: Z * 1000 + round(massNumber).
 * Mirrors the identical function in Molecule.js; duplicated here to avoid a
 * circular import (Molecule.js already imports Atom.js).
 */
function _cipZ(atomId, mol) {
  const atom = mol.atoms.get(atomId);
  if (!atom) {
    return 0;
  }
  const p  = atom.properties;
  const el = elements[atom.name];
  const Z  = p.protons  ?? el?.protons  ?? 0;
  const N  = p.neutrons ?? el?.neutrons ?? Z;
  return Z * 1000 + Math.round(Z + N);
}

/**
 * Builds a CIP priority hierarchy for the substituent subtree rooted at
 * `startId`, treating `excludeId` (the chiral centre) as the boundary.
 * Multiple bonds contribute phantom duplicate atoms per the CIP rules.
 */
function _cipHierarchy(startId, excludeId, mol, maxDepth = 10) {
  const result   = [[_cipZ(startId, mol)]];
  let frontier   = [{ id: startId, parentId: excludeId }];
  const visited  = new Set([excludeId, startId]);

  for (let depth = 0; depth < maxDepth; depth++) {
    const levelZ      = [];
    const nextFrontier = [];

    for (const { id, parentId } of frontier) {
      const atom = mol.atoms.get(id);
      if (!atom) {
        continue;
      }
      // Phantom atoms from the bond back to the parent (for multiple bonds).
      for (const bId of atom.bonds) {
        const b = mol.bonds.get(bId);
        if (!b || b.getOtherAtom(id) !== parentId) {
          continue;
        }
        const order = Math.round(b.properties.order ?? 1);
        const pZ    = _cipZ(parentId, mol);
        for (let p = 1; p < order; p++) {
          levelZ.push(pZ);
        }
        break;
      }
      // Real neighbours + phantom atoms for multiple bonds.
      for (const bId of atom.bonds) {
        const b = mol.bonds.get(bId);
        if (!b) {
          continue;
        }
        const otherId = b.getOtherAtom(id);
        if (otherId === parentId) {
          continue;
        }
        const order = Math.round(b.properties.order ?? 1);
        const oZ    = _cipZ(otherId, mol);
        levelZ.push(oZ);
        for (let p = 1; p < order; p++) {
          levelZ.push(oZ);
        }
        if (!visited.has(otherId)) {
          visited.add(otherId);
          nextFrontier.push({ id: otherId, parentId: id });
        }
      }
    }

    if (levelZ.length === 0) {
      break;
    }
    levelZ.sort((a, b) => b - a);
    result.push(levelZ);
    frontier = nextFrontier;
  }

  return result;
}

/**
 * Returns `true` when the two CIP hierarchy arrays represent identical
 * priority subtrees (i.e. the two substituents are indistinguishable by CIP).
 */
function _cipEqual(a, b) {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const ai = a[i] ?? [];
    const bi = b[i] ?? [];
    const maxItems = Math.max(ai.length, bi.length);
    for (let j = 0; j < maxItems; j++) {
      if ((ai[j] ?? 0) !== (bi[j] ?? 0)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Returns `true` when `atom` qualifies as a tetrahedral chiral centre in
 * `mol` based on graph topology and CIP priority analysis.
 */
function _isTetrahedralCenter(atom, mol) {
  // Must be sp3: no aromatic flag and all bonds must be single-order.
  if (atom.properties.aromatic) {
    return false;
  }
  for (const bId of atom.bonds) {
    const b = mol.bonds.get(bId);
    if (!b) {
      continue;
    }
    if ((b.properties.order ?? 1) !== 1 || (b.properties.aromatic ?? false)) {
      return false;
    }
  }

  // Collect all explicit neighbour IDs (including H).
  const neighborIds = [];
  for (const bId of atom.bonds) {
    const b = mol.bonds.get(bId);
    if (!b) {
      continue;
    }
    const nbId = b.getOtherAtom(atom.id);
    if (nbId && mol.atoms.has(nbId)) {
      neighborIds.push(nbId);
    }
  }

  // Exactly 4 substituents required.
  if (neighborIds.length !== 4) {
    return false;
  }

  // Two or more identical H atoms → guaranteed duplicate priority.
  const hCount = neighborIds.filter(id => mol.atoms.get(id)?.name === 'H').length;
  if (hCount >= 2) {
    return false;
  }

  // All 4 CIP subtrees must be pairwise distinct.
  const hierarchies = neighborIds.map(nbId => _cipHierarchy(nbId, atom.id, mol));
  for (let i = 0; i < hierarchies.length; i++) {
    for (let j = i + 1; j < hierarchies.length; j++) {
      if (_cipEqual(hierarchies[i], hierarchies[j])) {
        return false;
      }
    }
  }

  return true;
}
