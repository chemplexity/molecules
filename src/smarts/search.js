/** @module smarts/search */

import { parseSMARTS } from './parser.js';
import { findSubgraphMappings } from '../algorithms/vf2.js';

function _flipStereoDir(dir) {
  return dir === '/' ? '\\' : '/';
}

function _bondStereoRelativeTo(bond, atomId) {
  const dir = bond?.properties?.stereo ?? null;
  if (!dir) {
    return null;
  }
  return bond.atoms[0] === atomId ? dir : _flipStereoDir(dir);
}

function _queryStereoConstraints(queryMol) {
  const constraints = [];

  for (const qBond of queryMol.bonds.values()) {
    if ((qBond.properties.order ?? 1) !== 2) {
      continue;
    }

    const infoAt = (sp2Id) => {
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

/**
 * Generator that yields every unique match of `smarts` into `target`.
 *
 * Two mappings are considered duplicates if they cover the same set of target
 * atom IDs (VF2 can return the same atom set multiple times via different
 * traversal orderings, e.g. 12× per ring). Each yielded value is a
 * `Map<queryAtomId, targetAtomId>`.
 *
 * @param {import('../core/Molecule.js').Molecule} target
 * @param {string} smarts
 * @param {object} [options]
 * @param {number} [options.limit=Infinity]
 * @yields {Map<string, string>}
 */
export function* findSMARTS(target, smarts, options = {}) {
  const queryMol = parseSMARTS(smarts);
  const stereoConstraints = _queryStereoConstraints(queryMol);
  const vf2Opts = { ..._vf2Options(queryMol, target), ...options };
  const seen = new Set();
  for (const mapping of findSubgraphMappings(target, queryMol, vf2Opts)) {
    if (!_mappingStereoMatches(queryMol, target, mapping, stereoConstraints)) {
      continue;
    }
    const key = [...mapping.values()].sort().join(',');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    yield mapping;
  }
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
