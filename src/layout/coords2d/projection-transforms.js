/** @module layout/coords2d/projection-transforms */

import { _reflectPoint, angleTo, normalizeAngle, project, rotateAround, vec2 } from './geom2d.js';

const DEG60 = Math.PI / 3;
const DEG120 = (2 * Math.PI) / 3;
import { _layoutNeighbors } from './neighbor-ordering.js';
import { collectRefinementSubtree, countHeavyAtoms, measureRingSystemDeviation } from './refinement-context.js';
import {
  actualAlkeneStereoFromCoords,
  angleBetweenPoints,
  averageDirectionAwayFromRefs,
  collectAllRefinementChainPaths,
  collectLayoutIssues,
  collectRefinementChainPath,
  getTerminalMultipleBondNeighborId,
  idealRefinementAngle,
  isStrictTrigonalRefinementCenter,
  ringSubstituentTargetAngle,
  scoreLayoutIssues
} from './refinement-issues.js';

/**
 * Rotates a set of atoms around a pivot atom by a given angle.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {Iterable<string>} atomIds - Atom IDs to rotate
 * @param {string} originId - Atom ID of the rotation pivot
 * @param {number} angle - Rotation angle in radians
 * @returns {Map<string, {x: number, y: number}>} New coordinates for the rotated atoms
 */
export function rotateSubtreeCoords(baseCoords, atomIds, originId, angle) {
  const origin = baseCoords.get(originId);
  if (!origin || Math.abs(angle) < 1e-9) {
    return new Map([...atomIds].map(id => [id, baseCoords.get(id)]).filter(([, pos]) => Boolean(pos)));
  }
  const rotated = new Map();
  for (const atomId of atomIds) {
    const pos = baseCoords.get(atomId);
    if (pos) {
      rotated.set(atomId, rotateAround(pos, origin, angle));
    }
  }
  return rotated;
}

/**
 * Reflects a set of atoms across the line defined by two axis atoms.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {Iterable<string>} atomIds - Atom IDs to reflect
 * @param {string} axisAId - First atom ID defining the reflection axis
 * @param {string} axisBId - Second atom ID defining the reflection axis
 * @returns {Map<string, {x: number, y: number}>} New coordinates for the reflected atoms
 */
export function reflectSubtreeCoords(baseCoords, atomIds, axisAId, axisBId) {
  const a = baseCoords.get(axisAId);
  const b = baseCoords.get(axisBId);
  if (!a || !b) {
    return new Map([...atomIds].map(id => [id, baseCoords.get(id)]).filter(([, pos]) => Boolean(pos)));
  }
  const reflected = new Map();
  for (const atomId of atomIds) {
    const pos = baseCoords.get(atomId);
    if (pos) {
      reflected.set(atomId, _reflectPoint(pos, a, b));
    }
  }
  return reflected;
}

/**
 * Translates a subtree so that the bond from pivotId to movingId has exactly targetLength.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {Iterable<string>} atomIds - Atom IDs to translate
 * @param {string} pivotId - Fixed anchor atom ID
 * @param {string} movingId - Atom ID being repositioned
 * @param {number} targetLength - Desired distance between pivot and moving atom
 * @returns {Map<string, {x: number, y: number}>} New coordinates for the translated atoms
 */
export function reanchorSubtreeCoords(baseCoords, atomIds, pivotId, movingId, targetLength) {
  const pivot = baseCoords.get(pivotId);
  const moving = baseCoords.get(movingId);
  if (!pivot || !moving) {
    return new Map([...atomIds].map(id => [id, baseCoords.get(id)]).filter(([, pos]) => Boolean(pos)));
  }

  let dx = moving.x - pivot.x;
  let dy = moving.y - pivot.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-6) {
    dx = 1;
    dy = 0;
    dist = 1;
  }

  const targetX = pivot.x + (dx / dist) * targetLength;
  const targetY = pivot.y + (dy / dist) * targetLength;
  const shiftX = targetX - moving.x;
  const shiftY = targetY - moving.y;

  const translated = new Map();
  for (const atomId of atomIds) {
    const pos = baseCoords.get(atomId);
    if (pos) {
      translated.set(atomId, vec2(pos.x + shiftX, pos.y + shiftY));
    }
  }
  return translated;
}

/**
 * Rotates and translates a subtree so that the bond pivotId→movingId points at targetAngle with targetLength.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {Iterable<string>} atomIds - Atom IDs in the subtree to reproject
 * @param {string} pivotId - Fixed anchor atom ID
 * @param {string} movingId - Root atom of the subtree being moved
 * @param {number} targetAngle - Desired angle (radians) of the bond from pivot to moving
 * @param {number} targetLength - Desired bond length
 * @returns {Map<string, {x: number, y: number}>} New coordinates for the reprojected atoms
 */
export function reprojectSubtreeCoords(baseCoords, atomIds, pivotId, movingId, targetAngle, targetLength) {
  const pivot = baseCoords.get(pivotId);
  const moving = baseCoords.get(movingId);
  if (!pivot || !moving) {
    return new Map([...atomIds].map(id => [id, baseCoords.get(id)]).filter(([, pos]) => Boolean(pos)));
  }

  const currentAngle = angleTo(pivot, moving);
  const deltaAngle = normalizeAngle(targetAngle - currentAngle);
  const targetPos = project(pivot, targetAngle, targetLength);
  const rotated = new Map();
  for (const atomId of atomIds) {
    const pos = baseCoords.get(atomId);
    if (pos) {
      rotated.set(atomId, rotateAround(pos, moving, deltaAngle));
    }
  }

  const movedAnchor = rotated.get(movingId) ?? moving;
  const shiftX = targetPos.x - movedAnchor.x;
  const shiftY = targetPos.y - movedAnchor.y;
  for (const [atomId, pos] of rotated) {
    rotated.set(atomId, vec2(pos.x + shiftX, pos.y + shiftY));
  }
  return rotated;
}

/**
 * Returns a new coordinate map with the given updates merged in, leaving baseCoords unchanged.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {Map<string, {x: number, y: number}>} updates - Coordinate overrides to apply
 * @returns {Map<string, {x: number, y: number}>} New coordinate map
 */
export function applyRefinementCoords(baseCoords, updates) {
  const next = new Map(baseCoords);
  for (const [atomId, pos] of updates) {
    next.set(atomId, pos);
  }
  return next;
}

/**
 * Computes the mean angular deviation from 120° for all bond pairs at a strict trigonal center.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} coords - Current atom coordinates
 * @param {string} centerId - Atom ID of the trigonal center
 * @returns {number} Mean angular error in radians, or Infinity if the center is invalid
 */
export function strictTrigonalCenterError(molecule, coords, centerId) {
  const center = coords.get(centerId);
  if (!center) {
    return Infinity;
  }
  const neighbors = _layoutNeighbors(molecule, centerId)
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => coords.has(atomId));
  if (neighbors.length !== 3) {
    return Infinity;
  }
  let err = 0;
  let pairCount = 0;
  for (let i = 0; i < neighbors.length; i++) {
    for (let j = i + 1; j < neighbors.length; j++) {
      const aPos = coords.get(neighbors[i]);
      const bPos = coords.get(neighbors[j]);
      const angle = angleBetweenPoints(aPos, center, bPos);
      if (angle == null) {
        return Infinity;
      }
      err += Math.abs(angle - DEG120);
      pairCount++;
    }
  }
  return pairCount > 0 ? err / pairCount : Infinity;
}

/**
 * Generates candidate coordinate updates that place neighbors of a strict trigonal center at ideal 120° angles.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {string} centerId - Atom ID of the trigonal center
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Array<Map<string, {x: number, y: number}>>} Array of coordinate-update maps to try
 */
export function buildStrictTrigonalCenterTransforms(molecule, baseCoords, centerId, ctx) {
  if (!isStrictTrigonalRefinementCenter(molecule, centerId) || !getTerminalMultipleBondNeighborId(molecule, centerId)) {
    return [];
  }

  const center = baseCoords.get(centerId);
  if (!center) {
    return [];
  }

  const neighbors = _layoutNeighbors(molecule, centerId)
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => baseCoords.has(atomId));
  if (neighbors.length !== 3) {
    return [];
  }

  const infos = neighbors.map(neighborId => {
    const subtree = collectRefinementSubtree(molecule, neighborId, centerId, ctx.frozenAtoms);
    const movable = Boolean(
      subtree && subtree.size > 0 && countHeavyAtoms(molecule, subtree) > 0 && countHeavyAtoms(molecule, subtree) <= ctx.heavyIds.length - countHeavyAtoms(molecule, subtree)
    );
    return {
      neighborId,
      pos: baseCoords.get(neighborId),
      subtree,
      movable
    };
  });

  const movableInfos = infos.filter(info => info.movable);
  const fixedInfos = infos.filter(info => !info.movable);
  if (movableInfos.length === 0 || fixedInfos.length === 0) {
    return [];
  }

  const transforms = [];
  const mergeUpdates = parts => {
    const merged = new Map();
    for (const part of parts) {
      for (const [atomId, pos] of part) {
        merged.set(atomId, pos);
      }
    }
    return merged;
  };

  if (fixedInfos.length === 2 && movableInfos.length === 1) {
    const targetAngle = averageDirectionAwayFromRefs(
      center,
      fixedInfos.map(info => info.pos)
    );
    if (targetAngle != null) {
      transforms.push(reprojectSubtreeCoords(baseCoords, movableInfos[0].subtree, centerId, movableInfos[0].neighborId, targetAngle, ctx.bondLength));
    }
    return transforms;
  }

  if (fixedInfos.length === 1 && movableInfos.length === 2) {
    const refAngle = angleTo(center, fixedInfos[0].pos);
    const targetAngles = [normalizeAngle(refAngle + DEG120), normalizeAngle(refAngle - DEG120)];
    const assignments = [
      [targetAngles[0], targetAngles[1]],
      [targetAngles[1], targetAngles[0]]
    ];
    for (const [firstAngle, secondAngle] of assignments) {
      transforms.push(
        mergeUpdates([
          reprojectSubtreeCoords(baseCoords, movableInfos[0].subtree, centerId, movableInfos[0].neighborId, firstAngle, ctx.bondLength),
          reprojectSubtreeCoords(baseCoords, movableInfos[1].subtree, centerId, movableInfos[1].neighborId, secondAngle, ctx.bondLength)
        ])
      );
    }
  }

  return transforms;
}

/**
 * Iteratively improves all strict trigonal centers toward ideal 120° geometry.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Starting atom coordinates
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @param {object} [options] - Configuration options.
 * @param {number} [options.maxPasses] - Maximum number of refinement passes
 * @param {boolean} [options.requireNonWorseScore] - Reject moves that increase the total layout score
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map
 */
export function idealizeStrictTrigonalCenters(molecule, baseCoords, ctx, { maxPasses = 2, requireNonWorseScore = true } = {}) {
  let currentCoords = baseCoords;
  let currentScore = scoreLayoutIssues(collectLayoutIssues(molecule, currentCoords, ctx));

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    const centerIds = ctx.heavyIds
      .filter(atomId => getTerminalMultipleBondNeighborId(molecule, atomId))
      .sort((a, b) => strictTrigonalCenterError(molecule, currentCoords, b) - strictTrigonalCenterError(molecule, currentCoords, a));

    for (const centerId of centerIds) {
      const baseLocalError = strictTrigonalCenterError(molecule, currentCoords, centerId);
      if (!Number.isFinite(baseLocalError) || baseLocalError < (2 * Math.PI) / 180) {
        continue;
      }

      let bestCoords = null;
      let bestScore = currentScore;
      let bestLocalError = baseLocalError;
      for (const updates of buildStrictTrigonalCenterTransforms(molecule, currentCoords, centerId, ctx)) {
        const trialCoords = applyRefinementCoords(currentCoords, updates);
        const trialLocalError = strictTrigonalCenterError(molecule, trialCoords, centerId);
        if (!(trialLocalError + 1e-6 < bestLocalError)) {
          continue;
        }
        const trialScore = scoreLayoutIssues(collectLayoutIssues(molecule, trialCoords, ctx));
        if ((!requireNonWorseScore || trialScore <= currentScore + 1e-6) && (trialScore + 1e-6 < bestScore || trialLocalError + 1e-6 < bestLocalError)) {
          bestCoords = trialCoords;
          bestScore = trialScore;
          bestLocalError = trialLocalError;
        }
      }

      if (bestCoords) {
        currentCoords = bestCoords;
        currentScore = bestScore;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return currentCoords;
}

/**
 * Snaps current ring-system coordinates to their idealized template via alignment.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {{ atomIds: Set<string>, templateCoords: Map<string, {x: number, y: number}> }} ringSystem - Ring system descriptor
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map (unchanged if alignment fails)
 */
export function applyRingSystemTemplate(baseCoords, ringSystem) {
  const deviation = measureRingSystemDeviation(baseCoords, ringSystem);
  return deviation?.aligned ? applyRefinementCoords(baseCoords, deviation.aligned) : baseCoords;
}

/**
 * Generates candidate projection transforms for a rotatable chain-bond candidate,
 * placing the moving subtree at ideal angles relative to the pivot's other neighbors.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {{ pivotId: string, movingId: string, atomIds: Set<string> }} candidate - Rotatable bond candidate
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Array<Map<string, {x: number, y: number}>>} Array of coordinate-update maps to try
 */
export function buildChainProjectionTransforms(molecule, baseCoords, candidate, ctx) {
  const pivot = baseCoords.get(candidate.pivotId);
  const moving = baseCoords.get(candidate.movingId);
  if (!pivot || !moving) {
    return [];
  }

  const refIds = _layoutNeighbors(molecule, candidate.pivotId)
    .filter(atomId => atomId !== candidate.movingId)
    .filter(atomId => !candidate.atomIds.has(atomId))
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => baseCoords.has(atomId));
  if (refIds.length === 0) {
    return [];
  }

  const targetLength = ctx.bondLength;
  const idealAngle = idealRefinementAngle(molecule, candidate.pivotId);
  const transforms = [];
  const seenAngles = new Set();

  for (const refId of refIds) {
    const refPos = baseCoords.get(refId);
    if (!refPos) {
      continue;
    }
    const refAngle = angleTo(pivot, refPos);
    const candidateAngles = idealAngle >= Math.PI - 1e-6 ? [normalizeAngle(refAngle + Math.PI)] : [normalizeAngle(refAngle + idealAngle), normalizeAngle(refAngle - idealAngle)];

    for (const angle of candidateAngles) {
      const key = angle.toFixed(6);
      if (seenAngles.has(key)) {
        continue;
      }
      seenAngles.add(key);
      transforms.push(reprojectSubtreeCoords(baseCoords, candidate.atomIds, candidate.pivotId, candidate.movingId, angle, targetLength));
    }
  }

  return transforms;
}

/**
 * Generates a projection transform for a planar (trigonal) candidate by pointing the moving subtree
 * directly away from the pivot's other two heavy neighbors.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {{ pivotId: string, movingId: string, atomIds: Set<string> }} candidate - Rotatable bond candidate
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Array<Map<string, {x: number, y: number}>>} Array containing at most one coordinate-update map
 */
export function buildPlanarProjectionTransforms(molecule, baseCoords, candidate, ctx) {
  const pivot = baseCoords.get(candidate.pivotId);
  const moving = baseCoords.get(candidate.movingId);
  if (!pivot || !moving) {
    return [];
  }

  const refIds = _layoutNeighbors(molecule, candidate.pivotId)
    .filter(atomId => atomId !== candidate.movingId)
    .filter(atomId => !candidate.atomIds.has(atomId))
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => baseCoords.has(atomId));
  if (refIds.length < 2) {
    return [];
  }

  const idealAngle = idealRefinementAngle(molecule, candidate.pivotId);
  if (Math.abs(idealAngle - DEG120) > 1e-6) {
    return [];
  }

  const refPositions = refIds.map(atomId => baseCoords.get(atomId)).filter(Boolean);
  const targetAngle = averageDirectionAwayFromRefs(pivot, refPositions);
  if (targetAngle == null) {
    return [];
  }

  return [reprojectSubtreeCoords(baseCoords, candidate.atomIds, candidate.pivotId, candidate.movingId, targetAngle, ctx.bondLength)];
}

/**
 * Generates a projection transform that places a ring substituent at the ideal outward angle from its ring atom.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {{ pivotId: string, movingId: string, atomIds: Set<string> }} candidate - Rotatable bond candidate
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Array<Map<string, {x: number, y: number}>>} Array containing at most one coordinate-update map
 */
export function buildRingSubstituentProjectionTransforms(molecule, baseCoords, candidate, ctx) {
  if (!ctx.cycleData.ringAtomIds.has(candidate.pivotId)) {
    return [];
  }
  const targetAngle = ringSubstituentTargetAngle(molecule, baseCoords, candidate.pivotId, ctx.cycleData.ringAtomIds);
  if (targetAngle == null) {
    return [];
  }
  return [reprojectSubtreeCoords(baseCoords, candidate.atomIds, candidate.pivotId, candidate.movingId, targetAngle, ctx.bondLength)];
}

/**
 * Generates zigzag-extended chain transforms for a rotatable candidate whose moving subtree
 * begins a linear chain of 3 or more atoms, alternating turn direction at 60° steps.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {{ kind: string, pivotId: string, movingId: string, atomIds: Set<string> }} candidate - Rotatable bond candidate
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Array<Map<string, {x: number, y: number}>>} Array of coordinate-update maps to try
 */
export function buildExtendedZigZagChainTransforms(molecule, baseCoords, candidate, ctx) {
  if (candidate.kind !== 'rotatable') {
    return [];
  }

  const path = collectRefinementChainPath(molecule, candidate.movingId, ctx.cycleData.ringAtomIds, candidate.atomIds);
  if (path.length < 3) {
    return [];
  }

  const pivot = baseCoords.get(candidate.pivotId);
  const moving = baseCoords.get(candidate.movingId);
  if (!pivot || !moving) {
    return [];
  }

  const refIds = _layoutNeighbors(molecule, candidate.pivotId)
    .filter(atomId => atomId !== candidate.movingId)
    .filter(atomId => !candidate.atomIds.has(atomId))
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => baseCoords.has(atomId));
  if (refIds.length === 0) {
    return [];
  }

  const targetLength = ctx.bondLength;
  const idealAngle = idealRefinementAngle(molecule, candidate.pivotId);
  const startAngles = new Set();
  for (const refId of refIds) {
    const refPos = baseCoords.get(refId);
    if (!refPos) {
      continue;
    }
    const refAngle = angleTo(pivot, refPos);
    if (idealAngle >= Math.PI - 1e-6) {
      startAngles.add(normalizeAngle(refAngle + Math.PI).toFixed(6));
    } else {
      startAngles.add(normalizeAngle(refAngle + idealAngle).toFixed(6));
      startAngles.add(normalizeAngle(refAngle - idealAngle).toFixed(6));
    }
  }

  const pathSet = new Set(path);
  const sideSubtrees = [];
  const seenSide = new Set();
  for (const anchorId of path) {
    for (const nbId of _layoutNeighbors(molecule, anchorId)) {
      if (!candidate.atomIds.has(nbId) || pathSet.has(nbId) || seenSide.has(nbId)) {
        continue;
      }
      const subtree = new Set();
      const queue = [nbId];
      let queueHead = 0;
      while (queueHead < queue.length) {
        const curId = queue[queueHead++];
        if (subtree.has(curId) || pathSet.has(curId) || !candidate.atomIds.has(curId)) {
          continue;
        }
        subtree.add(curId);
        seenSide.add(curId);
        for (const nextId of _layoutNeighbors(molecule, curId)) {
          if (!subtree.has(nextId) && !pathSet.has(nextId) && candidate.atomIds.has(nextId)) {
            queue.push(nextId);
          }
        }
      }
      if (subtree.size > 0) {
        sideSubtrees.push({ anchorId, atomIds: subtree });
      }
    }
  }

  const transforms = [];
  for (const startAngleKey of startAngles) {
    const startAngle = Number(startAngleKey);
    for (const parity of [1, -1]) {
      const updates = new Map();
      let currentPos = project(pivot, startAngle, targetLength);
      let currentDir = startAngle;
      let currentSign = parity;

      updates.set(path[0], currentPos);
      for (let i = 1; i < path.length; i++) {
        const nextDir = normalizeAngle(currentDir + currentSign * DEG60);
        const nextPos = project(currentPos, nextDir, targetLength);
        updates.set(path[i], nextPos);
        currentPos = nextPos;
        currentDir = nextDir;
        currentSign *= -1;
      }

      applyOrientedSideSubtreeUpdates(molecule, baseCoords, updates, path, sideSubtrees);

      transforms.push(updates);
    }
  }

  return transforms;
}

/**
 * Collects all side-chain subtrees branching off a linear chain path.
 * @param {object} molecule - The molecule graph
 * @param {string[]} path - Ordered atom IDs forming the backbone chain
 * @param {Set<string>|null} [allowedAtomIds] - Optional atom whitelist for subtree traversal
 * @returns {Array<{ anchorId: string, atomIds: Set<string> }>} Array of side subtree descriptors
 */
export function collectChainSideSubtrees(molecule, path, allowedAtomIds = null) {
  const pathSet = new Set(path);
  const sideSubtrees = [];
  const seenSide = new Set();

  for (const anchorId of path) {
    for (const nbId of _layoutNeighbors(molecule, anchorId)) {
      if (pathSet.has(nbId) || seenSide.has(nbId)) {
        continue;
      }
      if (allowedAtomIds && !allowedAtomIds.has(nbId)) {
        continue;
      }

      const subtree = new Set();
      const queue = [nbId];
      let queueHead = 0;
      while (queueHead < queue.length) {
        const curId = queue[queueHead++];
        if (subtree.has(curId) || pathSet.has(curId)) {
          continue;
        }
        if (allowedAtomIds && !allowedAtomIds.has(curId)) {
          continue;
        }
        subtree.add(curId);
        seenSide.add(curId);
        for (const nextId of _layoutNeighbors(molecule, curId)) {
          if (!subtree.has(nextId) && !pathSet.has(nextId)) {
            queue.push(nextId);
          }
        }
      }

      if (subtree.size > 0) {
        sideSubtrees.push({ anchorId, atomIds: subtree });
      }
    }
  }

  return sideSubtrees;
}

/**
 * Repositions side-chain subtrees in updates to match the new orientation of their chain anchor atoms.
 * Rotates and translates each subtree to track how the anchor moved relative to its path neighbors.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Original atom coordinates before updates
 * @param {Map<string, {x: number, y: number}>} updates - In-progress coordinate updates (mutated in place)
 * @param {string[]} path - Ordered atom IDs of the backbone chain
 * @param {Array<{ anchorId: string, atomIds: Set<string> }>} sideSubtrees - Side subtree descriptors
 * @returns {void}
 */
export function applyOrientedSideSubtreeUpdates(molecule, baseCoords, updates, path, sideSubtrees) {
  const pathSet = new Set(path);

  for (const { anchorId, atomIds } of sideSubtrees) {
    const oldAnchor = baseCoords.get(anchorId);
    const newAnchor = updates.get(anchorId);
    if (!oldAnchor || !newAnchor) {
      continue;
    }

    const pathNeighborIds = _layoutNeighbors(molecule, anchorId)
      .filter(atomId => pathSet.has(atomId))
      .filter(atomId => baseCoords.has(atomId))
      .filter(atomId => updates.has(atomId));

    let deltaAngle = 0;
    if (pathNeighborIds.length > 0) {
      const oldRefs = pathNeighborIds.map(atomId => baseCoords.get(atomId)).filter(Boolean);
      const newRefs = pathNeighborIds.map(atomId => updates.get(atomId)).filter(Boolean);
      const oldAngle = averageDirectionAwayFromRefs(oldAnchor, oldRefs);
      const newAngle = averageDirectionAwayFromRefs(newAnchor, newRefs);
      if (oldAngle != null && newAngle != null) {
        deltaAngle = normalizeAngle(newAngle - oldAngle);
      }
    }

    for (const atomId of atomIds) {
      const pos = baseCoords.get(atomId);
      if (!pos) {
        continue;
      }
      const rotated = Math.abs(deltaAngle) > 1e-9 ? rotateAround(pos, oldAnchor, deltaAngle) : pos;
      updates.set(atomId, vec2(rotated.x + (newAnchor.x - oldAnchor.x), rotated.y + (newAnchor.y - oldAnchor.y)));
    }
  }
}

/**
 * Rotates side subtrees attached to the terminal atoms of a chain path to maximize clearance from other atoms.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Original atom coordinates before updates
 * @param {Map<string, {x: number, y: number}>} updates - In-progress coordinate updates (mutated in place)
 * @param {string[]} path - Ordered atom IDs of the backbone chain
 * @param {Array<{ anchorId: string, atomIds: Set<string> }>} sideSubtrees - Side subtree descriptors
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {void}
 */
export function optimizeTerminalChainSideSubtrees(molecule, baseCoords, updates, path, sideSubtrees, ctx) {
  const terminalSet = new Set([path[0], path[path.length - 1]]);
  const candidateAngles = [0, DEG60, -DEG60, DEG120, -DEG120, Math.PI];
  const edgeKey = (a, b) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

  for (const { anchorId, atomIds } of sideSubtrees) {
    if (!terminalSet.has(anchorId)) {
      continue;
    }

    const anchorPos = updates.get(anchorId);
    if (!anchorPos) {
      continue;
    }

    const subtreeIds = [...atomIds].filter(atomId => updates.get(atomId) ?? baseCoords.get(atomId));
    const subtreeSet = new Set(subtreeIds);
    const heavySubtreeIds = subtreeIds.filter(atomId => molecule.atoms.get(atomId)?.name !== 'H');
    if (heavySubtreeIds.length === 0) {
      continue;
    }

    const pathNeighborId = _layoutNeighbors(molecule, anchorId).find(
      atomId => atomId !== anchorId && (atomId === path[0] || atomId === path[path.length - 1] || path.includes(atomId))
    );
    const pathNeighborPos = pathNeighborId ? (updates.get(pathNeighborId) ?? baseCoords.get(pathNeighborId)) : null;
    const awayRef = pathNeighborPos ? vec2(anchorPos.x - pathNeighborPos.x, anchorPos.y - pathNeighborPos.y) : null;
    const awayRefLen = awayRef ? Math.hypot(awayRef.x, awayRef.y) : 0;

    let bestRotation = 0;
    let bestClearance = -Infinity;
    let bestDirectionScore = -Infinity;

    for (const deltaAngle of candidateAngles) {
      const rotated = new Map();
      for (const atomId of subtreeIds) {
        const pos = updates.get(atomId) ?? baseCoords.get(atomId);
        if (!pos) {
          continue;
        }
        rotated.set(atomId, Math.abs(deltaAngle) > 1e-9 ? rotateAround(pos, anchorPos, deltaAngle) : pos);
      }

      let minDist = Infinity;
      for (const atomId of heavySubtreeIds) {
        const pos = rotated.get(atomId);
        if (!pos) {
          continue;
        }
        for (const otherId of ctx.heavyIds) {
          if (otherId === atomId || subtreeSet.has(otherId)) {
            continue;
          }
          if (ctx.bondedPairs.has(edgeKey(atomId, otherId))) {
            continue;
          }
          const otherPos = updates.get(otherId) ?? baseCoords.get(otherId);
          if (!otherPos) {
            continue;
          }
          const dist = Math.hypot(pos.x - otherPos.x, pos.y - otherPos.y);
          if (dist < minDist) {
            minDist = dist;
          }
        }
      }

      if (!Number.isFinite(minDist)) {
        minDist = Infinity;
      }

      let directionScore = 0;
      if (awayRef && awayRefLen > 1e-9) {
        let centroidX = 0;
        let centroidY = 0;
        let count = 0;
        for (const atomId of heavySubtreeIds) {
          const pos = rotated.get(atomId);
          if (!pos) {
            continue;
          }
          centroidX += pos.x;
          centroidY += pos.y;
          count++;
        }
        if (count > 0) {
          centroidX /= count;
          centroidY /= count;
          const dirX = centroidX - anchorPos.x;
          const dirY = centroidY - anchorPos.y;
          const dirLen = Math.hypot(dirX, dirY);
          if (dirLen > 1e-9) {
            directionScore = (dirX * awayRef.x + dirY * awayRef.y) / (dirLen * awayRefLen);
          }
        }
      }

      if (minDist > bestClearance + 1e-6 || (Math.abs(minDist - bestClearance) <= 1e-6 && directionScore > bestDirectionScore)) {
        bestRotation = deltaAngle;
        bestClearance = minDist;
        bestDirectionScore = directionScore;
      }
    }

    if (Math.abs(bestRotation) > 1e-9) {
      for (const atomId of subtreeIds) {
        const pos = updates.get(atomId) ?? baseCoords.get(atomId);
        if (!pos) {
          continue;
        }
        updates.set(atomId, rotateAround(pos, anchorPos, bestRotation));
      }
    }
  }
}

/**
 * Generates fully-extended zigzag layouts for a chain path, with both parities and multiple start angles.
 * EZ stereo of double bonds along the path is respected when stereo data is present.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {string[]} path - Ordered atom IDs of the chain to unfurl
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Array<Map<string, {x: number, y: number}>>} Array of coordinate-update maps to try
 */
export function buildUnfurledChainPathTransforms(molecule, baseCoords, path, ctx) {
  if (path.length < 4) {
    return [];
  }

  const start = baseCoords.get(path[0]);
  const second = baseCoords.get(path[1]);
  if (!start || !second) {
    return [];
  }

  const startAngle = angleTo(start, second);
  const targetLength = ctx.bondLength;
  const sideSubtrees = collectChainSideSubtrees(molecule, path);
  const pathBonds = [];
  for (let i = 0; i < path.length - 1; i++) {
    pathBonds.push(molecule.getBond(path[i], path[i + 1]));
  }
  const transforms = [];
  // For very long chains (≥20) try all 5 rotation offsets; for medium chains
  // (10-19) only 3 are needed — the extreme ±120° variants rarely win and
  // each extra angle doubles evaluation cost downstream.
  const startAngles = new Set([startAngle.toFixed(6)]);
  if (path.length >= 10) {
    const deltas = path.length >= 20 ? [DEG60, -DEG60, DEG120, -DEG120, Math.PI] : [DEG60, -DEG60, Math.PI];
    for (const delta of deltas) {
      startAngles.add(normalizeAngle(startAngle + delta).toFixed(6));
    }
  }

  for (const startAngleKey of startAngles) {
    const seededStartAngle = Number(startAngleKey);
    for (const parity of [1, -1]) {
      const updates = new Map();
      updates.set(path[0], start);
      updates.set(path[1], project(start, seededStartAngle, targetLength));

      let currentPos = updates.get(path[1]);
      let currentDir = seededStartAngle;
      let defaultSign = parity;
      let pendingDoubleEntrySign = null;

      for (let i = 2; i < path.length; i++) {
        const prevBond = pathBonds[i - 2];
        const nextBond = pathBonds[i - 1];
        let turnSign = defaultSign;

        if (prevBond && !prevBond.properties.aromatic && (prevBond.properties.order ?? 1) === 2 && pendingDoubleEntrySign != null) {
          const targetStereo = molecule.getEZStereo(prevBond.id);
          if (targetStereo === 'Z') {
            turnSign = pendingDoubleEntrySign;
          } else if (targetStereo === 'E') {
            turnSign = -pendingDoubleEntrySign;
          }
        }

        const nextDir = normalizeAngle(currentDir + turnSign * DEG60);
        const nextPos = project(currentPos, nextDir, targetLength);
        updates.set(path[i], nextPos);
        currentPos = nextPos;
        currentDir = nextDir;
        defaultSign *= -1;
        pendingDoubleEntrySign = nextBond && !nextBond.properties.aromatic && (nextBond.properties.order ?? 1) === 2 ? turnSign : null;
      }

      applyOrientedSideSubtreeUpdates(molecule, baseCoords, updates, path, sideSubtrees);
      optimizeTerminalChainSideSubtrees(molecule, baseCoords, updates, path, sideSubtrees, ctx);

      transforms.push(updates);
    }
  }

  return transforms;
}

/**
 * Returns the minimum distance between any two non-bonded heavy atoms in the current coordinates.
 * @param {Map<string, {x: number, y: number}>} coords - Current atom coordinates
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {number} Minimum non-bonded heavy-atom distance, or Infinity if fewer than two heavy atoms exist
 */
export function minimumHeavyNonBondedDistanceForCoords(coords, ctx) {
  // Spatial grid (O(n·k)) instead of O(n²) all-pairs loop.
  // Search radius = 3 × bondLength; pairs farther than that are irrelevant
  // for detecting clashes. Returns the search radius when no close pair found.
  const searchR = ctx.bondLength * 3;
  const searchR2 = searchR * searchR;
  const grid = new Map();
  for (const aId of ctx.heavyIds) {
    const p = coords.get(aId);
    if (!p) {
      continue;
    }
    const key = `${Math.floor(p.x / searchR)},${Math.floor(p.y / searchR)}`;
    let cell = grid.get(key);
    if (!cell) {
      cell = [];
      grid.set(key, cell);
    }
    cell.push(aId);
  }
  let minDist2 = searchR2;
  for (const aId of ctx.heavyIds) {
    const aPos = coords.get(aId);
    if (!aPos) {
      continue;
    }
    const cx0 = Math.floor(aPos.x / searchR) - 1;
    const cy0 = Math.floor(aPos.y / searchR) - 1;
    for (let gx = 0; gx <= 2; gx++) {
      for (let gy = 0; gy <= 2; gy++) {
        const cell = grid.get(`${cx0 + gx},${cy0 + gy}`);
        if (!cell) {
          continue;
        }
        for (const bId of cell) {
          if (bId <= aId) {
            continue; // process each pair once (lexicographic dedup)
          }
          if (ctx.bondedPairs.has(`${aId}\0${bId}`)) {
            continue;
          }
          const bPos = coords.get(bId);
          if (!bPos) {
            continue;
          }
          const dx = aPos.x - bPos.x,
            dy = aPos.y - bPos.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < minDist2) {
            minDist2 = d2;
          }
        }
      }
    }
  }
  return Math.sqrt(minDist2);
}

/**
 * Computes geometry quality metrics for a chain path: end-to-end distance, terminal span,
 * terminal closure (minimum distance between start and end region atoms), and minimum non-bonded
 * distance between non-adjacent path atoms.
 * @param {Map<string, {x: number, y: number}>} coords - Current atom coordinates
 * @param {string[]} path - Ordered atom IDs of the chain
 * @returns {{ endToEnd: number, terminalSpan: number, terminalClosure: number, pathMinNonBonded: number }} The result object.
 */
export function longChainPathMetrics(coords, path) {
  if (!path || path.length < 2) {
    return {
      endToEnd: 0,
      terminalSpan: 0,
      terminalClosure: Infinity,
      pathMinNonBonded: Infinity
    };
  }

  const startPos = coords.get(path[0]);
  const endPos = coords.get(path[path.length - 1]);
  const endToEnd = startPos && endPos ? Math.hypot(startPos.x - endPos.x, startPos.y - endPos.y) : 0;

  const terminalIds = path.slice(-Math.min(4, path.length));
  let terminalSpan = 0;
  if (startPos) {
    for (const atomId of terminalIds) {
      const pos = coords.get(atomId);
      if (!pos) {
        continue;
      }
      terminalSpan = Math.max(terminalSpan, Math.hypot(startPos.x - pos.x, startPos.y - pos.y));
    }
  }

  let terminalClosure = Infinity;
  const startIds = path.slice(0, Math.min(4, path.length));
  for (let i = 0; i < startIds.length; i++) {
    const aPos = coords.get(startIds[i]);
    if (!aPos) {
      continue;
    }
    for (let j = 0; j < terminalIds.length; j++) {
      const pathIndexA = i;
      const pathIndexB = path.length - terminalIds.length + j;
      if (pathIndexB - pathIndexA <= 2) {
        continue;
      }
      const bPos = coords.get(terminalIds[j]);
      if (!bPos) {
        continue;
      }
      const dist = Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y);
      if (dist < terminalClosure) {
        terminalClosure = dist;
      }
    }
  }

  let pathMinNonBonded = Infinity;
  for (let i = 0; i < path.length; i++) {
    const aPos = coords.get(path[i]);
    if (!aPos) {
      continue;
    }
    for (let j = i + 3; j < path.length; j++) {
      const bPos = coords.get(path[j]);
      if (!bPos) {
        continue;
      }
      const dist = Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y);
      if (dist < pathMinNonBonded) {
        pathMinNonBonded = dist;
      }
    }
  }

  return {
    endToEnd,
    terminalSpan,
    terminalClosure,
    pathMinNonBonded
  };
}

/**
 * Attempts to unfurl compacted or looped chain paths by trying extended zigzag layouts.
 * Accepts a new layout only when it reduces the layout score or strongly improves backbone geometry.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Starting atom coordinates
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map
 */
export function spreadCompactedChainPaths(molecule, baseCoords, ctx) {
  const chainPaths = (ctx.chainPaths ??= collectAllRefinementChainPaths(molecule, ctx));
  let currentCoords = baseCoords;
  let currentScore = scoreLayoutIssues(collectLayoutIssues(molecule, currentCoords, ctx));

  for (const path of chainPaths) {
    if (path.length < 6) {
      continue;
    }

    const metrics = longChainPathMetrics(currentCoords, path);
    const endToEnd = metrics.endToEnd;
    const idealEndToEnd = ctx.bondLength * (path.length - 1) * 0.82;
    const needsSpread = endToEnd < idealEndToEnd || metrics.terminalClosure < ctx.bondLength * 1.35 || metrics.pathMinNonBonded < ctx.bondLength * 0.9;
    if (!needsSpread) {
      continue;
    }

    let bestCoords = null;
    let bestScore = currentScore;
    let bestMetrics = metrics;
    let rescueCoords = null;
    let rescueScore = currentScore;
    let rescueMetrics = metrics;
    let rescueClearance = -Infinity;
    for (const updates of buildUnfurledChainPathTransforms(molecule, currentCoords, path, ctx)) {
      const trialCoords = applyRefinementCoords(currentCoords, updates);
      const trialScore = scoreLayoutIssues(collectLayoutIssues(molecule, trialCoords, ctx));
      const trialMetrics = longChainPathMetrics(trialCoords, path);
      const trialClearance = minimumHeavyNonBondedDistanceForCoords(trialCoords, ctx);
      const stronglyImprovesBackbone =
        (trialMetrics.pathMinNonBonded > Math.max(bestMetrics.pathMinNonBonded, ctx.bondLength * 0.95) + 1e-6 ||
          trialMetrics.terminalClosure > Math.max(bestMetrics.terminalClosure, ctx.bondLength * 1.75) + 1e-6 ||
          trialMetrics.endToEnd > bestMetrics.endToEnd + ctx.bondLength * 2) &&
        trialClearance >= ctx.bondLength * 0.9;

      if (trialScore + 1e-6 < bestScore || stronglyImprovesBackbone) {
        bestScore = trialScore;
        bestCoords = trialCoords;
        bestMetrics = trialMetrics;
        // Perfect solution found — no point evaluating remaining transforms.
        if (trialScore === 0 && trialClearance >= ctx.bondLength * 0.95) {
          break;
        }
      }

      if (
        trialMetrics.pathMinNonBonded > rescueMetrics.pathMinNonBonded + 1e-6 ||
        (Math.abs(trialMetrics.pathMinNonBonded - rescueMetrics.pathMinNonBonded) <= 1e-6 && trialMetrics.terminalClosure > rescueMetrics.terminalClosure + 1e-6) ||
        (Math.abs(trialMetrics.pathMinNonBonded - rescueMetrics.pathMinNonBonded) <= 1e-6 &&
          Math.abs(trialMetrics.terminalClosure - rescueMetrics.terminalClosure) <= 1e-6 &&
          trialMetrics.terminalSpan > rescueMetrics.terminalSpan + 1e-6) ||
        (Math.abs(trialMetrics.pathMinNonBonded - rescueMetrics.pathMinNonBonded) <= 1e-6 &&
          Math.abs(trialMetrics.terminalClosure - rescueMetrics.terminalClosure) <= 1e-6 &&
          Math.abs(trialMetrics.terminalSpan - rescueMetrics.terminalSpan) <= 1e-6 &&
          trialClearance > rescueClearance + 1e-6)
      ) {
        rescueCoords = trialCoords;
        rescueScore = trialScore;
        rescueMetrics = trialMetrics;
        rescueClearance = trialClearance;
      }
    }

    const severeLoop = endToEnd < ctx.bondLength * 3 || metrics.terminalClosure < ctx.bondLength * 1.1 || metrics.pathMinNonBonded < ctx.bondLength * 0.75;
    const rescueOpensBackbone =
      rescueMetrics.terminalSpan > metrics.terminalSpan + ctx.bondLength * 2 ||
      rescueMetrics.terminalClosure > metrics.terminalClosure + ctx.bondLength * 1.5 ||
      rescueMetrics.pathMinNonBonded > metrics.pathMinNonBonded + ctx.bondLength * 0.5;
    if (!bestCoords && severeLoop && rescueCoords && rescueOpensBackbone && rescueClearance >= ctx.bondLength * 0.75) {
      bestCoords = rescueCoords;
      bestScore = rescueScore;
      bestMetrics = rescueMetrics;
    }

    if (bestCoords) {
      currentCoords = bestCoords;
      currentScore = bestScore;
    }
  }

  return currentCoords;
}

/**
 * Rescues severely looped or compacted long chains (≥10 atoms) by applying extended zigzag layouts
 * that substantially improve backbone spread, optionally preserving EZ stereo.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Starting atom coordinates
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @param {object} [options] - Configuration options.
 * @param {boolean} [options.preserveStereo] - Reject candidates that reduce the number of matched stereo bonds
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map
 */
export function rescueSeverelyCompactedLongChains(molecule, baseCoords, ctx, { preserveStereo = false } = {}) {
  const chainPaths = (ctx.chainPaths ??= collectAllRefinementChainPaths(molecule, ctx));
  const ringAtomIds = preserveStereo ? new Set(molecule.getRings().flat()) : null;
  const stereoBonds = preserveStereo
    ? [...molecule.bonds.values()].filter(bond => {
        if (bond.properties.aromatic || (bond.properties.order ?? 1) !== 2) {
          return false;
        }
        const [aId, bId] = bond.atoms;
        return molecule.getEZStereo(bond.id) != null && !ringAtomIds.has(aId) && !ringAtomIds.has(bId);
      })
    : [];
  let currentCoords = baseCoords;

  const matchedStereoCount = coords =>
    stereoBonds.reduce((count, bond) => {
      const target = molecule.getEZStereo(bond.id);
      return count + (actualAlkeneStereoFromCoords(molecule, coords, bond) === target ? 1 : 0);
    }, 0);

  for (const path of chainPaths) {
    if (path.length < 10) {
      continue;
    }

    const currentMetrics = longChainPathMetrics(currentCoords, path);
    const needsRescue =
      currentMetrics.terminalSpan < ctx.bondLength * 6 || currentMetrics.terminalClosure < ctx.bondLength * 1.35 || currentMetrics.pathMinNonBonded < ctx.bondLength * 0.9;
    if (!needsRescue) {
      continue;
    }

    let bestCoords = null;
    let bestStereoCount = -Infinity;
    let bestMetrics = currentMetrics;
    let bestClearance = -Infinity;
    const baselineStereoCount = preserveStereo ? matchedStereoCount(currentCoords) : -Infinity;
    for (const updates of buildUnfurledChainPathTransforms(molecule, currentCoords, path, ctx)) {
      const trialCoords = applyRefinementCoords(currentCoords, updates);
      const trialStereoCount = matchedStereoCount(trialCoords);
      const trialMetrics = longChainPathMetrics(trialCoords, path);
      const trialClearance = minimumHeavyNonBondedDistanceForCoords(trialCoords, ctx);
      const rescueQualified =
        (trialMetrics.terminalSpan > currentMetrics.terminalSpan + ctx.bondLength * 2 ||
          trialMetrics.terminalClosure > currentMetrics.terminalClosure + ctx.bondLength * 1.5 ||
          trialMetrics.pathMinNonBonded > currentMetrics.pathMinNonBonded + ctx.bondLength * 0.5) &&
        trialClearance >= ctx.bondLength * 0.75;
      if (!rescueQualified || (preserveStereo && trialStereoCount < baselineStereoCount)) {
        continue;
      }
      if (
        trialStereoCount > bestStereoCount ||
        (trialStereoCount === bestStereoCount && trialMetrics.pathMinNonBonded > bestMetrics.pathMinNonBonded + 1e-6) ||
        (trialStereoCount === bestStereoCount &&
          Math.abs(trialMetrics.pathMinNonBonded - bestMetrics.pathMinNonBonded) <= 1e-6 &&
          trialMetrics.terminalClosure > bestMetrics.terminalClosure + 1e-6) ||
        (trialStereoCount === bestStereoCount &&
          Math.abs(trialMetrics.pathMinNonBonded - bestMetrics.pathMinNonBonded) <= 1e-6 &&
          Math.abs(trialMetrics.terminalClosure - bestMetrics.terminalClosure) <= 1e-6 &&
          trialMetrics.terminalSpan > bestMetrics.terminalSpan + 1e-6) ||
        (trialStereoCount === bestStereoCount &&
          Math.abs(trialMetrics.pathMinNonBonded - bestMetrics.pathMinNonBonded) <= 1e-6 &&
          Math.abs(trialMetrics.terminalClosure - bestMetrics.terminalClosure) <= 1e-6 &&
          Math.abs(trialMetrics.terminalSpan - bestMetrics.terminalSpan) <= 1e-6 &&
          trialClearance > bestClearance + 1e-6)
      ) {
        bestCoords = trialCoords;
        bestStereoCount = trialStereoCount;
        bestMetrics = trialMetrics;
        bestClearance = trialClearance;
        if (
          trialMetrics.pathMinNonBonded >= ctx.bondLength * 0.95 &&
          trialMetrics.terminalClosure >= ctx.bondLength * 1.35 &&
          trialClearance >= ctx.bondLength * 0.95
        ) {
          break; // all rescue criteria met — no need to try more transforms
        }
      }
    }

    if (bestCoords) {
      currentCoords = bestCoords;
    }
  }

  return currentCoords;
}

/**
 * Generates projection transforms for terminal atoms of multiple bonds attached to the moving end
 * of a candidate, repositioning them at ideal angles relative to the moving atom's other neighbors.
 * @param {object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} baseCoords - Current atom coordinates
 * @param {{ movingId: string, atomIds: Set<string> }} candidate - Multiple-bond candidate
 * @param {object} ctx - Refinement context from buildRefinementContext
 * @returns {Array<Map<string, {x: number, y: number}>>} Array of coordinate-update maps to try
 */
export function buildAttachedMultipleBondProjectionTransforms(molecule, baseCoords, candidate, ctx) {
  const moving = baseCoords.get(candidate.movingId);
  if (!moving) {
    return [];
  }

  const transforms = [];
  for (const bondId of molecule.atoms.get(candidate.movingId)?.bonds ?? []) {
    const bond = molecule.bonds.get(bondId);
    if (!bond || bond.properties.aromatic || (bond.properties.order ?? 1) < 2) {
      continue;
    }
    const childId = bond.getOtherAtom(candidate.movingId);
    if (!candidate.atomIds.has(childId) || molecule.atoms.get(childId)?.name === 'H') {
      continue;
    }

    const childAtoms = collectRefinementSubtree(molecule, childId, candidate.movingId, ctx.frozenAtoms);
    if (!childAtoms || countHeavyAtoms(molecule, childAtoms) !== 1) {
      continue;
    }

    const refIds = _layoutNeighbors(molecule, candidate.movingId)
      .filter(atomId => atomId !== childId)
      .filter(atomId => !childAtoms.has(atomId))
      .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
      .filter(atomId => baseCoords.has(atomId));
    if (refIds.length === 0) {
      continue;
    }

    const idealAngle = idealRefinementAngle(molecule, candidate.movingId);
    const seenAngles = new Set();
    const addAngle = angle => {
      const key = normalizeAngle(angle).toFixed(6);
      if (seenAngles.has(key)) {
        return;
      }
      seenAngles.add(key);
      transforms.push(reprojectSubtreeCoords(baseCoords, childAtoms, candidate.movingId, childId, normalizeAngle(angle), ctx.bondLength));
    };

    if (Math.abs(idealAngle - DEG120) < 1e-6 && refIds.length >= 2) {
      const targetAngle = averageDirectionAwayFromRefs(moving, refIds.map(atomId => baseCoords.get(atomId)).filter(Boolean));
      if (targetAngle != null) {
        addAngle(targetAngle);
      }
    }

    for (const refId of refIds) {
      const refPos = baseCoords.get(refId);
      if (!refPos) {
        continue;
      }
      const refAngle = angleTo(moving, refPos);
      if (idealAngle >= Math.PI - 1e-6) {
        addAngle(refAngle + Math.PI);
      } else {
        addAngle(refAngle + idealAngle);
        addAngle(refAngle - idealAngle);
      }
    }
  }

  return transforms;
}

/**
 * If `molecule` has multiple disconnected components whose bounding boxes
 * overlap (or nearly touch), re-arranges them in a horizontal row with
 * `bondLength * 2` gaps between them, vertically centred at y = 0.
 * Returns the (possibly updated) coords map; the input map is never mutated.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph.
 * @param {Map<string, Vec2>} coords - 2D coordinate map (atom ID → {x, y}).
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, Vec2>} The resulting map.
 */
export function _separateOverlappingComponents(molecule, coords, bondLength) {
  const components = molecule.getComponents();
  if (components.length <= 1) {
    return coords;
  }

  // Build bounding box for each component.
  const compData = components.map(comp => {
    const ids = [...comp.atoms.keys()];
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const id of ids) {
      const p = coords.get(id);
      if (!p) {
        continue;
      }
      if (p.x < minX) {
        minX = p.x;
      }
      if (p.x > maxX) {
        maxX = p.x;
      }
      if (p.y < minY) {
        minY = p.y;
      }
      if (p.y > maxY) {
        maxY = p.y;
      }
    }
    return {
      ids,
      minX: isFinite(minX) ? minX : 0,
      maxX: isFinite(maxX) ? maxX : 0,
      minY: isFinite(minY) ? minY : 0,
      maxY: isFinite(maxY) ? maxY : 0
    };
  });

  // Check whether any pair of components has overlapping (or nearly touching)
  // bounding boxes.  pad prevents "just kissing" layouts from triggering.
  const pad = bondLength * 0.5;
  let needSeparate = false;
  outer: for (let i = 0; i < compData.length; i++) {
    for (let j = i + 1; j < compData.length; j++) {
      const a = compData[i];
      const b = compData[j];
      if (a.maxX + pad > b.minX && b.maxX + pad > a.minX && a.maxY + pad > b.minY && b.maxY + pad > a.minY) {
        needSeparate = true;
        break outer;
      }
    }
  }
  if (!needSeparate) {
    return coords;
  }

  // Re-arrange: lay components out in a horizontal row, each centred at y = 0.
  const gap = bondLength * 2;
  const newCoords = new Map(coords);
  let curX = 0;
  for (const comp of compData) {
    const w = comp.maxX - comp.minX;
    const cy = (comp.minY + comp.maxY) / 2;
    const shiftX = curX - comp.minX;
    const shiftY = -cy;
    for (const id of comp.ids) {
      const p = coords.get(id);
      if (p) {
        newCoords.set(id, vec2(p.x + shiftX, p.y + shiftY));
      }
    }
    curX += w + gap;
  }
  return newCoords;
}

/**
 * Refines already assigned 2D coordinates by trying discrete subtree moves
 * around rotatable single bonds. This is intended as a conservative cleanup
 * pass after an initial layout, not as a replacement for `generateCoords()`.
 *
 * Reads `atom.x` / `atom.y`, mutates them in place when an improving move is
 * found, and returns the final coordinate map.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.bondLength] - Configuration sub-option.
 * @param {number} [options.maxPasses] - Configuration sub-option.
 * @param {boolean} [options.freezeRings] - Configuration sub-option.
 * @param {boolean} [options.freezeChiralCenters] - Configuration sub-option.
 * @param {boolean} [options.allowBranchReflect] - Configuration sub-option.
 * @param {number[]} [options.rotateAngles] Rotation candidates in radians.
 * @param {number} [options.maxCandidatesPerPass] - Maximum number of rotatable-bond candidates evaluated per pass. Capping this keeps refinement interactive for large molecules.
 * @returns {Map<string, { x: number, y: number }>} The resulting map.
 */
