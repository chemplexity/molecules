/** @module cleanup/label-clearance */

import { findSevereOverlaps, measureLayoutCost } from '../audit/invariants.js';
import { centroid } from '../geometry/vec2.js';

function atomLabelText(atom) {
  if (!atom) {
    return '';
  }
  const charge = atom.charge ?? 0;
  const chargeText = charge === 0
    ? ''
    : charge > 0
      ? `+${charge === 1 ? '' : charge}`
      : `${charge === -1 ? '-' : String(charge)}`;
  if (atom.element === 'C' && charge === 0 && atom.visible !== true) {
    return '';
  }
  return `${atom.element}${chargeText}`;
}

function estimateHalfSize(labelText, bondLength, labelMetrics = null) {
  if (!labelText) {
    return null;
  }
  const charWidth = labelMetrics?.averageCharWidth ?? (bondLength * 0.22);
  const textHeight = labelMetrics?.textHeight ?? (bondLength * 0.32);
  return {
    halfWidth: Math.max(charWidth, labelText.length * charWidth * 0.5),
    halfHeight: textHeight * 0.5
  };
}

function boxesOverlap(firstBox, secondBox, padding) {
  return Math.abs(firstBox.x - secondBox.x) < (firstBox.halfWidth + secondBox.halfWidth + padding)
    && Math.abs(firstBox.y - secondBox.y) < (firstBox.halfHeight + secondBox.halfHeight + padding);
}

function overlapPenalty(firstBox, secondBox, padding) {
  const overlapX = (firstBox.halfWidth + secondBox.halfWidth + padding) - Math.abs(firstBox.x - secondBox.x);
  const overlapY = (firstBox.halfHeight + secondBox.halfHeight + padding) - Math.abs(firstBox.y - secondBox.y);
  if (overlapX <= 0 || overlapY <= 0) {
    return 0;
  }
  return overlapX + overlapY;
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
  const center = centroid([...coords.values()]);
  const padding = bondLength * 0.08;
  let currentSevereOverlapCount = findSevereOverlaps(layoutGraph, coords, bondLength).length;
  let currentLayoutCost = measureLayoutCost(layoutGraph, coords, bondLength);
  let nudges = 0;

  const labels = [...coords.keys()]
    .map(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      const labelText = atomLabelText(atom);
      const size = estimateHalfSize(labelText, bondLength, labelMetrics);
      if (!size) {
        return null;
      }
      const position = coords.get(atomId);
      return {
        atomId,
        x: position.x,
        y: position.y,
        ...size
      };
    })
    .filter(Boolean);

  for (let firstIndex = 0; firstIndex < labels.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < labels.length; secondIndex++) {
      const firstLabel = labels[firstIndex];
      const secondLabel = labels[secondIndex];
      if (!boxesOverlap(firstLabel, secondLabel, padding)) {
        continue;
      }

      const secondAtom = layoutGraph.atoms.get(secondLabel.atomId);
      if (!secondAtom || secondAtom.heavyDegree > 1) {
        continue;
      }
      const position = coords.get(secondLabel.atomId);
      const dx = position.x - center.x;
      const dy = position.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      const candidatePosition = {
        x: position.x + ((dx / length) * bondLength * 0.2),
        y: position.y + ((dy / length) * bondLength * 0.2)
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

      const candidateCoords = new Map([...coords.entries()].map(([atomId, candidate]) => [atomId, { ...candidate }]));
      candidateCoords.set(secondLabel.atomId, candidatePosition);
      const candidateSevereOverlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
      if (candidateSevereOverlapCount > currentSevereOverlapCount) {
        continue;
      }
      const candidateLayoutCost = measureLayoutCost(layoutGraph, candidateCoords, bondLength);
      if (candidateLayoutCost > currentLayoutCost + 1e-6) {
        continue;
      }

      position.x = candidatePosition.x;
      position.y = candidatePosition.y;
      secondLabel.x = candidatePosition.x;
      secondLabel.y = candidatePosition.y;
      currentSevereOverlapCount = candidateSevereOverlapCount;
      currentLayoutCost = candidateLayoutCost;
      nudges++;
    }
  }

  return { coords, nudges };
}
