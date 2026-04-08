/** @module smarts/search */

import { parseSMARTS } from './parser.js';
import { findSubgraphMappings } from '../algorithms/vf2.js';

/**
 * Flips a SMILES directional-bond marker: `'/'` ↔ `'\\'`.
 * @param {'/'|'\\'} dir - The dir value.
 * @returns {'/'|'\\'} The computed result.
 */
function _flipStereoDir(dir) {
  return dir === '/' ? '\\' : '/';
}

/**
 * Returns the stereo direction of `bond` as seen from `atomId`.
 * The stored direction is defined relative to `bond.atoms[0]`; if `atomId`
 * is `bond.atoms[1]` the direction is flipped.
 * @param {import('../core/Bond.js').Bond|undefined} bond - The bond object.
 * @param {string} atomId - The atom ID.
 * @returns {'/'|'\\'|null} The computed result.
 */
function _bondStereoRelativeTo(bond, atomId) {
  const dir = bond?.properties?.stereo ?? null;
  if (!dir) {
    return null;
  }
  return bond.atoms[0] === atomId ? dir : _flipStereoDir(dir);
}

/**
 * Extracts E/Z stereo constraints from a parsed SMARTS query molecule.
 *
 * For each double bond in `queryMol` that has directional (`/`/`\\`) bonds
 * on both sp2 ends, records whether the two marked substituents should be on
 * the same or opposite sides of the double bond (`'same'` → Z, `'opposite'`
 * → E by SMILES convention).
 * @param {import('../core/Molecule.js').Molecule} queryMol - Query molecule for subgraph matching.
 * @returns {Array<{
 *   qDoubleBondId: string,
 *   qA: string, qB: string,
 *   qMarkedA: string, qMarkedB: string,
 *   relation: 'same'|'opposite'
 * }>} Array of results.
 */
function _queryStereoConstraints(queryMol) {
  const constraints = [];

  for (const qBond of queryMol.bonds.values()) {
    if ((qBond.properties.order ?? 1) !== 2) {
      continue;
    }

    const infoAt = sp2Id => {
      const atom = queryMol.atoms.get(sp2Id);
      if (!atom) {
        return null;
      }
      for (const bId of atom.bonds) {
        if (bId === qBond.id) {
          continue;
        }
        const b = queryMol.bonds.get(bId);
        if (!b || !b.properties.stereo) {
          continue;
        }
        return {
          markedId: b.getOtherAtom(sp2Id),
          dir: _bondStereoRelativeTo(b, sp2Id)
        };
      }
      return null;
    };

    const [qA, qB] = qBond.atoms;
    const infoA = infoAt(qA);
    const infoB = infoAt(qB);
    if (!infoA || !infoB) {
      continue;
    }

    constraints.push({
      qDoubleBondId: qBond.id,
      qA,
      qB,
      qMarkedA: infoA.markedId,
      qMarkedB: infoB.markedId,
      relation: infoA.dir === infoB.dir ? 'same' : 'opposite'
    });
  }

  return constraints;
}

/**
 * Returns `true` when the E/Z stereo `constraints` derived from the query
 * are all satisfied by the current `mapping` into `target`.
 * @param {import('../core/Molecule.js').Molecule} queryMol - Query molecule for subgraph matching.
 * @param {import('../core/Molecule.js').Molecule} target - The target structure.
 * @param {Map<string,string>} mapping - Query → target atom ID map.
 * @param {ReturnType<typeof _queryStereoConstraints>} constraints - Layout constraint set.
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
function _mappingStereoMatches(queryMol, target, mapping, constraints) {
  if (constraints.length === 0) {
    return true;
  }

  for (const constraint of constraints) {
    const tA = mapping.get(constraint.qA);
    const tB = mapping.get(constraint.qB);
    const tMarkedA = mapping.get(constraint.qMarkedA);
    const tMarkedB = mapping.get(constraint.qMarkedB);
    if (!tA || !tB || !tMarkedA || !tMarkedB) {
      return false;
    }

    const tDouble = target.getBond(tA, tB);
    const tStereoA = target.getBond(tA, tMarkedA);
    const tStereoB = target.getBond(tB, tMarkedB);
    if (!tDouble || (tDouble.properties.order ?? 1) !== 2 || !tStereoA || !tStereoB) {
      return false;
    }

    const dirA = _bondStereoRelativeTo(tStereoA, tA);
    const dirB = _bondStereoRelativeTo(tStereoB, tB);
    if (!dirA || !dirB) {
      return false;
    }

    const relation = dirA === dirB ? 'same' : 'opposite';
    if (relation !== constraint.relation) {
      return false;
    }
  }

  return true;
}

/**
 * Creates the `atomMatch` and `bondMatch` closures that wire a parsed SMARTS
 * query molecule into the VF2 engine.
 *
 * Each atom in `queryMol` must have a `_predicate(tAtom, targetMol) → boolean`
 * property.  Each bond must have a `_predicate(tBond) → boolean` property.
 * @param {import('../core/Molecule.js').Molecule} queryMol - Query molecule for subgraph matching.
 * @param {import('../core/Molecule.js').Molecule} target - The target structure.
 * @returns {{ atomMatch: (qAtom: import('../core/Atom.js').Atom, tAtom: import('../core/Atom.js').Atom) => boolean, bondMatch: (qBond: import('../core/Bond.js').Bond, tBond: import('../core/Bond.js').Bond) => boolean, skipElementFilter: true }} The result object.
 */
function _vf2Options(queryMol, target) {
  return {
    atomMatch: (qAtom, tAtom) => qAtom._predicate(tAtom, target),
    bondMatch: (qBond, tBond) => qBond._predicate(tBond, target),
    skipElementFilter: true
  };
}

/**
 * Produces a sort key for a mapping: an array of target-atom ID strings in
 * query-atom-ID order, used for deterministic mapping ordering.
 * @param {Map<string,string>} mapping - Atom-to-atom mapping (query ID → target ID).
 * @param {string[]} queryAtomIds - The queryAtomIds value.
 * @returns {string[]} Array of results.
 */
function _mappingOrderTuple(mapping, queryAtomIds) {
  return queryAtomIds.map(id => String(mapping.get(id) ?? ''));
}

/**
 * Comparator for sorting mappings by their `_mappingOrderTuple`.
 * Returns negative / 0 / positive like `Array.prototype.sort`.
 * @param {Map<string,string>} a - First value or atom.
 * @param {Map<string,string>} b - Second value or atom.
 * @param {string[]} queryAtomIds - The queryAtomIds value.
 * @returns {number} The computed numeric value.
 */
function _compareMappingOrder(a, b, queryAtomIds) {
  const tupleA = _mappingOrderTuple(a, queryAtomIds);
  const tupleB = _mappingOrderTuple(b, queryAtomIds);
  const limit = Math.max(tupleA.length, tupleB.length);
  for (let i = 0; i < limit; i++) {
    const cmp = tupleA[i].localeCompare(tupleB[i]);
    if (cmp !== 0) {
      return cmp;
    }
  }
  return 0;
}

/**
 * Internal generator that runs a parsed SMARTS query molecule against
 * `target` via VF2, applies stereo filtering, sorts results deterministically,
 * and optionally deduplicates mappings by covered atom set.
 *
 * Exported for use by `smirks/apply.js` (which needs raw, non-deduplicated
 * results).  Prefer the public `findSMARTS` / `findSMARTSRaw` APIs instead.
 * @param {import('../core/Molecule.js').Molecule} target - The target structure.
 * @param {import('../core/Molecule.js').Molecule} queryMol - Pre-parsed SMARTS molecule.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.limit] - Maximum number of results.
 * @param {{ dedupe?: boolean }} [internalOptions] - The internalOptions value.
 * @yields {Map<string,string>}
 */
function* _findSMARTSParsed(target, queryMol, options = {}, { dedupe = true } = {}) {
  const stereoConstraints = _queryStereoConstraints(queryMol);
  const { limit, ...restOptions } = options ?? {};
  const vf2Opts = { ..._vf2Options(queryMol, target), ...restOptions };
  const queryAtomIds = [...queryMol.atoms.keys()];
  const matches = [];
  for (const mapping of findSubgraphMappings(target, queryMol, vf2Opts)) {
    if (!_mappingStereoMatches(queryMol, target, mapping, stereoConstraints)) {
      continue;
    }
    matches.push(mapping);
  }

  matches.sort((a, b) => _compareMappingOrder(a, b, queryAtomIds));

  const seen = dedupe ? new Set() : null;
  let yielded = 0;
  const max = Number.isFinite(limit) ? limit : Infinity;
  for (const mapping of matches) {
    if (dedupe) {
      const key = [...mapping.values()].sort().join(',');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    yield mapping;
    yielded++;
    if (yielded >= max) {
      return;
    }
  }
}

/**
 * Generator that yields every unique match of `smarts` into `target`.
 *
 * Two mappings are considered duplicates if they cover the same set of target
 * atom IDs (VF2 can return the same atom set multiple times via different
 * traversal orderings, e.g. 12× per ring). Each yielded value is a
 * `Map<queryAtomId, targetAtomId>`.
 * @param {import('../core/Molecule.js').Molecule} target - The target structure.
 * @param {string} smarts - SMARTS pattern string.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.limit] - Maximum number of results.
 * @yields {Map<string, string>}
 */
export function* findSMARTS(target, smarts, options = {}) {
  const queryMol = parseSMARTS(smarts);
  yield* _findSMARTSParsed(target, queryMol, options, { dedupe: true });
}

/**
 * Generator that yields every raw mapping of `smarts` into `target`, without
 * deduping by the set of matched target atoms.
 *
 * This preserves the exact query-atom-to-target-atom embeddings returned by VF2,
 * which is useful for transform languages such as SMIRKS where different
 * embeddings over the same atom set can lead to different products.
 * @param {import('../core/Molecule.js').Molecule} target - The target structure.
 * @param {string} smarts - SMARTS pattern string.
 * @param {object} [options] - Configuration options.
 * @yields {Map<string, string>}
 */
export function* findSMARTSRaw(target, smarts, options = {}) {
  const queryMol = parseSMARTS(smarts);
  yield* _findSMARTSParsed(target, queryMol, options, { dedupe: false });
}

/**
 * Returns the first mapping from `smarts` into `target`, or `null` if none.
 * @param {import('../core/Molecule.js').Molecule} target - The target structure.
 * @param {string} smarts - SMARTS pattern string.
 * @param {object} [options] - Configuration options.
 * @returns {Map<string, string>|null} The resulting map.
 */
export function firstSMARTS(target, smarts, options = {}) {
  for (const m of findSMARTS(target, smarts, { ...options, limit: 1 })) {
    return m;
  }
  return null;
}

/**
 * Returns the first raw mapping from `smarts` into `target`, or `null` if none.
 * @param {import('../core/Molecule.js').Molecule} target - The target structure.
 * @param {string} smarts - SMARTS pattern string.
 * @param {object} [options] - Configuration options.
 * @returns {Map<string, string>|null} The resulting map.
 */
export function firstSMARTSRaw(target, smarts, options = {}) {
  for (const m of findSMARTSRaw(target, smarts, { ...options, limit: 1 })) {
    return m;
  }
  return null;
}

export { _findSMARTSParsed };

/**
 * Returns `true` if `smarts` matches some subgraph of `target`.
 * @param {import('../core/Molecule.js').Molecule} target - The target structure.
 * @param {string} smarts - SMARTS pattern string.
 * @param {object} [options] - Configuration options.
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
export function matchesSMARTS(target, smarts, options = {}) {
  return firstSMARTS(target, smarts, options) !== null;
}
