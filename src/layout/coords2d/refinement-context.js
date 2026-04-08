/** @module layout/coords2d/refinement-context */

import { vec2 } from './geom2d.js';
import { _layoutNeighbors, _buildLayoutNeighborCache, _layoutCompareAtomIds } from './neighbor-ordering.js';

const DEFAULT_BOND_LENGTH = 1.5;

/**
 * Extracts existing finite 2D coordinates from a molecule's atoms into a Map.
 * @param {object} molecule - Molecule whose atoms are inspected
 * @returns {Map<string, {x: number, y: number}>} Map of atom ID to 2D position
 */
export function readExistingCoords(molecule) {
  const coords = new Map();
  for (const [atomId, atom] of molecule.atoms) {
    if (Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
      coords.set(atomId, vec2(atom.x, atom.y));
    }
  }
  return coords;
}

/**
 * Collects all atoms reachable from startId without crossing blockedId or any frozen atom.
 * @param {object} molecule - The molecule graph
 * @param {string} startId - Atom ID to begin the traversal from
 * @param {string} blockedId - Atom ID that acts as the traversal boundary
 * @param {Set<string>} frozenAtoms - Atom IDs that must not be included
 * @returns {Set<string>|null} Set of atom IDs in the subtree, or null if a frozen atom is encountered
 */
export function collectRefinementSubtree(molecule, startId, blockedId, frozenAtoms) {
  if (frozenAtoms.has(startId)) {
    return null;
  }

  const subtree = new Set();
  const queue = [startId];
  const seen = new Set([blockedId]);
  let queueHead = 0;
  while (queueHead < queue.length) {
    const cur = queue[queueHead++];
    if (seen.has(cur)) {
      continue;
    }
    if (frozenAtoms.has(cur)) {
      return null;
    }
    seen.add(cur);
    subtree.add(cur);
    for (const nb of _layoutNeighbors(molecule, cur)) {
      if (!seen.has(nb)) {
        queue.push(nb);
      }
    }
  }
  return subtree;
}

/**
 * Counts non-hydrogen atoms in a collection of atom IDs.
 * @param {object} molecule - The molecule graph
 * @param {Iterable<string>} atomIds - Atom IDs to inspect
 * @returns {number} Number of heavy (non-H) atoms
 */
export function countHeavyAtoms(molecule, atomIds) {
  let count = 0;
  for (const atomId of atomIds) {
    if (molecule.atoms.get(atomId)?.name !== 'H') {
      count++;
    }
  }
  return count;
}

// Cycle data depends only on molecule topology, so the same molecule object
// always produces the same result. Cache in a WeakMap so the O(bonds × n)
// BFS-per-bond computation runs at most once per molecule reference.
const _cycleDataCache = new WeakMap();

/**
 * Identifies all bonds and atoms that are part of rings in the molecule.
 * @param {object} molecule - The molecule graph
 * @returns {{ ringBondIds: Set<string>, ringAtomIds: Set<string> }} Sets of ring bond and atom IDs
 */
export function collectCycleData(molecule) {
  if (_cycleDataCache.has(molecule)) {
    return _cycleDataCache.get(molecule);
  }
  const ringBondIds = new Set();
  const ringAtomIds = new Set();

  const hasAlternatePath = (startId, endId, excludedBondId) => {
    const queue = [startId];
    const seen = new Set();
    let queueHead = 0;
    while (queueHead < queue.length) {
      const cur = queue[queueHead++];
      if (cur === endId) {
        return true;
      }
      if (seen.has(cur)) {
        continue;
      }
      seen.add(cur);
      const atom = molecule.atoms.get(cur);
      if (!atom) {
        continue;
      }
      for (const bondId of atom.bonds) {
        if (bondId === excludedBondId) {
          continue;
        }
        const bond = molecule.bonds.get(bondId);
        if (!bond) {
          continue;
        }
        const nextId = bond.getOtherAtom(cur);
        if (!seen.has(nextId)) {
          queue.push(nextId);
        }
      }
    }
    return false;
  };

  for (const [, bond] of molecule.bonds) {
    const [aId, bId] = bond.atoms;
    const atomA = molecule.atoms.get(aId);
    const atomB = molecule.atoms.get(bId);
    if (!atomA || !atomB || atomA.name === 'H' || atomB.name === 'H') {
      continue;
    }
    if (hasAlternatePath(aId, bId, bond.id)) {
      ringBondIds.add(bond.id);
      ringAtomIds.add(aId);
      ringAtomIds.add(bId);
    }
  }

  const result = { ringBondIds, ringAtomIds };
  _cycleDataCache.set(molecule, result);
  return result;
}

/**
 * Generates idealized coordinate templates for each connected ring system in the molecule.
 * @param {object} molecule - The molecule graph
 * @param {number} bondLength - Target bond length used when generating template coordinates
 * @param {{ ringAtomIds: Set<string> }} cycleData - Cycle data from collectCycleData
 * @param {(subgraph: import('../../core/Molecule.js').Molecule, options: object) => void} generateCoords - Function used to lay out a subgraph; called as generateCoords(subgraph, options)
 * @returns {Array<{ atomIds: Set<string>, templateCoords: Map<string, {x: number, y: number}> }>} Array of ring system descriptors
 */
// Rotatable/multiple-bond candidates depend only on topology + freeze flags,
// not on current coordinates. Cache them so the O(bonds × n) subtree traversals
// run only once per (molecule, freezeRings, freezeChiralCenters) combination.
const _topoCandidateCache = new WeakMap(); // molecule → Map<flagsKey, { rotatableCandidates, multipleBondCandidates }>

// Memoize ring templates per molecule reference + bondLength. Keyed by a
// string of sorted atom IDs so the same ring system is only laid out once
// even when generateCoords is called recursively for subgraphs.
const _ringTemplateMemo = new WeakMap(); // molecule → Map<cacheKey, templateCoords>

/**
 * Collects ring system candidates from the molecule for 2D layout.
 * Results are memoized per molecule reference and bond length.
 * @param {object} molecule - The molecule graph
 * @param {number} bondLength - Target bond length for ring templates
 * @param {{ ringAtomIds: Set<string>, ringBondIds: Set<string> }} cycleData - Precomputed cycle data
 * @param {(mol: object, opts: object) => Map} generateCoords - Recursive coord generator for sub-rings
 * @returns {Array<object>} Array of ring system candidate objects
 */
export function collectRingSystemCandidates(molecule, bondLength, cycleData, generateCoords) {
  const ringAtomSet = cycleData.ringAtomIds;
  const systems = [];
  const seen = new Set();

  if (!_ringTemplateMemo.has(molecule)) {
    _ringTemplateMemo.set(molecule, new Map());
  }
  const memo = _ringTemplateMemo.get(molecule);

  for (const atomId of ringAtomSet) {
    if (seen.has(atomId)) {
      continue;
    }
    const atomIds = new Set();
    const queue = [atomId];
    let queueHead = 0;
    while (queueHead < queue.length) {
      const cur = queue[queueHead++];
      if (seen.has(cur) || !ringAtomSet.has(cur)) {
        continue;
      }
      seen.add(cur);
      atomIds.add(cur);
      for (const nb of _layoutNeighbors(molecule, cur)) {
        if (!seen.has(nb) && ringAtomSet.has(nb)) {
          queue.push(nb);
        }
      }
    }
    if (atomIds.size < 3) {
      continue;
    }

    const cacheKey = `${bondLength.toFixed(6)}:${[...atomIds].sort().join(',')}`;
    let templateCoords = memo.get(cacheKey);
    if (!templateCoords) {
      const ringSubgraph = molecule.getSubgraph([...atomIds]);
      generateCoords(ringSubgraph, { suppressH: true, bondLength });
      templateCoords = new Map();
      for (const [ringAtomId, atom] of ringSubgraph.atoms) {
        if (Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
          templateCoords.set(ringAtomId, vec2(atom.x, atom.y));
        }
      }
      memo.set(cacheKey, templateCoords);
    }
    if (templateCoords.size >= 3) {
      systems.push({ atomIds, templateCoords });
    }
  }

  return systems;
}

/**
 * Aligns template coordinates onto target coordinates using a least-squares rotation (and optional Y-reflection).
 * @param {Map<string, {x: number, y: number}>} templateCoords - Ideal coordinates to align
 * @param {Map<string, {x: number, y: number}>} targetCoords - Reference coordinates to align onto
 * @param {Iterable<string>} atomIds - Atom IDs to use as alignment anchors
 * @returns {Map<string, {x: number, y: number}>|null} Aligned positions for the shared atoms, or null if fewer than 2 anchors are available
 */
export function alignTemplateCoords(templateCoords, targetCoords, atomIds) {
  const ids = [...atomIds].filter(atomId => templateCoords.has(atomId) && targetCoords.has(atomId));
  if (ids.length < 2) {
    return null;
  }

  let srcCx = 0,
    srcCy = 0,
    dstCx = 0,
    dstCy = 0;
  for (const atomId of ids) {
    const src = templateCoords.get(atomId);
    const dst = targetCoords.get(atomId);
    srcCx += src.x;
    srcCy += src.y;
    dstCx += dst.x;
    dstCy += dst.y;
  }
  srcCx /= ids.length;
  srcCy /= ids.length;
  dstCx /= ids.length;
  dstCy /= ids.length;

  const buildAligned = reflectY => {
    let cross = 0;
    let dot = 0;
    for (const atomId of ids) {
      const src = templateCoords.get(atomId);
      const dst = targetCoords.get(atomId);
      const sx = src.x - srcCx;
      const sy = reflectY ? -(src.y - srcCy) : src.y - srcCy;
      const dx = dst.x - dstCx;
      const dy = dst.y - dstCy;
      cross += sx * dy - sy * dx;
      dot += sx * dx + sy * dy;
    }

    const angle = Math.atan2(cross, dot);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const aligned = new Map();
    let error = 0;

    for (const atomId of ids) {
      const src = templateCoords.get(atomId);
      const sx = src.x - srcCx;
      const sy = reflectY ? -(src.y - srcCy) : src.y - srcCy;
      const x = dstCx + sx * cosA - sy * sinA;
      const y = dstCy + sx * sinA + sy * cosA;
      aligned.set(atomId, vec2(x, y));

      const dst = targetCoords.get(atomId);
      error += (x - dst.x) ** 2 + (y - dst.y) ** 2;
    }

    return { aligned, error };
  };

  const direct = buildAligned(false);
  const mirrored = buildAligned(true);
  return mirrored.error + 1e-9 < direct.error ? mirrored.aligned : direct.aligned;
}

/**
 * Measures how far the current coordinates deviate from the idealized ring-system template.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {{ atomIds: Set<string>, templateCoords: Map<string, {x: number, y: number}> }} ringSystem - Ring system descriptor from collectRingSystemCandidates
 * @returns {{ aligned: Map<string, {x: number, y: number}>, maxDisp: number, rmsDisp: number }|null} Deviation metrics and aligned template, or null on failure
 */
export function measureRingSystemDeviation(baseCoords, ringSystem) {
  const aligned = alignTemplateCoords(ringSystem.templateCoords, baseCoords, ringSystem.atomIds);
  if (!aligned) {
    return null;
  }

  let maxDisp = 0;
  let sumDispSq = 0;
  let count = 0;
  for (const atomId of ringSystem.atomIds) {
    const cur = baseCoords.get(atomId);
    const ideal = aligned.get(atomId);
    if (!cur || !ideal) {
      continue;
    }
    const disp = Math.hypot(cur.x - ideal.x, cur.y - ideal.y);
    if (disp > maxDisp) {
      maxDisp = disp;
    }
    sumDispSq += disp * disp;
    count++;
  }
  if (count === 0) {
    return null;
  }

  return {
    aligned,
    maxDisp,
    rmsDisp: Math.sqrt(sumDispSq / count)
  };
}

/**
 * Builds the shared context object used throughout coordinate refinement.
 *
 * Identifies heavy atoms, bonds, frozen atoms, rotatable/multiple-bond candidates,
 * and ring-system templates that will be referenced by issue detection and transform passes.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} coords - Current atom coordinates
 * @param {object} [options] - Configuration options.
 * @param {number} [options.bondLength] - Target bond length
 * @param {boolean} [options.freezeRings] - Whether ring atoms should be frozen during refinement
 * @param {boolean} [options.freezeChiralCenters] - Whether chiral centres should be frozen
 * @param {boolean} [options.includeRingSystemCandidates] - Whether to generate ring-system templates
 * @param {((subgraph: import('../../core/Molecule.js').Molecule, options: object) => void)|null} [options.generateCoords] - Coordinate generator used for ring templates
 * @returns {object} Refinement context with heavyIds, heavyBonds, bondedPairs, cycleData, frozenAtoms, rotatableCandidates, multipleBondCandidates, ringSystemCandidates, and rings
 */
export function buildRefinementContext(
  molecule,
  coords,
  { bondLength = DEFAULT_BOND_LENGTH, freezeRings = true, freezeChiralCenters = false, includeRingSystemCandidates = true, generateCoords = null } = {}
) {
  _buildLayoutNeighborCache(molecule);

  const heavyIds = [...coords.keys()].filter(id => molecule.atoms.get(id)?.name !== 'H');
  const cycleData = collectCycleData(molecule);
  const frozenAtoms = new Set();
  if (freezeRings) {
    for (const atomId of cycleData.ringAtomIds) {
      frozenAtoms.add(atomId);
    }
  }
  if (freezeChiralCenters) {
    for (const atomId of molecule.getChiralCenters()) {
      frozenAtoms.add(atomId);
    }
  }

  const bondedPairs = new Set();
  const heavyBonds = [];
  for (const [, bond] of molecule.bonds) {
    const [aId, bId] = bond.atoms;
    bondedPairs.add(`${aId}\0${bId}`);
    bondedPairs.add(`${bId}\0${aId}`);
    if (coords.has(aId) && coords.has(bId) && molecule.atoms.get(aId)?.name !== 'H' && molecule.atoms.get(bId)?.name !== 'H') {
      heavyBonds.push(bond);
    }
  }

  const flagsKey = `${freezeRings ? 1 : 0}:${freezeChiralCenters ? 1 : 0}`;
  const topoEntry = _topoCandidateCache.get(molecule)?.get(flagsKey);
  let rotatableCandidates, multipleBondCandidates;

  if (topoEntry) {
    ({ rotatableCandidates, multipleBondCandidates } = topoEntry);
  } else {
    rotatableCandidates = [];
    multipleBondCandidates = [];
    for (const [, bond] of molecule.bonds) {
      const [aId, bId] = bond.atoms;
      const atomA = molecule.atoms.get(aId);
      const atomB = molecule.atoms.get(bId);
      if (!atomA || !atomB) {
        continue;
      }
      if (atomA.name === 'H' || atomB.name === 'H' || cycleData.ringBondIds.has(bond.id)) {
        continue;
      }
      if (!coords.has(aId) || !coords.has(bId)) {
        continue;
      }

      const order = bond.properties.order ?? 1;
      const sideA = collectRefinementSubtree(molecule, aId, bId, frozenAtoms);
      const sideB = collectRefinementSubtree(molecule, bId, aId, frozenAtoms);

      if (order === 1 && !bond.properties.aromatic) {
        const choices = [];
        if (sideA && sideA.size > 0) {
          choices.push({
            kind: 'rotatable',
            bondId: bond.id,
            pivotId: bId,
            movingId: aId,
            atomIds: sideA,
            heavyCount: countHeavyAtoms(molecule, sideA)
          });
        }
        if (sideB && sideB.size > 0) {
          choices.push({
            kind: 'rotatable',
            bondId: bond.id,
            pivotId: aId,
            movingId: bId,
            atomIds: sideB,
            heavyCount: countHeavyAtoms(molecule, sideB)
          });
        }
        if (choices.length === 0) {
          continue;
        }

        choices.sort((a, b) => {
          if (a.heavyCount !== b.heavyCount) {
            return a.heavyCount - b.heavyCount;
          }
          if (a.atomIds.size !== b.atomIds.size) {
            return a.atomIds.size - b.atomIds.size;
          }
          if (a.pivotId !== b.pivotId) {
            return _layoutCompareAtomIds(molecule, a.pivotId, b.pivotId);
          }
          return _layoutCompareAtomIds(molecule, a.movingId, b.movingId);
        });

        rotatableCandidates.push(choices[0]);
        continue;
      }

      if (order < 2 || bond.properties.aromatic) {
        continue;
      }

      const heavyDegreeA = _layoutNeighbors(molecule, aId).filter(nb => molecule.atoms.get(nb)?.name !== 'H').length;
      const heavyDegreeB = _layoutNeighbors(molecule, bId).filter(nb => molecule.atoms.get(nb)?.name !== 'H').length;
      const heavySideA = sideA ? countHeavyAtoms(molecule, sideA) : 0;
      const heavySideB = sideB ? countHeavyAtoms(molecule, sideB) : 0;
      if (sideA && heavySideA === 1 && heavyDegreeA === 1 && !frozenAtoms.has(aId)) {
        multipleBondCandidates.push({
          kind: 'multiple_terminal',
          bondId: bond.id,
          pivotId: bId,
          movingId: aId,
          atomIds: sideA,
          heavyCount: heavySideA
        });
      }
      if (sideB && heavySideB === 1 && heavyDegreeB === 1 && !frozenAtoms.has(bId)) {
        multipleBondCandidates.push({
          kind: 'multiple_terminal',
          bondId: bond.id,
          pivotId: aId,
          movingId: bId,
          atomIds: sideB,
          heavyCount: heavySideB
        });
      }
    }
    if (!_topoCandidateCache.has(molecule)) {
      _topoCandidateCache.set(molecule, new Map());
    }
    _topoCandidateCache.get(molecule).set(flagsKey, { rotatableCandidates, multipleBondCandidates });
  }

  const ringSystemCandidates = freezeRings && includeRingSystemCandidates ? collectRingSystemCandidates(molecule, bondLength, cycleData, generateCoords) : [];

  return {
    bondLength,
    heavyIds,
    heavyBonds,
    bondedPairs,
    cycleData,
    frozenAtoms,
    rotatableCandidates,
    multipleBondCandidates,
    ringSystemCandidates,
    rings: molecule.getRings().filter(ring => ring.length >= 3),
    // Cache slot for collectLayoutIssues — keyed by coords Map reference so
    // repeated calls with the same coords object skip the O(n) grid rebuild.
    _gridCache: null
  };
}
