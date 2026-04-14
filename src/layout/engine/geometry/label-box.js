/** @module geometry/label-box */

import { LABEL_WIDTH_FACTORS } from '../constants.js';

/**
 * Returns the visible label text for an atom in 2D layout.
 * @param {object|null|undefined} atom - Layout atom.
 * @returns {string} Visible label text, or an empty string for unlabeled atoms.
 */
export function atomLabelText(atom) {
  if (!atom) {
    return '';
  }
  if (atom.element === 'H') {
    return '';
  }
  const charge = atom.charge ?? 0;
  const chargeText = charge === 0 ? '' : charge > 0 ? `+${charge === 1 ? '' : charge}` : `${charge === -1 ? '-' : String(charge)}`;
  if (atom.element === 'C' && charge === 0 && (atom.heavyDegree ?? 0) > 0) {
    return '';
  }
  return `${atom.element}${chargeText}`;
}

/**
 * Returns the width multiplier for a label with the requested character count.
 * @param {number} characterCount - Visible label character count.
 * @returns {number} Width multiplier relative to a one-character label.
 */
export function labelWidthFactor(characterCount) {
  return LABEL_WIDTH_FACTORS.get(characterCount) ?? 1 + Math.max(0, characterCount - 1) * 0.55;
}

/**
 * Estimates half the axis-aligned size of a rendered atom label.
 * @param {string} labelText - Visible label text.
 * @param {number} bondLength - Target bond length.
 * @param {object|null} [labelMetrics] - Optional renderer-supplied label metrics.
 * @returns {{halfWidth: number, halfHeight: number}|null} Estimated half size, or null when the atom is unlabeled.
 */
export function estimateLabelHalfSize(labelText, bondLength, labelMetrics = null) {
  if (!labelText) {
    return null;
  }
  const averageCharWidth = labelMetrics?.averageCharWidth ?? bondLength * 0.22;
  const textHeight = labelMetrics?.textHeight ?? bondLength * 0.32;
  return {
    halfWidth: averageCharWidth * labelWidthFactor(labelText.length),
    halfHeight: textHeight * 0.5
  };
}

/**
 * Collects estimated label boxes for all labeled atoms in the current coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Label-box options.
 * @param {object|null} [options.labelMetrics] - Optional renderer-supplied label metrics.
 * @returns {Array<{atomId: string, x: number, y: number, halfWidth: number, halfHeight: number}>} Label boxes.
 */
export function collectLabelBoxes(layoutGraph, coords, bondLength, options = {}) {
  const labelMetrics = options.labelMetrics ?? layoutGraph.options.labelMetrics ?? null;
  return [...coords.keys()]
    .map(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      const size = estimateLabelHalfSize(atomLabelText(atom), bondLength, labelMetrics);
      if (!size) {
        return null;
      }
      const position = coords.get(atomId);
      if (!position) {
        return null;
      }
      return {
        atomId,
        x: position.x,
        y: position.y,
        ...size
      };
    })
    .filter(Boolean);
}

/**
 * Returns whether two label boxes overlap after padding is applied.
 * @param {{x: number, y: number, halfWidth: number, halfHeight: number}} firstBox - First box.
 * @param {{x: number, y: number, halfWidth: number, halfHeight: number}} secondBox - Second box.
 * @param {number} padding - Extra box padding.
 * @returns {boolean} True when the boxes overlap.
 */
export function labelBoxesOverlap(firstBox, secondBox, padding) {
  return (
    Math.abs(firstBox.x - secondBox.x) < firstBox.halfWidth + secondBox.halfWidth + padding &&
    Math.abs(firstBox.y - secondBox.y) < firstBox.halfHeight + secondBox.halfHeight + padding
  );
}

/**
 * Finds overlapping estimated label boxes in the current coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Label-overlap options.
 * @param {number} [options.padding] - Extra overlap padding.
 * @param {object|null} [options.labelMetrics] - Optional renderer-supplied label metrics.
 * @param {Array<{atomId: string, x: number, y: number, halfWidth: number, halfHeight: number}>} [options.labelBoxes] - Optional reused label boxes.
 * @returns {Array<{firstAtomId: string, secondAtomId: string, overlapX: number, overlapY: number}>} Overlapping label pairs.
 */
export function findLabelOverlaps(layoutGraph, coords, bondLength, options = {}) {
  const padding = options.padding ?? bondLength * 0.08;
  const labelBoxes =
    options.labelBoxes ??
    collectLabelBoxes(layoutGraph, coords, bondLength, {
      labelMetrics: options.labelMetrics
    });
  const overlaps = [];

  for (let firstIndex = 0; firstIndex < labelBoxes.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < labelBoxes.length; secondIndex++) {
      const firstBox = labelBoxes[firstIndex];
      const secondBox = labelBoxes[secondIndex];
      if (!labelBoxesOverlap(firstBox, secondBox, padding)) {
        continue;
      }
      overlaps.push({
        firstAtomId: firstBox.atomId,
        secondAtomId: secondBox.atomId,
        overlapX: firstBox.halfWidth + secondBox.halfWidth + padding - Math.abs(firstBox.x - secondBox.x),
        overlapY: firstBox.halfHeight + secondBox.halfHeight + padding - Math.abs(firstBox.y - secondBox.y)
      });
    }
  }

  return overlaps;
}
