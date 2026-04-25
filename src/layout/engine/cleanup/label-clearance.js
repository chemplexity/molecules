/** @module cleanup/label-clearance */

import { CLEANUP_EPSILON, LABEL_CLEARANCE_NUDGE_FACTOR, LABEL_CLEARANCE_PADDING_FACTOR, SEVERE_OVERLAP_FACTOR } from '../constants.js';
import { collectLabelBoxes, labelBoxesOverlap } from '../geometry/label-box.js';
import { buildAtomGrid } from '../audit/invariants.js';
import { centroid } from '../geometry/vec2.js';

/**
 * Computes a scalar penalty for the overlap between two axis-aligned label boxes.
 * @param {{x: number, y: number, halfWidth: number, halfHeight: number}} firstBox - First label box.
 * @param {{x: number, y: number, halfWidth: number, halfHeight: number}} secondBox - Second label box.
 * @param {number} padding - Extra label padding.
 * @returns {number} Positive overlap penalty, or zero when the boxes do not overlap.
 */
function overlapPenalty(firstBox, secondBox, padding) {
  const overlapX = firstBox.halfWidth + secondBox.halfWidth + padding - Math.abs(firstBox.x - secondBox.x);
  const overlapY = firstBox.halfHeight + secondBox.halfHeight + padding - Math.abs(firstBox.y - secondBox.y);
  if (overlapX <= 0 || overlapY <= 0) {
    return 0;
  }
  return overlapX + overlapY;
}

/**
 * Measures the worst heavy-atom bond-length deviation attached to a moved atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Atom whose attached heavy-atom bonds are inspected.
 * @param {{x: number, y: number}} position - Candidate position for the atom.
 * @param {number} bondLength - Target bond length.
 * @returns {number} Maximum attached heavy-atom bond-length deviation.
 */
function attachedHeavyBondDeviation(layoutGraph, coords, atomId, position, bondLength) {
  let maxDeviation = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborPosition) {
      continue;
    }
    const distance = Math.hypot(neighborPosition.x - position.x, neighborPosition.y - position.y);
    maxDeviation = Math.max(maxDeviation, Math.abs(distance - bondLength));
  }
  return maxDeviation;
}

/**
 * Returns whether any collected label boxes currently overlap.
 * @param {Array<{x: number, y: number, halfWidth: number, halfHeight: number}>} labels - Collected label boxes.
 * @param {number} padding - Extra label padding.
 * @returns {boolean} True when at least one pair of labels overlaps.
 */
function hasAnyLabelOverlap(labels, padding) {
  for (let firstIndex = 0; firstIndex < labels.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < labels.length; secondIndex++) {
      if (labelBoxesOverlap(labels[firstIndex], labels[secondIndex], padding)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Applies a conservative label-clearance pass using estimated label boxes.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Clearance options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {object|null} [options.labelMetrics] - Optional renderer-supplied label metrics.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Updated coordinates and nudge count.
 */
export function applyLabelClearance(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const labelMetrics = options.labelMetrics ?? layoutGraph.options.labelMetrics ?? null;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const padding = bondLength * LABEL_CLEARANCE_PADDING_FACTOR;
  const labels = collectLabelBoxes(layoutGraph, coords, bondLength, { labelMetrics });
  if (labels.length < 2 || !hasAnyLabelOverlap(labels, padding)) {
    return { coords, nudges: 0 };
  }

  const center = centroid([...coords.values()]);
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  const overlapDistanceThreshold = bondLength * SEVERE_OVERLAP_FACTOR;
  let nudges = 0;

  for (let firstIndex = 0; firstIndex < labels.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < labels.length; secondIndex++) {
      const firstLabel = labels[firstIndex];
      const secondLabel = labels[secondIndex];
      if (!labelBoxesOverlap(firstLabel, secondLabel, padding)) {
        continue;
      }

      const secondAtom = layoutGraph.atoms.get(secondLabel.atomId);
      if (!secondAtom || secondAtom.heavyDegree > 1) {
        continue;
      }
      const position = coords.get(secondLabel.atomId);
      const currentBondDeviation = attachedHeavyBondDeviation(layoutGraph, coords, secondLabel.atomId, position, bondLength);
      const dx = position.x - center.x;
      const dy = position.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      const candidatePosition = {
        x: position.x + (dx / length) * bondLength * LABEL_CLEARANCE_NUDGE_FACTOR,
        y: position.y + (dy / length) * bondLength * LABEL_CLEARANCE_NUDGE_FACTOR
      };
      const currentPenalty = overlapPenalty(firstLabel, secondLabel, padding);
      const candidateLabel = {
        ...secondLabel,
        x: candidatePosition.x,
        y: candidatePosition.y
      };
      const candidatePenalty = overlapPenalty(firstLabel, candidateLabel, padding);
      if (candidatePenalty >= currentPenalty) {
        continue;
      }
      const candidateBondDeviation = attachedHeavyBondDeviation(layoutGraph, coords, secondLabel.atomId, candidatePosition, bondLength);
      if (candidateBondDeviation > currentBondDeviation + CLEANUP_EPSILON) {
        continue;
      }

      const localOverlaps = atomGrid.queryRadius(candidatePosition, overlapDistanceThreshold);
      let introducedSevereOverlap = false;
      for (const otherAtomId of localOverlaps) {
        if (otherAtomId === secondLabel.atomId) {
          continue;
        }
        const otherAtom = layoutGraph.atoms.get(otherAtomId);
        if (!otherAtom || (layoutGraph.options.suppressH && otherAtom.element === 'H')) {
          continue;
        }
        const pairId = secondLabel.atomId < otherAtomId ? `${secondLabel.atomId}:${otherAtomId}` : `${otherAtomId}:${secondLabel.atomId}`;
        if (layoutGraph.bondedPairSet.has(pairId)) {
          continue;
        }
        const otherPosition = coords.get(otherAtomId);
        if (!otherPosition) {
          continue;
        }
        const dist = Math.hypot(otherPosition.x - candidatePosition.x, otherPosition.y - candidatePosition.y);
        if (dist < overlapDistanceThreshold) {
          introducedSevereOverlap = true;
          break;
        }
      }

      if (introducedSevereOverlap) {
        continue;
      }

      atomGrid.remove(secondLabel.atomId, position);
      position.x = candidatePosition.x;
      position.y = candidatePosition.y;
      atomGrid.insert(secondLabel.atomId, position);

      secondLabel.x = candidatePosition.x;
      secondLabel.y = candidatePosition.y;
      nudges++;
    }
  }

  return { coords, nudges };
}
