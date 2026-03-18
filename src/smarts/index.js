/** @module smarts */

export { parseSMARTS } from './parser.js';
export { compileAtomExpr, compileBondToken, defaultSmartsBondPred } from './primitives.js';
export { functionalGroups } from './reference.js';

import { parseSMARTS } from './parser.js';
import { findSubgraphMappings } from '../algorithms/vf2.js';

// ---------------------------------------------------------------------------
// Internal: build VF2 options for a SMARTS query
// ---------------------------------------------------------------------------

/**
 * Creates the `atomMatch` and `bondMatch` closures that wire a parsed SMARTS
 * query molecule into the VF2 engine.
 *
 * Each atom in `queryMol` must have a `_predicate(tAtom, targetMol) → boolean`
 * property.  Each bond must have a `_predicate(tBond) → boolean` property.
 *
 * @param {import('../core/Molecule.js').Molecule} queryMol
 * @param {import('../core/Molecule.js').Molecule} target
 * @returns {{ atomMatch: function, bondMatch: function, skipElementFilter: true }}
 */
function _vf2Options(queryMol, target) {
  return {
    atomMatch: (qAtom, tAtom) => qAtom._predicate(tAtom, target),
    bondMatch: (qBond, tBond) => qBond._predicate(tBond, target),
    skipElementFilter: true
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generator that yields every injective mapping from `smarts` query atoms
 * into `target` atoms that satisfies the SMARTS predicates.
 *
 * Each yielded value is a `Map<queryAtomId, targetAtomId>`.
 *
 * @param {import('../core/Molecule.js').Molecule} target
 * @param {string} smarts
 * @param {object} [options]
 * @param {number} [options.limit=Infinity]
 * @yields {Map<string, string>}
 */
export function* findSMARTS(target, smarts, options = {}) {
  const queryMol = parseSMARTS(smarts);
  const vf2Opts = { ..._vf2Options(queryMol, target), ...options };
  yield* findSubgraphMappings(target, queryMol, vf2Opts);
}

/**
 * Returns the first mapping from `smarts` into `target`, or `null` if none.
 *
 * @param {import('../core/Molecule.js').Molecule} target
 * @param {string} smarts
 * @param {object} [options]
 * @returns {Map<string, string>|null}
 */
export function firstSMARTS(target, smarts, options = {}) {
  for (const m of findSMARTS(target, smarts, { ...options, limit: 1 })) {
    return m;
  }
  return null;
}

/**
 * Returns `true` if `smarts` matches some subgraph of `target`.
 *
 * @param {import('../core/Molecule.js').Molecule} target
 * @param {string} smarts
 * @param {object} [options]
 * @returns {boolean}
 */
export function matchesSMARTS(target, smarts, options = {}) {
  return firstSMARTS(target, smarts, options) !== null;
}
