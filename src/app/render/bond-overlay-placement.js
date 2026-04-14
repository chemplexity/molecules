/** @module app/render/bond-overlay-placement */

import { renderBondOrder } from './helpers.js';

const DEFAULT_LABEL_WIDTH_FACTOR = 0.62;
const DEFAULT_LABEL_HEIGHT_FACTOR = 1.2;
const DEFAULT_BOX_PADDING = 3;
const DEFAULT_BLOCKER_PADDING = 4;
const DEFAULT_2D_BOND_OFFSET = 7;
const DEFAULT_WEDGE_HALF_WIDTH = 6;
const DEFAULT_WEDGE_DASHES = 6;

function _segmentBBox(segment) {
  return {
    minX: Math.min(segment.x1, segment.x2),
    maxX: Math.max(segment.x1, segment.x2),
    minY: Math.min(segment.y1, segment.y2),
    maxY: Math.max(segment.y1, segment.y2)
  };
}

function _orientation(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function _onSegment(ax, ay, bx, by, cx, cy) {
  return cx >= Math.min(ax, bx) - 1e-9 && cx <= Math.max(ax, bx) + 1e-9 && cy >= Math.min(ay, by) - 1e-9 && cy <= Math.max(ay, by) + 1e-9;
}

function _segmentsIntersect(first, second) {
  const o1 = _orientation(first.x1, first.y1, first.x2, first.y2, second.x1, second.y1);
  const o2 = _orientation(first.x1, first.y1, first.x2, first.y2, second.x2, second.y2);
  const o3 = _orientation(second.x1, second.y1, second.x2, second.y2, first.x1, first.y1);
  const o4 = _orientation(second.x1, second.y1, second.x2, second.y2, first.x2, first.y2);

  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true;
  }
  if (Math.abs(o1) <= 1e-9 && _onSegment(first.x1, first.y1, first.x2, first.y2, second.x1, second.y1)) {
    return true;
  }
  if (Math.abs(o2) <= 1e-9 && _onSegment(first.x1, first.y1, first.x2, first.y2, second.x2, second.y2)) {
    return true;
  }
  if (Math.abs(o3) <= 1e-9 && _onSegment(second.x1, second.y1, second.x2, second.y2, first.x1, first.y1)) {
    return true;
  }
  if (Math.abs(o4) <= 1e-9 && _onSegment(second.x1, second.y1, second.x2, second.y2, first.x2, first.y2)) {
    return true;
  }
  return false;
}

function _segmentIntersectsExpandedBox(segment, box, padding = DEFAULT_BLOCKER_PADDING) {
  const minX = box.cx - box.hw - padding;
  const maxX = box.cx + box.hw + padding;
  const minY = box.cy - box.hh - padding;
  const maxY = box.cy + box.hh + padding;
  const bbox = _segmentBBox(segment);
  if (bbox.maxX < minX || bbox.minX > maxX || bbox.maxY < minY || bbox.minY > maxY) {
    return false;
  }
  if (
    (segment.x1 >= minX && segment.x1 <= maxX && segment.y1 >= minY && segment.y1 <= maxY) ||
    (segment.x2 >= minX && segment.x2 <= maxX && segment.y2 >= minY && segment.y2 <= maxY)
  ) {
    return true;
  }
  const edges = [
    { x1: minX, y1: minY, x2: maxX, y2: minY },
    { x1: maxX, y1: minY, x2: maxX, y2: maxY },
    { x1: maxX, y1: maxY, x2: minX, y2: maxY },
    { x1: minX, y1: maxY, x2: minX, y2: minY }
  ];
  return edges.some(edge => _segmentsIntersect(segment, edge));
}

function _labelMetrics(label, fontSize) {
  return {
    hw: (label.length * fontSize * DEFAULT_LABEL_WIDTH_FACTOR) / 2,
    hh: (fontSize * DEFAULT_LABEL_HEIGHT_FACTOR) / 2
  };
}

function _boxOverlapsPlaced(candidate, placed) {
  return Math.abs(candidate.cx - placed.cx) < candidate.hw + placed.hw + DEFAULT_BOX_PADDING && Math.abs(candidate.cy - placed.cy) < candidate.hh + placed.hh + DEFAULT_BOX_PADDING;
}

function _countPlacedBoxOverlaps(candidate, placedBoxes) {
  let overlapCount = 0;
  for (const placed of placedBoxes) {
    if (_boxOverlapsPlaced(candidate, placed)) {
      overlapCount++;
    }
  }
  return overlapCount;
}

/**
 * Builds simplified stroke blocker segments for one rendered bond so overlay
 * labels can avoid the actual drawn lines instead of just the bond midpoint.
 * @param {object} options - Stroke construction options.
 * @param {{x: number, y: number}} options.start - Bond start point in screen space.
 * @param {{x: number, y: number}} options.end - Bond end point in screen space.
 * @param {object} [options.bond] - Bond-like object.
 * @param {number} [options.order] - Explicit rendered bond order override.
 * @param {'wedge'|'dash'|null} [options.stereoType] - Explicit stereo display type override.
 * @param {number} [options.preferredSide] - Preferred multiple-bond side (+1 or -1).
 * @param {number} [options.bondOffset] - Parallel line offset in pixels.
 * @param {number} [options.wedgeHalfWidth] - Wide-end half-width for wedge/dash bonds.
 * @param {number} [options.wedgeDashes] - Number of dash strokes in a hashed bond.
 * @returns {Array<{x1: number, y1: number, x2: number, y2: number}>} Stroke blocker segments.
 */
export function buildBondOverlayBlockerSegments({
  start,
  end,
  bond = null,
  order = null,
  stereoType = null,
  preferredSide = 1,
  bondOffset = DEFAULT_2D_BOND_OFFSET,
  wedgeHalfWidth = DEFAULT_WEDGE_HALF_WIDTH,
  wedgeDashes = DEFAULT_WEDGE_DASHES
}) {
  const resolvedOrder = order ?? (bond ? renderBondOrder(bond) : 1);
  const resolvedStereoType = stereoType ?? bond?.properties?.display?.as ?? null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const segments = [];

  if (resolvedStereoType === 'wedge') {
    segments.push(
      { x1: start.x, y1: start.y, x2: end.x - nx * wedgeHalfWidth, y2: end.y - ny * wedgeHalfWidth },
      { x1: start.x, y1: start.y, x2: end.x + nx * wedgeHalfWidth, y2: end.y + ny * wedgeHalfWidth },
      { x1: end.x - nx * wedgeHalfWidth, y1: end.y - ny * wedgeHalfWidth, x2: end.x + nx * wedgeHalfWidth, y2: end.y + ny * wedgeHalfWidth }
    );
    return segments;
  }

  if (resolvedStereoType === 'dash') {
    for (let index = 1; index <= wedgeDashes; index++) {
      const t = index / (wedgeDashes + 1);
      const px = start.x + t * dx;
      const py = start.y + t * dy;
      const halfWidth = wedgeHalfWidth * t;
      segments.push({
        x1: px - nx * halfWidth,
        y1: py - ny * halfWidth,
        x2: px + nx * halfWidth,
        y2: py + ny * halfWidth
      });
    }
    return segments;
  }

  segments.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
  if (resolvedOrder === 2 || resolvedOrder === 1.5) {
    const ox = nx * bondOffset * preferredSide;
    const oy = ny * bondOffset * preferredSide;
    segments.push({ x1: start.x + ox, y1: start.y + oy, x2: end.x + ox, y2: end.y + oy });
  } else if (resolvedOrder === 3) {
    for (const side of [-1, 1]) {
      const ox = nx * bondOffset * side;
      const oy = ny * bondOffset * side;
      segments.push({ x1: start.x + ox, y1: start.y + oy, x2: end.x + ox, y2: end.y + oy });
    }
  }
  return segments;
}

/**
 * Returns the default normal offset used for one bond-overlay label candidate.
 * @param {object} options - Offset options.
 * @param {object} [options.bond] - Bond-like object.
 * @param {number} [options.order] - Explicit rendered bond order override.
 * @param {'wedge'|'dash'|null} [options.stereoType] - Explicit stereo display type override.
 * @param {number} [options.fontSize] - Overlay font size in pixels.
 * @param {number} [options.bondOffset] - Parallel line offset in pixels.
 * @param {number} [options.wedgeHalfWidth] - Wide-end half-width for wedge/dash bonds.
 * @returns {number} Suggested base label offset in pixels.
 */
export function defaultBondOverlayBaseOffset({
  bond = null,
  order = null,
  stereoType = null,
  fontSize = 10,
  bondOffset = DEFAULT_2D_BOND_OFFSET,
  wedgeHalfWidth = DEFAULT_WEDGE_HALF_WIDTH
}) {
  const resolvedOrder = order ?? renderBondOrder(bond);
  const resolvedStereoType = stereoType ?? bond?.properties?.display?.as ?? null;
  if (resolvedStereoType === 'wedge' || resolvedStereoType === 'dash') {
    return Math.max(18, wedgeHalfWidth * 2.4, fontSize * 1.45);
  }
  if (resolvedOrder === 3) {
    return Math.max(17, bondOffset * 2 + fontSize * 0.55);
  }
  if (resolvedOrder === 2 || resolvedOrder === 1.5) {
    return Math.max(15, bondOffset * 1.7 + fontSize * 0.5);
  }
  return Math.max(14, fontSize * 1.3);
}

/**
 * Picks a label center that avoids prior labels and rendered bond strokes.
 * @param {object} options - Placement options.
 * @param {{x: number, y: number}} options.start - Bond start point in screen space.
 * @param {{x: number, y: number}} options.end - Bond end point in screen space.
 * @param {string} options.label - Overlay text label.
 * @param {number} options.fontSize - Overlay font size in pixels.
 * @param {number} [options.preferredSide] - Preferred normal side (+1 or -1).
 * @param {Array<{cx: number, cy: number, hw: number, hh: number}>} [options.placedBoxes] - Already placed label boxes.
 * @param {Array<{x1: number, y1: number, x2: number, y2: number}>} [options.blockerSegments] - Bond stroke blockers to avoid.
 * @param {number} [options.baseOffset] - Starting normal offset in pixels.
 * @returns {{cx: number, cy: number, hw: number, hh: number}} Chosen label box center and half extents.
 */
export function pickBondOverlayLabelPlacement({
  start,
  end,
  label,
  fontSize,
  preferredSide = 1,
  placedBoxes = [],
  blockerSegments = [],
  baseOffset = defaultBondOverlayBaseOffset({ fontSize })
}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const { hw, hh } = _labelMetrics(label, fontSize);
  const normalFactors = [1, 1.5, 2.1, 2.8, 3.5, 4.4, 5.4, 6.6];
  const tangentOffsets = [0, fontSize * 0.8, -fontSize * 0.8, fontSize * 1.5, -fontSize * 1.5, fontSize * 2.3, -fontSize * 2.3, fontSize * 3.2, -fontSize * 3.2];
  let best = {
    cx: mx + nx * baseOffset * preferredSide,
    cy: my + ny * baseOffset * preferredSide,
    hw,
    hh,
    score: Infinity
  };

  for (const normalFactor of normalFactors) {
    for (const side of [preferredSide, -preferredSide]) {
      for (const tangentOffset of tangentOffsets) {
        const cx = mx + nx * baseOffset * normalFactor * side + tx * tangentOffset;
        const cy = my + ny * baseOffset * normalFactor * side + ty * tangentOffset;
        const candidate = { cx, cy, hw, hh };
        const placedOverlapCount = _countPlacedBoxOverlaps(candidate, placedBoxes);
        let blockerOverlapCount = 0;
        for (const blocker of blockerSegments) {
          if (_segmentIntersectsExpandedBox(blocker, candidate, DEFAULT_BLOCKER_PADDING)) {
            blockerOverlapCount++;
          }
        }
        const score = placedOverlapCount * 100000 + blockerOverlapCount * 1000 + (side !== preferredSide ? 100 : 0) + normalFactor * 10 + Math.abs(tangentOffset);
        if (score < best.score) {
          best = { ...candidate, score };
        }
        if (score === normalFactor * 10) {
          return candidate;
        }
      }
    }
  }
  return { cx: best.cx, cy: best.cy, hw: best.hw, hh: best.hh };
}

/**
 * Places a bond-overlay label above a visible hydrogen so X-H labels stay
 * associated with the hydrogen atom instead of competing for midpoint space.
 * @param {object} options - Placement options.
 * @param {{x: number, y: number}} options.hydrogenPoint - Hydrogen node position.
 * @param {{x: number, y: number}} options.otherPoint - Position of the non-hydrogen bond endpoint.
 * @param {string} options.label - Overlay text label.
 * @param {number} options.fontSize - Overlay font size in pixels.
 * @param {number} options.hydrogenRadius - Rendered hydrogen node radius in pixels.
 * @param {Array<{cx: number, cy: number, hw: number, hh: number}>} [options.placedBoxes] - Already placed label boxes.
 * @returns {{cx: number, cy: number, hw: number, hh: number}} Chosen hydrogen-attached label placement.
 */
export function pickHydrogenBondOverlayPlacement({ hydrogenPoint, otherPoint, label, fontSize, hydrogenRadius, placedBoxes = [] }) {
  const { hw, hh } = _labelMetrics(label, fontSize);
  const dx = hydrogenPoint.x - otherPoint.x;
  const dy = hydrogenPoint.y - otherPoint.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const outwardDistance = hydrogenRadius + hh + fontSize * 0.55;
  const sideDistance = Math.min(fontSize * 0.7, hydrogenRadius * 0.55);
  const outwardScales = [1, 1.35, 1.75, 2.2, 2.8, 3.6, 4.6];
  const sideScales = [0, 1, -1, 1.8, -1.8, 2.6, -2.6, 3.6, -3.6, 4.8, -4.8];
  let best = {
    cx: hydrogenPoint.x + ux * outwardDistance,
    cy: hydrogenPoint.y + uy * outwardDistance,
    hw,
    hh,
    score: Infinity
  };

  for (const outwardScale of outwardScales) {
    for (const sideScale of sideScales) {
      const candidate = {
        cx: hydrogenPoint.x + ux * outwardDistance * outwardScale + nx * sideDistance * sideScale,
        cy: hydrogenPoint.y + uy * outwardDistance * outwardScale + ny * sideDistance * sideScale,
        hw,
        hh
      };
      const overlapCount = _countPlacedBoxOverlaps(candidate, placedBoxes);
      const score = overlapCount * 1000 + Math.abs(outwardScale - 1) * 20 + Math.abs(sideScale) * 5;
      if (score < best.score) {
        best = { ...candidate, score };
      }
      if (score === 0) {
        return candidate;
      }
    }
  }

  return { cx: best.cx, cy: best.cy, hw: best.hw, hh: best.hh };
}

/**
 * Returns whether a placed bond-overlay label box intersects any stroke blocker.
 * @param {{cx: number, cy: number, hw: number, hh: number}} placement - Candidate label placement.
 * @param {Array<{x1: number, y1: number, x2: number, y2: number}>} blockerSegments - Stroke blockers to inspect.
 * @returns {boolean} True when any blocker intersects the expanded label box.
 */
export function bondOverlayPlacementHitsBlockers(placement, blockerSegments) {
  return blockerSegments.some(segment => _segmentIntersectsExpandedBox(segment, placement, DEFAULT_BLOCKER_PADDING));
}
