/** @module cleanup/label-clearance */

import { atomPairKey, CLEANUP_EPSILON, LABEL_CLEARANCE_NUDGE_FACTOR, LABEL_CLEARANCE_PADDING_FACTOR, SEVERE_OVERLAP_FACTOR } from '../constants.js';
import { collectLabelBoxes, labelBoxesOverlap } from '../geometry/label-box.js';
import { buildAtomGrid } from '../audit/invariants.js';
import { centroid } from '../geometry/vec2.js';

const TERMINAL_LABEL_ROTATION_OFFSETS = Object.freeze([
  0,
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2
]);
const TERMINAL_LABEL_LOCAL_ROTATION_OFFSETS = Object.freeze([
  Math.PI / 36,
  -Math.PI / 36,
  Math.PI / 18,
  -Math.PI / 18,
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 9,
  -Math.PI / 9
]);

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
 * Finds the single heavy covalent anchor for a terminal label atom.
 * Multiple-bond terminal leaves are only considered when explicitly enabled,
 * and callers should keep those moves to small local rotations.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Candidate terminal atom id.
 * @param {object} [options] - Anchor options.
 * @param {boolean} [options.allowMultipleBondLeaf] - Whether terminal multiple-bond leaves may rotate.
 * @returns {string|null} Anchor atom id, or null when the atom is not eligible.
 */
function terminalRotatableLabelAnchorAtomId(layoutGraph, coords, atomId, options = {}) {
  const allowMultipleBondLeaf = options.allowMultipleBondLeaf === true;
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.heavyDegree !== 1 || layoutGraph.fixedCoords?.has(atomId)) {
    return null;
  }
  let anchorAtomId = null;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      continue;
    }
    const bondOrder = bond.order ?? 1;
    if (bondOrder !== 1 && !allowMultipleBondLeaf) {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    if (anchorAtomId) {
      return null;
    }
    anchorAtomId = neighborAtomId;
  }
  return anchorAtomId;
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
 * Computes the total overlap penalty for one label against all other labels.
 * @param {Array<{x: number, y: number, halfWidth: number, halfHeight: number}>} labels - Collected label boxes.
 * @param {number} labelIndex - Index of the focused label.
 * @param {{x: number, y: number, halfWidth: number, halfHeight: number}} labelBox - Candidate label box.
 * @param {number} padding - Extra label padding.
 * @returns {number} Total overlap penalty for the focused label.
 */
function labelPenaltyAgainstOthers(labels, labelIndex, labelBox, padding) {
  let penalty = 0;
  for (let index = 0; index < labels.length; index++) {
    if (index === labelIndex) {
      continue;
    }
    penalty += overlapPenalty(labelBox, labels[index], padding);
  }
  return penalty;
}

/**
 * Returns whether moving an atom to a candidate position would create a local
 * severe overlap with an unbonded visible atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} atomGrid - Spatial atom grid for the current coordinates.
 * @param {string} atomId - Atom being moved.
 * @param {{x: number, y: number}} candidatePosition - Candidate atom position.
 * @param {number} overlapDistanceThreshold - Severe-overlap distance threshold.
 * @returns {boolean} True when the candidate would introduce a severe overlap.
 */
function introducesSevereOverlap(layoutGraph, coords, atomGrid, atomId, candidatePosition, overlapDistanceThreshold) {
  const localOverlaps = atomGrid.queryRadius(candidatePosition, overlapDistanceThreshold);
  for (const otherAtomId of localOverlaps) {
    if (otherAtomId === atomId) {
      continue;
    }
    const otherAtom = layoutGraph.atoms.get(otherAtomId);
    if (!otherAtom || (layoutGraph.options.suppressH && otherAtom.element === 'H')) {
      continue;
    }
    const pairId = atomId < otherAtomId ? `${atomId}:${otherAtomId}` : `${otherAtomId}:${atomId}`;
    if (layoutGraph.bondedPairSet.has(pairId)) {
      continue;
    }
    const otherPosition = coords.get(otherAtomId);
    if (!otherPosition) {
      continue;
    }
    const dist = Math.hypot(otherPosition.x - candidatePosition.x, otherPosition.y - candidatePosition.y);
    if (dist < overlapDistanceThreshold) {
      return true;
    }
  }
  return false;
}

/**
 * Selects a terminal leaf rotation that reduces label overlap while preserving
 * the leaf bond length exactly.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} atomGrid - Spatial atom grid for the current coordinates.
 * @param {Array<{x: number, y: number, halfWidth: number, halfHeight: number}>} labels - Collected label boxes.
 * @param {number} labelIndex - Focused label index.
 * @param {{x: number, y: number, halfWidth: number, halfHeight: number}} otherLabel - Other overlapping label.
 * @param {number} padding - Extra label padding.
 * @param {number} overlapDistanceThreshold - Severe-overlap distance threshold.
 * @param {boolean} [allowMultipleBondLeafRotation] - Whether terminal multiple-bond leaves may rotate.
 * @returns {{position: {x: number, y: number}, penalty: number}|null} Best terminal rotation candidate.
 */
function selectTerminalLabelRotation(
  layoutGraph,
  coords,
  atomGrid,
  labels,
  labelIndex,
  otherLabel,
  padding,
  overlapDistanceThreshold,
  allowMultipleBondLeafRotation = false
) {
  const label = labels[labelIndex];
  const atomId = label.atomId;
  const anchorAtomId = terminalRotatableLabelAnchorAtomId(layoutGraph, coords, atomId, {
    allowMultipleBondLeaf: allowMultipleBondLeafRotation
  });
  if (!anchorAtomId) {
    return null;
  }
  const anchorBond = layoutGraph.bondByAtomPair?.get(atomPairKey(atomId, anchorAtomId)) ?? null;
  const isMultipleBondLeaf = (anchorBond?.order ?? 1) !== 1;
  const atomPosition = coords.get(atomId);
  const anchorPosition = coords.get(anchorAtomId);
  if (!atomPosition || !anchorPosition) {
    return null;
  }

  const radius = Math.hypot(atomPosition.x - anchorPosition.x, atomPosition.y - anchorPosition.y);
  if (radius <= CLEANUP_EPSILON) {
    return null;
  }
  const currentPenalty = labelPenaltyAgainstOthers(labels, labelIndex, label, padding);
  const currentAngle = Math.atan2(atomPosition.y - anchorPosition.y, atomPosition.x - anchorPosition.x);
  const awayAngle = Math.atan2(anchorPosition.y - otherLabel.y, anchorPosition.x - otherLabel.x);
  const candidateAngles = isMultipleBondLeaf
    ? TERMINAL_LABEL_LOCAL_ROTATION_OFFSETS.map(offset => currentAngle + offset)
    : [
        ...TERMINAL_LABEL_LOCAL_ROTATION_OFFSETS.map(offset => currentAngle + offset),
        ...TERMINAL_LABEL_ROTATION_OFFSETS.map(offset => awayAngle + offset)
      ];
  let bestCandidate = null;

  for (const angle of candidateAngles) {
    const candidatePosition = {
      x: anchorPosition.x + Math.cos(angle) * radius,
      y: anchorPosition.y + Math.sin(angle) * radius
    };
    const candidateLabel = {
      ...label,
      x: candidatePosition.x,
      y: candidatePosition.y
    };
    const candidatePenalty = labelPenaltyAgainstOthers(labels, labelIndex, candidateLabel, padding);
    if (candidatePenalty >= currentPenalty - CLEANUP_EPSILON) {
      continue;
    }
    if (introducesSevereOverlap(layoutGraph, coords, atomGrid, atomId, candidatePosition, overlapDistanceThreshold)) {
      continue;
    }
    if (!bestCandidate || candidatePenalty < bestCandidate.penalty - CLEANUP_EPSILON) {
      bestCandidate = {
        position: candidatePosition,
        penalty: candidatePenalty
      };
    }
  }
  return bestCandidate;
}

/**
 * Applies a conservative label-clearance pass using estimated label boxes.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Clearance options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {object|null} [options.labelMetrics] - Optional renderer-supplied label metrics.
 * @param {boolean} [options.allowTerminalLeafRotation] - Whether terminal single-bond label leaves may rotate around their anchor.
 * @param {boolean} [options.allowTerminalMultipleBondLeafRotation] - Whether terminal multiple-bond label leaves may make small local rotations around their anchor.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Updated coordinates and nudge count.
 */
export function applyLabelClearance(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const labelMetrics = options.labelMetrics ?? layoutGraph.options.labelMetrics ?? null;
  const allowTerminalLeafRotation = options.allowTerminalLeafRotation === true;
  const allowTerminalMultipleBondLeafRotation = options.allowTerminalMultipleBondLeafRotation === true;
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

      let rotationCandidate = allowTerminalLeafRotation
        ? selectTerminalLabelRotation(
            layoutGraph,
            coords,
            atomGrid,
            labels,
            firstIndex,
            secondLabel,
            padding,
            overlapDistanceThreshold,
            allowTerminalMultipleBondLeafRotation
          )
        : null;
      let movedLabel = firstLabel;
      if (allowTerminalLeafRotation && !rotationCandidate) {
        rotationCandidate = selectTerminalLabelRotation(
          layoutGraph,
          coords,
          atomGrid,
          labels,
          secondIndex,
          firstLabel,
          padding,
          overlapDistanceThreshold,
          allowTerminalMultipleBondLeafRotation
        );
        movedLabel = secondLabel;
      }
      if (rotationCandidate) {
        const position = coords.get(movedLabel.atomId);
        atomGrid.remove(movedLabel.atomId, position);
        position.x = rotationCandidate.position.x;
        position.y = rotationCandidate.position.y;
        atomGrid.insert(movedLabel.atomId, position);
        movedLabel.x = rotationCandidate.position.x;
        movedLabel.y = rotationCandidate.position.y;
        nudges++;
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

      if (introducesSevereOverlap(layoutGraph, coords, atomGrid, secondLabel.atomId, candidatePosition, overlapDistanceThreshold)) {
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
