/** @module algorithms/subgraph */

// ---------------------------------------------------------------------------
// Atom / bond compatibility predicates for VF2 subgraph matching
// ---------------------------------------------------------------------------

/**
 * Default atom match: element symbol, formal charge, aromaticity, and
 * explicit radical count must all be equal.
 *
 * @param {import('../core/Atom.js').Atom} qAtom  Query atom.
 * @param {import('../core/Atom.js').Atom} tAtom  Target atom.
 * @returns {boolean}
 */
export function defaultAtomMatch(qAtom, tAtom) {
  if (qAtom.name !== tAtom.name) {
    return false;
  }
  if (qAtom.getCharge() !== tAtom.getCharge()) {
    return false;
  }
  if (qAtom.isAromatic() !== tAtom.isAromatic()) {
    return false;
  }
  if (qAtom.getRadical() !== tAtom.getRadical()) {
    return false;
  }
  return true;
}

/**
 * Default bond match: aromatic flag and bond order must be equal.
 * Aromatic bonds (aromatic === true) are compared on aromaticity alone;
 * their stored order (1.5) is not compared separately.
 *
 * @param {import('../core/Bond.js').Bond} qBond  Query bond.
 * @param {import('../core/Bond.js').Bond} tBond  Target bond.
 * @returns {boolean}
 */
export function defaultBondMatch(qBond, tBond) {
  const qAro = qBond.properties.aromatic ?? false;
  const tAro = tBond.properties.aromatic ?? false;
  if (qAro !== tAro) {
    return false;
  }
  if (qAro) {
    return true; // both aromatic — no order comparison needed
  }
  return (qBond.properties.order ?? 1) === (tBond.properties.order ?? 1);
}

/**
 * Wildcard atom match — any atom matches any other atom.
 * Useful as a building block for SMARTS `*` patterns and MCS.
 *
 * @returns {boolean}
 */
export function wildcardAtomMatch(_qAtom, _tAtom) {
  return true;
}

/**
 * Wildcard bond match — any bond matches any other bond.
 * Useful for SMARTS `~` (any bond) and MCS bond-insensitive matching.
 *
 * @returns {boolean}
 */
export function wildcardBondMatch(_qBond, _tBond) {
  return true;
}

/**
 * Element-only atom match — only the element symbol is compared.
 * Charge and aromaticity are ignored.  Intended for MCS where scaffold
 * topology matters but ionisation state does not.
 *
 * @param {import('../core/Atom.js').Atom} qAtom
 * @param {import('../core/Atom.js').Atom} tAtom
 * @returns {boolean}
 */
export function elementOnlyAtomMatch(qAtom, tAtom) {
  return qAtom.name === tAtom.name;
}

/**
 * Creates an atom-match predicate from a set of optional constraints.
 *
 * Supported constraint keys:
 * - `element`  {string}  — element symbol must equal this value
 * - `charge`   {number}  — formal charge must equal this value
 * - `aromatic` {boolean} — aromaticity flag must equal this value
 *
 * Any key that is absent (or `undefined`) is treated as a wildcard for that
 * property.  An empty `constraints` object returns a wildcard matcher.
 *
 * @param {{ element?: string, charge?: number, aromatic?: boolean }} constraints
 * @returns {function(Atom, Atom): boolean}
 */
export function makeAtomMatcher(constraints) {
  return (qAtom, tAtom) => {
    if (constraints.element !== undefined && tAtom.name !== constraints.element) {
      return false;
    }
    if (constraints.charge !== undefined && tAtom.getCharge() !== constraints.charge) {
      return false;
    }
    if (constraints.aromatic !== undefined && tAtom.isAromatic() !== constraints.aromatic) {
      return false;
    }
    return true;
  };
}

/**
 * Creates a bond-match predicate from a set of optional constraints.
 *
 * Supported constraint keys:
 * - `order`    {number}  — bond order must equal this value (ignored when `aromatic` is true)
 * - `aromatic` {boolean} — aromaticity flag must equal this value
 *
 * An empty `constraints` object returns a wildcard matcher.
 *
 * @param {{ order?: number, aromatic?: boolean }} constraints
 * @returns {function(Bond, Bond): boolean}
 */
export function makeBondMatcher(constraints) {
  return (_qBond, tBond) => {
    if (constraints.aromatic !== undefined && (tBond.properties.aromatic ?? false) !== constraints.aromatic) {
      return false;
    }
    if (constraints.order !== undefined && !(tBond.properties.aromatic ?? false) && (tBond.properties.order ?? 1) !== constraints.order) {
      return false;
    }
    return true;
  };
}
