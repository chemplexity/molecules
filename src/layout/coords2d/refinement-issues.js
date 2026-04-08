/** @module layout/coords2d/refinement-issues */

import { angleTo, normalizeAngle, pointInPolygon, pointToSegmentDistance, turnSignFromPoints } from './geom2d.js';
import { _layoutNeighbors, _layoutCompareAtomIds } from './neighbor-ordering.js';
import { assignCIPRanks } from '../../core/Molecule.js';
import { measureRingSystemDeviation } from './refinement-context.js';

const TWO_PI = 2 * Math.PI;
const DEG120 = (2 * Math.PI) / 3;

/**
 * Returns the turn sign (+1, -1, or 0) for the sequence a→b→c in 2D coordinate space.
 * @param {Map<string, {x: number, y: number}>} coords - Atom coordinates
 * @param {string} aId - Atom ID of the first point
 * @param {string} bId - Atom ID of the pivot point
 * @param {string} cId - Atom ID of the third point
 * @returns {number} +1 for left turn, -1 for right turn, 0 for collinear
 */
export function backboneTurnSign(coords, aId, bId, cId) {
  return turnSignFromPoints(coords.get(aId), coords.get(bId), coords.get(cId));
}

/**
 * Returns the atom ID of the highest-CIP-priority substituent on an sp2 atom, excluding the double-bond partner.
 * Returns null if no unique highest-priority substituent exists.
 * @param {object} molecule - The molecule graph
 * @param {string} sp2Id - Atom ID of the sp2 center
 * @param {string} otherSp2Id - Atom ID of the other alkene carbon (excluded from substituents)
 * @returns {string|null} Atom ID of the highest-priority substituent, or null
 */
export function highestPriorityAlkeneSubstituentId(molecule, sp2Id, otherSp2Id) {
  const neighborIds = _layoutNeighbors(molecule, sp2Id).filter(id => id !== otherSp2Id);
  if (neighborIds.length === 0) {
    return null;
  }

  const ranks = assignCIPRanks(sp2Id, neighborIds, molecule);
  let bestId = null;
  let bestRank = -Infinity;
  let bestCount = 0;

  for (let i = 0; i < neighborIds.length; i++) {
    const rank = ranks[i] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      bestId = neighborIds[i];
      bestCount = 1;
    } else if (rank === bestRank) {
      bestCount++;
    }
  }

  return bestCount === 1 ? bestId : null;
}

/**
 * Determines the actual E/Z stereochemistry of an alkene bond from the current 2D coordinates.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} coords - Current atom coordinates
 * @param {object} bond - The double bond to evaluate
 * @returns {'E'|'Z'|null} Stereodescriptor, or null if it cannot be determined
 */
export function actualAlkeneStereoFromCoords(molecule, coords, bond) {
  const [aId, bId] = bond.atoms;
  const aPos = coords.get(aId);
  const bPos = coords.get(bId);
  if (!aPos || !bPos) {
    return null;
  }

  const aSubId = highestPriorityAlkeneSubstituentId(molecule, aId, bId);
  const bSubId = highestPriorityAlkeneSubstituentId(molecule, bId, aId);
  if (!aSubId || !bSubId) {
    return null;
  }

  const aSubPos = coords.get(aSubId);
  const bSubPos = coords.get(bSubId);
  if (!aSubPos || !bSubPos) {
    return null;
  }

  const dx = bPos.x - aPos.x;
  const dy = bPos.y - aPos.y;
  const crossA = dx * (aSubPos.y - aPos.y) - dy * (aSubPos.x - aPos.x);
  const crossB = dx * (bSubPos.y - bPos.y) - dy * (bSubPos.x - bPos.x);
  if (Math.abs(crossA) < 1e-6 || Math.abs(crossB) < 1e-6) {
    return null;
  }

  return Math.sign(crossA) === Math.sign(crossB) ? 'Z' : 'E';
}

/**
 * Tests whether two line segments properly intersect (share an interior crossing point, not endpoints).
 * @param {{x: number, y: number}} a1 - First endpoint of segment A
 * @param {{x: number, y: number}} a2 - Second endpoint of segment A
 * @param {{x: number, y: number}} b1 - First endpoint of segment B
 * @param {{x: number, y: number}} b2 - Second endpoint of segment B
 * @returns {boolean} True if the segments cross at a strict interior point
 */
export function segmentsProperlyIntersect(a1, a2, b1, b2) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  const eps = 1e-8;
  if (Math.abs(o1) < eps || Math.abs(o2) < eps || Math.abs(o3) < eps || Math.abs(o4) < eps) {
    return false;
  }
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

/**
 * Computes the angle at vertex b formed by vectors b→a and b→c, in radians.
 * @param {{x: number, y: number}} a - First point
 * @param {{x: number, y: number}} b - Vertex point
 * @param {{x: number, y: number}} c - Third point
 * @returns {number|null} Angle in radians [0, π], or null if any vector has zero length
 */
export function angleBetweenPoints(a, b, c) {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const uLen = Math.hypot(ux, uy);
  const vLen = Math.hypot(vx, vy);
  if (uLen < 1e-8 || vLen < 1e-8) {
    return null;
  }
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (uLen * vLen)));
  return Math.acos(cos);
}

/**
 * Returns the ideal bond angle (in radians) at an atom for use during refinement.
 * Returns π for linear centers (triple bonds or two double bonds), 2π/3 otherwise.
 * @param {object} molecule - The molecule graph
 * @param {string} atomId - Atom ID to evaluate
 * @returns {number} Ideal angle in radians
 */
export function idealRefinementAngle(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return DEG120;
  }
  const heavyBondOrders = atom.bonds
    .map(bondId => molecule.bonds.get(bondId))
    .filter(Boolean)
    .filter(bond => {
      const otherId = bond.getOtherAtom(atomId);
      return molecule.atoms.get(otherId)?.name !== 'H';
    })
    .map(bond => bond.properties.order ?? 1);
  const hasTriple = heavyBondOrders.some(order => order >= 3);
  const doubleCount = heavyBondOrders.filter(order => order >= 2 && order < 3).length;
  if (hasTriple || doubleCount >= 2) {
    return Math.PI;
  }
  return DEG120;
}

/**
 * Returns true if an atom is a strict trigonal center: exactly 3 heavy neighbors,
 * exactly one double bond, and no triple bonds.
 * @param {object} molecule - The molecule graph
 * @param {string} atomId - Atom ID to test
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
export function isStrictTrigonalRefinementCenter(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  const heavyBondOrders = atom.bonds
    .map(bondId => molecule.bonds.get(bondId))
    .filter(Boolean)
    .filter(bond => {
      const otherId = bond.getOtherAtom(atomId);
      return molecule.atoms.get(otherId)?.name !== 'H';
    })
    .map(bond => bond.properties.order ?? 1);
  const doubleCount = heavyBondOrders.filter(order => order >= 2 && order < 3).length;
  const tripleCount = heavyBondOrders.filter(order => order >= 3).length;
  return tripleCount === 0 && doubleCount === 1 && heavyBondOrders.length === 3;
}

/**
 * Finds a neighbor of atomId that is connected via a non-aromatic multiple bond
 * and has heavy degree 1 (i.e., is a terminal multiple-bond atom).
 * @param {object} molecule - The molecule graph
 * @param {string} atomId - Atom ID to inspect
 * @returns {string|null} Atom ID of the terminal multiple-bond neighbor, or null
 */
export function getTerminalMultipleBondNeighborId(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return null;
  }
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond || bond.properties.aromatic || (bond.properties.order ?? 1) < 2) {
      continue;
    }
    const otherId = bond.getOtherAtom(atomId);
    if (!otherId || molecule.atoms.get(otherId)?.name === 'H') {
      continue;
    }
    const heavyDegree = _layoutNeighbors(molecule, otherId).filter(nb => molecule.atoms.get(nb)?.name !== 'H').length;
    if (heavyDegree === 1) {
      return otherId;
    }
  }
  return null;
}

/**
 * Computes the average direction pointing away from a set of reference positions relative to a pivot.
 * @param {{x: number, y: number}} pivot - The origin point
 * @param {Array<{x: number, y: number}>} refPositions - Reference positions to average away from
 * @returns {number|null} Angle in radians pointing away from the centroid of references, or null if degenerate
 */
export function averageDirectionAwayFromRefs(pivot, refPositions) {
  let sumX = 0;
  let sumY = 0;
  for (const refPos of refPositions) {
    const dx = refPos.x - pivot.x;
    const dy = refPos.y - pivot.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-8) {
      continue;
    }
    sumX += dx / len;
    sumY += dy / len;
  }
  if (Math.hypot(sumX, sumY) < 1e-8) {
    return null;
  }
  return Math.atan2(-sumY, -sumX);
}

/**
 * Computes the ideal outward direction for a substituent attached to a ring atom.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} coords - Current atom coordinates
 * @param {string} pivotId - Atom ID of the ring atom bearing the substituent
 * @param {Set<string>} ringAtomIds - Set of all ring atom IDs
 * @returns {number|null} Target angle in radians, or null if it cannot be determined
 */
export function ringSubstituentTargetAngle(molecule, coords, pivotId, ringAtomIds) {
  const pivot = coords.get(pivotId);
  if (!pivot) {
    return null;
  }
  const ringRefPositions = _layoutNeighbors(molecule, pivotId)
    .filter(atomId => ringAtomIds.has(atomId))
    .map(atomId => coords.get(atomId))
    .filter(Boolean);
  if (ringRefPositions.length < 2) {
    return null;
  }
  return averageDirectionAwayFromRefs(pivot, ringRefPositions);
}

/**
 * Returns true if the bond between aId and bId qualifies as a chain bond for refinement
 * (non-aromatic single or double bond, both atoms within the allowed set).
 * @param {object} molecule - The molecule graph
 * @param {string} aId - First atom ID
 * @param {string} bId - Second atom ID
 * @param {Set<string>|null} [allowedAtomIds] - Optional atom whitelist; both endpoints must be in it
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
export function isRefinementChainBond(molecule, aId, bId, allowedAtomIds = null) {
  if (allowedAtomIds && (!allowedAtomIds.has(aId) || !allowedAtomIds.has(bId))) {
    return false;
  }
  const bond = molecule.getBond(aId, bId);
  const order = bond?.properties.order ?? 1;
  return Boolean(bond && !bond.properties.aromatic && (order === 1 || order === 2));
}

/**
 * Returns true if an atom is eligible to participate in a refinement chain
 * (heavy, non-ring, and all its heavy neighbors are connected by chain bonds).
 * @param {object} molecule - The molecule graph
 * @param {string} atomId - Atom ID to test
 * @param {Set<string>} ringAtomIds - Set of all ring atom IDs
 * @param {Set<string>|null} [allowedAtomIds] - Optional atom whitelist
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
export function isRefinementChainAtom(molecule, atomId, ringAtomIds, allowedAtomIds = null) {
  if (allowedAtomIds && !allowedAtomIds.has(atomId)) {
    return false;
  }
  const atom = molecule.atoms.get(atomId);
  if (!atom || atom.name === 'H' || ringAtomIds.has(atomId)) {
    return false;
  }
  const heavyNeighbors = _layoutNeighbors(molecule, atomId)
    .filter(nb => molecule.atoms.get(nb)?.name !== 'H')
    .filter(nb => !allowedAtomIds || allowedAtomIds.has(nb));
  if (heavyNeighbors.length === 0) {
    return false;
  }
  return heavyNeighbors.every(nb => isRefinementChainBond(molecule, atomId, nb, allowedAtomIds));
}

/**
 * Traces the longest linear chain path starting from startId through eligible chain atoms.
 * @param {object} molecule - The molecule graph
 * @param {string} startId - Atom ID to start tracing from
 * @param {Set<string>} ringAtomIds - Set of all ring atom IDs
 * @param {Set<string>|null} [allowedAtomIds] - Optional atom whitelist
 * @returns {string[]} Ordered array of atom IDs along the chain (may be empty)
 */
export function collectRefinementChainPath(molecule, startId, ringAtomIds, allowedAtomIds = null) {
  if (!isRefinementChainAtom(molecule, startId, ringAtomIds, allowedAtomIds)) {
    return [];
  }
  const path = [startId];
  let prevId = null;
  let curId = startId;

  for (let step = 0, maxSteps = molecule.atoms.size; step < maxSteps; step++) {
    const nextIds = _layoutNeighbors(molecule, curId)
      .filter(nb => nb !== prevId)
      .filter(nb => molecule.atoms.get(nb)?.name !== 'H')
      .filter(nb => isRefinementChainAtom(molecule, nb, ringAtomIds, allowedAtomIds))
      .filter(nb => isRefinementChainBond(molecule, curId, nb, allowedAtomIds));
    if (nextIds.length !== 1) {
      break;
    }
    prevId = curId;
    curId = nextIds[0];
    path.push(curId);
  }

  return path;
}

/**
 * Enumerates all non-overlapping linear chain paths across the molecule using the refinement context.
 * @param {object} molecule - The molecule graph
 * @param {{ heavyIds: string[], cycleData: { ringAtomIds: Set<string> } }} ctx - Refinement context (or compatible subset)
 * @returns {string[][]} Array of chain paths, each an ordered array of atom IDs with length >= 2
 */
export function collectAllRefinementChainPaths(molecule, ctx) {
  const eligible = new Set(ctx.heavyIds.filter(atomId => isRefinementChainAtom(molecule, atomId, ctx.cycleData.ringAtomIds)));
  const neighborMap = new Map();
  for (const atomId of eligible) {
    neighborMap.set(
      atomId,
      _layoutNeighbors(molecule, atomId)
        .filter(nb => eligible.has(nb))
        .filter(nb => isRefinementChainBond(molecule, atomId, nb))
    );
  }

  const visited = new Set();
  const paths = [];
  const edgeKey = (a, b) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

  const starts = [...eligible].sort((a, b) => {
    const da = neighborMap.get(a)?.length ?? 0;
    const db = neighborMap.get(b)?.length ?? 0;
    if (da !== db) {
      return da - db;
    }
    return _layoutCompareAtomIds(molecule, a, b);
  });

  for (const startId of starts) {
    const degree = neighborMap.get(startId)?.length ?? 0;
    if (degree > 1) {
      continue;
    }
    const path = [startId];
    let prevId = null;
    let curId = startId;
    for (let step = 0, maxSteps = eligible.size; step < maxSteps; step++) {
      const nextIds = (neighborMap.get(curId) ?? []).filter(nb => nb !== prevId);
      if (nextIds.length !== 1) {
        break;
      }
      const nextId = nextIds[0];
      const eKey = edgeKey(curId, nextId);
      if (visited.has(eKey)) {
        break;
      }
      visited.add(eKey);
      path.push(nextId);
      prevId = curId;
      curId = nextId;
    }
    if (path.length >= 2) {
      paths.push(path);
    }
  }

  return paths;
}

/**
 * Detects and scores all layout problems in the current coordinate set.
 *
 * Checks for atom overlaps, near-atom proximity, bond stretching/compression,
 * bond-atom crowding, bond crossings, bad bond angles, ring geometry deviations,
 * chain compaction/curling, and atoms placed inside ring polygons.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} coords - Current atom coordinates
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Array<{ type: string, severity: number, atoms: string[], bonds?: string[] }>} Issues sorted by descending severity
 */
export function collectLayoutIssues(molecule, coords, ctx) {
  const issues = [];
  const atomThresh = ctx.bondLength * 0.72;
  const nearAtomThresh = ctx.bondLength * 0.95;
  const bondAtomThreshC = ctx.bondLength * 0.3;
  const bondAtomThreshHetero = ctx.bondLength * 0.5;
  const stretchedBondThresh = ctx.bondLength * 1.2;
  const compressedBondThresh = ctx.bondLength * 0.8;

  // Spatial grid: bucket heavy atoms into cells of size nearAtomThresh so that
  // only the 3×3 cell neighbourhood needs to be examined for proximity tests.
  // This reduces the atom-pair and bond-atom loops from O(n²) to O(n) for
  // spread-out molecules.
  // The grid is cached on ctx keyed by coords reference — repeated calls with
  // the same coords Map (e.g. scoring the same base layout in one pass) skip
  // the O(n) rebuild entirely.
  const cellSize = nearAtomThresh;
  let gridCells, atomCellCx, atomCellCy;
  const _cache = ctx._gridCache;
  if (_cache && _cache.coordsRef === coords) {
    ({ gridCells, atomCellCx, atomCellCy } = _cache);
  } else {
    gridCells = new Map(); // "cx,cy" → number[] (indices into heavyIds)
    atomCellCx = new Int32Array(ctx.heavyIds.length);
    atomCellCy = new Int32Array(ctx.heavyIds.length);
    for (let i = 0; i < ctx.heavyIds.length; i++) {
      const p = coords.get(ctx.heavyIds[i]);
      if (!p) {
        continue;
      }
      const cx = Math.floor(p.x / cellSize);
      const cy = Math.floor(p.y / cellSize);
      atomCellCx[i] = cx;
      atomCellCy[i] = cy;
      const key = `${cx},${cy}`;
      let cell = gridCells.get(key);
      if (!cell) {
        cell = [];
        gridCells.set(key, cell);
      }
      cell.push(i);
    }
    if (ctx._gridCache !== undefined) {
      ctx._gridCache = { coordsRef: coords, gridCells, atomCellCx, atomCellCy };
    }
  }

  // Collect indices of atoms in the 3×3 neighbourhood of cell (cx, cy).
  function indicesNear(cx, cy) {
    const result = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = gridCells.get(`${cx + dx},${cy + dy}`);
        if (cell) {
          for (const idx of cell) {
            result.push(idx);
          }
        }
      }
    }
    return result;
  }

  // Atom-atom proximity — O(n) thanks to grid.
  for (let i = 0; i < ctx.heavyIds.length; i++) {
    const aId = ctx.heavyIds[i];
    const aPos = coords.get(aId);
    if (!aPos) {
      continue;
    }
    for (const j of indicesNear(atomCellCx[i], atomCellCy[i])) {
      if (j <= i) {
        continue; // deduplicate; only check each pair once
      }
      const bId = ctx.heavyIds[j];
      if (ctx.bondedPairs.has(`${aId}\0${bId}`)) {
        continue;
      }
      const bPos = coords.get(bId);
      if (!bPos) {
        continue;
      }
      const dist = Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y);
      if (dist < atomThresh) {
        issues.push({
          type: 'atom_overlap',
          severity: 20 + (atomThresh - dist) * 40,
          atoms: [aId, bId]
        });
      } else if (dist < nearAtomThresh) {
        issues.push({
          type: 'atom_near',
          severity: (nearAtomThresh - dist) * 6,
          atoms: [aId, bId]
        });
      }
    }
  }

  for (let i = 0; i < ctx.heavyBonds.length; i++) {
    const bond = ctx.heavyBonds[i];
    const [aId, bId] = bond.atoms;
    const aPos = coords.get(aId);
    const bPos = coords.get(bId);
    if (!aPos || !bPos) {
      continue;
    }
    const bondDist = Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y);

    if (bondDist > stretchedBondThresh) {
      issues.push({
        type: 'bond_stretch',
        severity: 10 + (bondDist - stretchedBondThresh) * 18,
        atoms: [aId, bId],
        bonds: [bond.id]
      });
    } else if (bondDist < compressedBondThresh) {
      issues.push({
        type: 'bond_compression',
        severity: 10 + (compressedBondThresh - bondDist) * 24,
        atoms: [aId, bId],
        bonds: [bond.id]
      });
    }

    // Bond-atom crowding — O(1) per bond thanks to grid.
    // An atom within bondAtomThreshHetero of the segment must be within
    // bondAtomThreshHetero + bondLength/2 ≤ nearAtomThresh of at least one
    // endpoint, so checking the 3×3 neighbourhood of both endpoints suffices.
    const checkedForBond = new Set([aId, bId]);
    for (const pos of [aPos, bPos]) {
      const cx = Math.floor(pos.x / cellSize);
      const cy = Math.floor(pos.y / cellSize);
      for (const idx of indicesNear(cx, cy)) {
        const atomId = ctx.heavyIds[idx];
        if (checkedForBond.has(atomId)) {
          continue;
        }
        checkedForBond.add(atomId);
        if (ctx.bondedPairs.has(`${atomId}\0${aId}`) || ctx.bondedPairs.has(`${atomId}\0${bId}`)) {
          continue;
        }
        const atomPos = coords.get(atomId);
        if (!atomPos) {
          continue;
        }
        const atom = molecule.atoms.get(atomId);
        const thresh = atom?.name === 'C' ? bondAtomThreshC : bondAtomThreshHetero;
        const dist = pointToSegmentDistance(atomPos, aPos, bPos);
        if (dist < thresh) {
          issues.push({
            type: 'bond_atom_crowding',
            severity: (atom?.name === 'C' ? 4 : 12) + (thresh - dist) * (atom?.name === 'C' ? 10 : 35),
            atoms: [atomId, aId, bId],
            bonds: [bond.id]
          });
        }
      }
    }

    // Cap at 8 crossings — enough to identify the problem region without
    // scanning the full O(b²) matrix when the layout is badly tangled.
    if (issues.filter(iss => iss.type === 'bond_crossing').length >= 8) {
      break;
    }
    for (let j = i + 1; j < ctx.heavyBonds.length; j++) {
      const otherBond = ctx.heavyBonds[j];
      const shared = bond.atoms.some(atomId => otherBond.atoms.includes(atomId));
      if (shared) {
        continue;
      }
      // Cheap bounding-box pre-reject before calling segmentsProperlyIntersect.
      const cPos = coords.get(otherBond.atoms[0]);
      const dPos = coords.get(otherBond.atoms[1]);
      if (!cPos || !dPos) {
        continue;
      }
      if (
        Math.max(aPos.x, bPos.x) < Math.min(cPos.x, dPos.x) - 1e-6 ||
        Math.min(aPos.x, bPos.x) > Math.max(cPos.x, dPos.x) + 1e-6 ||
        Math.max(aPos.y, bPos.y) < Math.min(cPos.y, dPos.y) - 1e-6 ||
        Math.min(aPos.y, bPos.y) > Math.max(cPos.y, dPos.y) + 1e-6
      ) {
        continue;
      }
      if (segmentsProperlyIntersect(aPos, bPos, cPos, dPos)) {
        issues.push({
          type: 'bond_crossing',
          severity: 30,
          atoms: [...bond.atoms, ...otherBond.atoms],
          bonds: [bond.id, otherBond.id]
        });
      }
    }
  }

  for (const pivotId of ctx.heavyIds) {
    if (ctx.cycleData.ringAtomIds.has(pivotId)) {
      const ringNeighbors = _layoutNeighbors(molecule, pivotId)
        .filter(atomId => ctx.cycleData.ringAtomIds.has(atomId))
        .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
        .filter(atomId => coords.has(atomId));
      const substituents = _layoutNeighbors(molecule, pivotId)
        .filter(atomId => !ctx.cycleData.ringAtomIds.has(atomId))
        .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
        .filter(atomId => coords.has(atomId));
      if (ringNeighbors.length >= 2 && substituents.length === 1) {
        const pivotPos = coords.get(pivotId);
        const subPos = coords.get(substituents[0]);
        const targetAngle = ringSubstituentTargetAngle(molecule, coords, pivotId, ctx.cycleData.ringAtomIds);
        if (pivotPos && subPos && targetAngle != null) {
          const actualAngle = angleTo(pivotPos, subPos);
          const err = Math.abs(normalizeAngle(actualAngle - targetAngle));
          if (err > (18 * Math.PI) / 180) {
            issues.push({
              type: 'ring_substituent_angle',
              severity: 10 + err * 18,
              atoms: [pivotId, substituents[0], ...ringNeighbors]
            });
          }
        }
      }
      continue;
    }
    const neighbors = _layoutNeighbors(molecule, pivotId)
      .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
      .filter(atomId => coords.has(atomId));
    if (neighbors.length < 2 || neighbors.length > 4) {
      continue;
    }

    const pivotPos = coords.get(pivotId);
    if (!pivotPos) {
      continue;
    }

    // Quaternary centres (4 heavy neighbors) cannot all be at a single ideal
    // pairwise angle (adjacent pairs ≈ 90°, opposite pairs ≈ 180°).  Instead
    // check the minimum consecutive angular gap: the ideal gap is 360°/4 = 90°,
    // and we flag if any adjacent pair of bonds is closer than 60° (2/3 of
    // ideal), indicating two bonds have collapsed toward each other.
    if (neighbors.length === 4) {
      const bondAngles = neighbors
        .map(nbId => {
          const nbPos = coords.get(nbId);
          return nbPos ? Math.atan2(nbPos.y - pivotPos.y, nbPos.x - pivotPos.x) : null;
        })
        .filter(a => a !== null)
        .sort((a, b) => a - b);
      if (bondAngles.length < 4) {
        continue;
      }
      let minGap = Infinity;
      for (let i = 0; i < 4; i++) {
        const gap = i < 3 ? bondAngles[i + 1] - bondAngles[i] : bondAngles[0] + TWO_PI - bondAngles[3]; // wraparound gap
        if (gap < minGap) {
          minGap = gap;
        }
      }
      const minGapThreshold = (60 * Math.PI) / 180;
      if (minGap < minGapThreshold) {
        const err = minGapThreshold - minGap;
        issues.push({
          type: 'quaternary_angle',
          severity: 8 + err * 22,
          atoms: [pivotId, ...neighbors]
        });
      }
      continue;
    }

    const ideal = idealRefinementAngle(molecule, pivotId);
    const strictTrigonal = ideal === DEG120 && neighbors.length === 3 && isStrictTrigonalRefinementCenter(molecule, pivotId);
    const worstErrThreshold = strictTrigonal ? (4 * Math.PI) / 180 : (12 * Math.PI) / 180;
    const avgErrThreshold = strictTrigonal ? (3 * Math.PI) / 180 : 0;
    let worstErr = 0;
    let errSum = 0;
    let pairCount = 0;
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const aPos = coords.get(neighbors[i]);
        const bPos = coords.get(neighbors[j]);
        if (!aPos || !bPos) {
          continue;
        }
        const angle = angleBetweenPoints(aPos, pivotPos, bPos);
        if (angle == null) {
          continue;
        }
        const err = Math.abs(angle - ideal);
        if (err > worstErr) {
          worstErr = err;
        }
        errSum += err;
        pairCount++;
      }
    }
    if (pairCount === 0) {
      continue;
    }
    const avgErr = errSum / pairCount;
    if (worstErr > worstErrThreshold || (strictTrigonal && avgErr > avgErrThreshold)) {
      issues.push({
        type: neighbors.length === 3 ? 'planar_angle' : 'chain_angle',
        severity: (strictTrigonal ? 10 : 8) + worstErr * (strictTrigonal ? 34 : 22) + avgErr * (strictTrigonal ? 16 : 8),
        atoms: [pivotId, ...neighbors]
      });
    }
  }

  for (let i = 0; i < ctx.ringSystemCandidates.length; i++) {
    const ringSystem = ctx.ringSystemCandidates[i];
    const deviation = measureRingSystemDeviation(coords, ringSystem);
    if (!deviation) {
      continue;
    }
    if (deviation.maxDisp > ctx.bondLength * 0.16 || deviation.rmsDisp > ctx.bondLength * 0.1) {
      issues.push({
        type: 'ring_geometry',
        severity: 12 + deviation.maxDisp * 18 + deviation.rmsDisp * 18,
        atoms: [...ringSystem.atomIds]
      });
    }
  }

  for (const path of (ctx.chainPaths ??= collectAllRefinementChainPaths(molecule, ctx))) {
    if (path.length < 4) {
      continue;
    }

    const startPos = coords.get(path[0]);
    const endPos = coords.get(path[path.length - 1]);
    if (startPos && endPos) {
      const endToEnd = Math.hypot(startPos.x - endPos.x, startPos.y - endPos.y);
      const idealEndToEnd = ctx.bondLength * (path.length - 1) * 0.82;
      if (endToEnd < idealEndToEnd) {
        issues.push({
          type: 'chain_compaction',
          severity: 6 + (idealEndToEnd - endToEnd) * 5,
          atoms: [...path]
        });
      }
    }

    for (let i = 0; i <= path.length - 4; i++) {
      const sign1 = backboneTurnSign(coords, path[i], path[i + 1], path[i + 2]);
      const sign2 = backboneTurnSign(coords, path[i + 1], path[i + 2], path[i + 3]);
      if (sign1 !== 0 && sign2 !== 0 && sign1 === sign2) {
        issues.push({
          type: 'chain_curl',
          severity: 8,
          atoms: [path[i], path[i + 1], path[i + 2], path[i + 3]]
        });
      }
    }
  }

  // Atom-inside-ring: penalise any non-ring heavy atom whose coordinate falls
  // inside a ring polygon.  The existing atom-overlap / bond-atom-crowding /
  // bond-crossing checks are insufficient for this case: for a regular hexagon
  // a substituent placed at the ring-inward direction lands ≈ 1 BL from every
  // ring atom (above the 0.72 BL overlap threshold), ≈ 0.866 BL from every
  // ring bond (above the 0.30 BL carbon crowding threshold), and its bond to
  // the ring atom shares an endpoint with adjacent ring bonds so
  // segmentsProperlyIntersect correctly returns false.  Without this check the
  // scoring function accepts the ring-interior position.
  if (ctx.rings?.length > 0) {
    for (let i = 0; i < ctx.heavyIds.length; i++) {
      const atomId = ctx.heavyIds[i];
      if (ctx.cycleData.ringAtomIds.has(atomId)) {
        continue;
      }
      const p = coords.get(atomId);
      if (!p) {
        continue;
      }
      for (const ring of ctx.rings) {
        const poly = ring.map(id => coords.get(id)).filter(Boolean);
        if (poly.length < 3) {
          continue;
        }
        if (pointInPolygon(p, poly)) {
          issues.push({
            type: 'atom_inside_ring',
            severity: 500,
            atoms: [atomId]
          });
          break; // one issue per atom is enough
        }
      }
    }
  }

  issues.sort((a, b) => b.severity - a.severity);
  return issues;
}

/**
 * Sums the severity scores of all detected layout issues into a single scalar.
 * @param {Array<{ severity: number }>} issues - Issues array from collectLayoutIssues
 * @returns {number} Total severity score (lower is better)
 */
export function scoreLayoutIssues(issues) {
  return issues.reduce((sum, issue) => sum + issue.severity, 0);
}
