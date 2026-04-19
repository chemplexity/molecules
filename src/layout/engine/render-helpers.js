/** @module render-helpers */

import { getRingAtomIds } from './topology/ring-analysis.js';

export const CPK = {
  H: '#333333',
  He: '#D9FFFF',
  Li: '#7D828A',
  Be: '#70757D',
  B: '#FFB5B5',
  C: '#333333',
  N: '#3050F8',
  O: '#FF0D0D',
  F: '#90E050',
  Ne: '#B3E3F5',
  Na: '#767B83',
  Mg: '#5E636B',
  Al: '#7A7E85',
  Si: '#F0C8A0',
  P: '#FF8000',
  S: '#C8A000',
  Cl: '#1FF01F',
  Ar: '#80D1E3',
  K: '#6F747C',
  Ca: '#747981',
  Sc: '#9CA1A8',
  Ti: '#9298A0',
  V: '#7E848D',
  Cr: '#808791',
  Mn: '#7B808A',
  Fe: '#7A8088',
  Co: '#6F7680',
  Ni: '#737A83',
  Cu: '#C88033',
  Zn: '#8D939C',
  Ag: '#C0C0C0',
  Pt: '#C9CDD2',
  Au: '#D4AF37',
  Hg: '#B8C3CF',
  Br: '#A62929',
  I: '#940094'
};

const DEFAULT_COLOR = '#FF69B4';
const TAU = Math.PI * 2;

export const WEDGE_HALF_W = 6;
export const WEDGE_DASHES = 6;

/**
 * Returns the CPK fill color for an element symbol.
 * @param {string} symbol - Element symbol.
 * @returns {string} Hex color string.
 */
export function atomColor(symbol) {
  return CPK[symbol] ?? DEFAULT_COLOR;
}

/**
 * Returns the length of a 2D vector.
 * @param {number} x - X delta.
 * @param {number} y - Y delta.
 * @returns {number} Vector length.
 */
export function vecLen(x, y) {
  return Math.sqrt(x * x + y * y) || 1;
}

/**
 * Computes an axis-aligned bounding box for atoms with coordinates.
 * @param {Array<{x: number, y: number}>} atoms - Coordinate-bearing atoms.
 * @returns {{minX: number, maxX: number, minY: number, maxY: number, cx: number, cy: number}} Bounding box.
 */
export function atomBBox(atoms) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const atom of atoms) {
    minX = Math.min(minX, atom.x);
    maxX = Math.max(maxX, atom.x);
    minY = Math.min(minY, atom.y);
    maxY = Math.max(maxY, atom.y);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  };
}

/**
 * Returns a unit vector perpendicular to the input vector.
 * @param {number} dx - X delta.
 * @param {number} dy - Y delta.
 * @returns {{nx: number, ny: number}} Perpendicular unit vector.
 */
export function perpUnit(dx, dy) {
  const len = vecLen(dx, dy);
  return { nx: -dy / len, ny: dx / len };
}

/**
 * Shortens a line segment by the given distances at its endpoints.
 * @param {number} x1 - Start x.
 * @param {number} y1 - Start y.
 * @param {number} x2 - End x.
 * @param {number} y2 - End y.
 * @param {number} d1 - Trim distance at the start.
 * @param {number} d2 - Trim distance at the end.
 * @returns {{x1: number, y1: number, x2: number, y2: number}} Shortened segment.
 */
export function shortenLine(x1, y1, x2, y2, d1, d2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = vecLen(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: x1 + ux * d1,
    y1: y1 + uy * d1,
    x2: x2 - ux * d2,
    y2: y2 - uy * d2
  };
}

/**
 * Chooses which side of a bond should receive the secondary parallel line.
 * @param {object} firstAtom - First atom.
 * @param {object} secondAtom - Second atom.
 * @param {object} molecule - Molecule graph.
 * @param {(atom: object) => {x: number, y: number}} toSVG - Atom-to-SVG mapper.
 * @returns {1|-1} Side indicator.
 */
export function secondaryDir(firstAtom, secondAtom, molecule, toSVG) {
  const start = toSVG(firstAtom);
  const end = toSVG(secondAtom);
  const { nx, ny } = perpUnit(end.x - start.x, end.y - start.y);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  const ringDots = getRingAtomIds(molecule)
    .filter(ring => ring.includes(firstAtom.id) && ring.includes(secondAtom.id))
    .map(ring => {
      const points = ring
        .map(atomId => molecule.atoms.get(atomId))
        .filter(Boolean)
        .map(atom => toSVG(atom));
      if (points.length < 3) {
        return null;
      }
      const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      return (centerX - midX) * nx + (centerY - midY) * ny;
    })
    .filter(dot => dot != null && Math.abs(dot) > 1e-6);

  if (ringDots.length > 0) {
    const firstSign = Math.sign(ringDots[0]);
    if (ringDots.every(dot => Math.sign(dot) === firstSign)) {
      return firstSign >= 0 ? 1 : -1;
    }
  }

  const neighbors = atom =>
    atom.getNeighbors(molecule).filter(neighbor => neighbor && neighbor.id !== firstAtom.id && neighbor.id !== secondAtom.id && neighbor.name !== 'H' && neighbor.x != null);
  const allNeighbors = [...neighbors(firstAtom), ...neighbors(secondAtom)];
  if (allNeighbors.length === 0) {
    return 1;
  }

  let dot = 0;
  for (const neighbor of allNeighbors) {
    const point = toSVG(neighbor);
    dot += (point.x - midX) * nx + (point.y - midY) * ny;
  }
  return dot >= 0 ? 1 : -1;
}

/**
 * Computes half the label width in render pixels.
 * @param {string|null} label - Atom label.
 * @param {number} fontSize - Font size.
 * @returns {number} Half width.
 */
export function labelHalfW(label, fontSize) {
  if (!label) {
    return 0;
  }
  return fontSize * 0.38 * label.length + 4;
}

/**
 * Computes half the label height in render pixels.
 * @param {string|null} label - Atom label.
 * @param {number} fontSize - Font size.
 * @returns {number} Half height.
 */
export function labelHalfH(label, fontSize) {
  if (!label) {
    return 0;
  }
  const subscriptDescent = /\d/.test(label) ? fontSize * 0.18 : 0;
  return fontSize * 0.58 + 2 + subscriptDescent;
}

/**
 * Returns the text offset that keeps an attached H fragment balanced.
 * @param {string|null} label - Atom label.
 * @param {number} fontSize - Font size.
 * @returns {number} Text offset.
 */
export function labelTextOffset(label, fontSize) {
  if (!label) {
    return 0;
  }
  const prefixMatch = label.match(/^(H\d*)([A-Z][a-z]?)$/);
  if (prefixMatch) {
    return -(fontSize * 0.38 * prefixMatch[1].length) / 2;
  }
  const suffixMatch = label.match(/^([A-Z][a-z]?)(H\d*)$/);
  if (suffixMatch) {
    return (fontSize * 0.38 * suffixMatch[2].length) / 2;
  }
  return 0;
}

function rayDistanceToShiftedBox(angle, centerX, centerY, halfWidth, halfHeight) {
  if (halfWidth <= 0 || halfHeight <= 0) {
    return 0;
  }
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const candidates = [];
  const minX = centerX - halfWidth;
  const maxX = centerX + halfWidth;
  const minY = centerY - halfHeight;
  const maxY = centerY + halfHeight;

  if (Math.abs(dirX) > 1e-8) {
    for (const edgeX of [minX, maxX]) {
      const t = edgeX / dirX;
      if (t < 0) {
        continue;
      }
      const hitY = dirY * t;
      if (hitY >= minY - 1e-6 && hitY <= maxY + 1e-6) {
        candidates.push(t);
      }
    }
  }
  if (Math.abs(dirY) > 1e-8) {
    for (const edgeY of [minY, maxY]) {
      const t = edgeY / dirY;
      if (t < 0) {
        continue;
      }
      const hitX = dirX * t;
      if (hitX >= minX - 1e-6 && hitX <= maxX + 1e-6) {
        candidates.push(t);
      }
    }
  }

  return candidates.length > 0 ? Math.min(...candidates) : 0;
}

function raySegmentIntersectionDistance(origin, direction, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const cross = direction.x * segmentY - direction.y * segmentX;
  if (Math.abs(cross) <= 1e-8) {
    return null;
  }
  const offsetX = start.x - origin.x;
  const offsetY = start.y - origin.y;
  const t = (offsetX * segmentY - offsetY * segmentX) / cross;
  const u = (offsetX * direction.y - offsetY * direction.x) / cross;
  if (t <= 1e-6 || u < -1e-6 || u > 1 + 1e-6) {
    return null;
  }
  return t;
}

function inwardRingFaceDepth(atomPoint, inwardDirection, ringPolygons) {
  let best = Infinity;
  for (const polygon of ringPolygons) {
    for (let index = 0; index < polygon.length; index++) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      const distance = raySegmentIntersectionDistance(atomPoint, inwardDirection, start, end);
      if (distance != null) {
        best = Math.min(best, distance);
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * Nudges visible ring hetero-atom labels outward from the average centroid of
 * their incident ring polygons so fused sulfur/oxygen/nitrogen labels do not
 * appear buried inside the ring face.
 * @param {object} atom - Atom object.
 * @param {object} molecule - Molecule graph.
 * @param {(atom: object) => {x: number, y: number}} pointForAtom - Atom-to-screen mapper.
 * @param {string|null} label - Atom label.
 * @param {number} fontSize - Font size in pixels.
 * @returns {{dx: number, dy: number}} Label anchor offset.
 */
export function ringLabelOffset(atom, molecule, pointForAtom, label, fontSize) {
  const baseDx = labelTextOffset(label, fontSize);
  if (!label || !atom || atom.name === 'C') {
    return { dx: baseDx, dy: 0 };
  }

  let dx = baseDx;
  let dy = 0;
  const heavyNeighbors = atom
    .getNeighbors(molecule)
    .filter(neighbor => neighbor && neighbor.name !== 'H' && neighbor.x != null && neighbor.y != null);
  if (heavyNeighbors.length === 1) {
    const anchor = heavyNeighbors[0];
    const anchorBond = molecule.getBond?.(atom.id, anchor.id)
      ?? [...molecule.bonds.values()].find(bond => bond.atoms.includes(atom.id) && bond.atoms.includes(anchor.id))
      ?? null;
    const bondOrder = anchorBond?.properties?.localizedOrder ?? anchorBond?.properties?.order ?? 1;
    if (bondOrder >= 2) {
      const atomPoint = pointForAtom(atom);
      const anchorPoint = pointForAtom(anchor);
      const vx = atomPoint.x - anchorPoint.x;
      const vy = atomPoint.y - anchorPoint.y;
      const length = vecLen(vx, vy);
      const nudge = Math.min(8, fontSize * 0.55);
      dx += (vx / length) * nudge;
      dy += (vy / length) * nudge;
    }
  }

  const ringPolygons = getRingAtomIds(molecule)
    .filter(ringAtomIds => ringAtomIds.includes(atom.id))
    .map(ringAtomIds =>
      ringAtomIds
        .map(atomId => molecule.atoms.get(atomId))
        .filter(Boolean)
        .map(ringAtom => pointForAtom(ringAtom))
        .filter(Boolean)
    )
    .filter(points => points.length >= 3);
  const incidentRingCentroids = ringPolygons.map(points => ({
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  }));

  if (incidentRingCentroids.length === 0) {
    return { dx, dy };
  }

  const atomPoint = pointForAtom(atom);
  const centroid = {
    x: incidentRingCentroids.reduce((sum, point) => sum + point.x, 0) / incidentRingCentroids.length,
    y: incidentRingCentroids.reduce((sum, point) => sum + point.y, 0) / incidentRingCentroids.length
  };
  const vx = atomPoint.x - centroid.x;
  const vy = atomPoint.y - centroid.y;
  const length = vecLen(vx, vy);
  const inwardDirection = { x: -vx / length, y: -vy / length };
  const inwardAngle = Math.atan2(inwardDirection.y, inwardDirection.x);
  const inwardLabelExtent = rayDistanceToShiftedBox(
    inwardAngle,
    dx,
    dy,
    labelHalfW(label, fontSize),
    labelHalfH(label, fontSize)
  );
  const faceDepth = inwardRingFaceDepth(atomPoint, inwardDirection, ringPolygons);
  if (faceDepth == null) {
    return { dx, dy };
  }
  const allowedInwardExtent = faceDepth * 0.58;
  const neededNudge = inwardLabelExtent - allowedInwardExtent;
  if (neededNudge <= 0.25) {
    return { dx, dy };
  }
  const nudge = Math.min(Math.min(9, fontSize * 0.65), neededNudge);
  return {
    dx: dx + (vx / length) * nudge,
    dy: dy + (vy / length) * nudge
  };
}

/**
 * Formats a formal charge as a compact render label.
 * @param {number} charge - Formal charge.
 * @returns {string} Charge label.
 */
export function formatChargeLabel(charge) {
  if (!charge) {
    return '';
  }
  if (charge === 1) {
    return '+';
  }
  if (charge > 1) {
    return `${charge}+`;
  }
  if (charge === -1) {
    return '−';
  }
  return `${Math.abs(charge)}−`;
}

function chargeBadgeMetrics(chargeLabel, fontSize) {
  const textLength = Math.max(1, (chargeLabel ?? '').length);
  const chargeFontSize = fontSize * 0.8;
  const radius = Math.max(chargeFontSize * 0.62, chargeFontSize * 0.28 * textLength + 2.6);
  return { fontSize: chargeFontSize, radius };
}

/**
 * Returns the skeletal display label for an atom, or null for unlabeled carbons.
 * @param {object} atom - Atom object.
 * @param {Map<string, number>} hCounts - Atom-to-H-count map.
 * @param {(atom: object) => {x: number, y: number}} toSVG - Atom-to-SVG mapper.
 * @param {object} molecule - Molecule graph.
 * @returns {string|null} Display label or null.
 */
export function getAtomLabel(atom, hCounts, toSVG, molecule) {
  const symbol = atom.name;
  const hCount = hCounts.get(atom.id) ?? 0;
  const charge = atom.getCharge();
  if (symbol === 'C' && charge === 0 && atom.getNeighbors(molecule).some(neighbor => neighbor.name !== 'H')) {
    return null;
  }
  if (hCount === 0) {
    return symbol;
  }

  const hFragment = hCount === 1 ? 'H' : `H${hCount}`;
  const center = toSVG(atom);
  let avgDx = 0;
  let neighborCount = 0;
  for (const neighbor of atom.getNeighbors(molecule)) {
    if (!neighbor || neighbor.name === 'H' || neighbor.x == null) {
      continue;
    }
    avgDx += toSVG(neighbor).x - center.x;
    neighborCount++;
  }

  if (neighborCount === 0) {
    const hFirstStandalone = new Set(['F', 'Cl', 'Br', 'I', 'O', 'S', 'Se', 'Te']);
    return hFirstStandalone.has(symbol) ? hFragment + symbol : symbol + hFragment;
  }

  return avgDx > 0 ? hFragment + symbol : symbol + hFragment;
}

function normalizeAngle(angle) {
  let result = angle % TAU;
  if (result < 0) {
    result += TAU;
  }
  return result;
}

function angularDistance(firstAngle, secondAngle) {
  const delta = Math.abs(normalizeAngle(firstAngle) - normalizeAngle(secondAngle));
  return Math.min(delta, TAU - delta);
}

function dedupeAngles(angles, tolerance = 1e-3) {
  const sorted = angles
    .filter(Number.isFinite)
    .map(normalizeAngle)
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const unique = [];
  for (const angle of sorted) {
    if (unique.length === 0 || Math.abs(angle - unique[unique.length - 1]) > tolerance) {
      unique.push(angle);
    }
  }
  if (unique.length > 1 && TAU - unique[unique.length - 1] + unique[0] <= tolerance) {
    unique.pop();
  }
  return unique;
}

function labelOccupiedAngles(label) {
  if (!label) {
    return [];
  }
  if (/^H\d*[A-Z][a-z]?$/.test(label)) {
    return [Math.PI];
  }
  if (/^[A-Z][a-z]?H\d*$/.test(label)) {
    return [0];
  }
  return [];
}

function displayedValenceElectrons(atom) {
  const group = atom?.properties?.group;
  if (!group || group >= 18 || (group >= 3 && group <= 12)) {
    return 0;
  }
  return group <= 2 ? group : group - 10;
}

function displayedBondOrderSum(atom, molecule) {
  let sum = 0;
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    sum += bond.properties.aromatic ? 1 : (bond.properties.order ?? 1);
  }
  return sum;
}

/**
 * Returns the number of lone pairs to render for an atom.
 * @param {object} atom - Atom object.
 * @param {object} molecule - Molecule graph.
 * @returns {number} Lone pair count.
 */
export function displayedLonePairCount(atom, molecule) {
  if (!atom || !molecule) {
    return 0;
  }
  const valenceElectrons = displayedValenceElectrons(atom);
  if (valenceElectrons <= 0) {
    return 0;
  }
  const charge = atom.getCharge() ?? 0;
  const radical = atom.getRadical?.() ?? 0;
  const nonbondingElectrons = valenceElectrons - displayedBondOrderSum(atom, molecule) - charge - radical;
  return Math.max(0, Math.floor(nonbondingElectrons / 2));
}

function chooseLargestGapBisector(angles) {
  const normalized = dedupeAngles(angles);
  if (normalized.length === 0) {
    return -Math.PI / 2;
  }
  if (normalized.length === 1) {
    return normalizeAngle(normalized[0] + Math.PI);
  }
  let bestAngle = normalized[0];
  let bestGap = -1;
  for (let index = 0; index < normalized.length; index++) {
    const start = normalized[index];
    const end = index === normalized.length - 1 ? normalized[0] + TAU : normalized[index + 1];
    const gap = end - start;
    if (gap > bestGap) {
      bestGap = gap;
      bestAngle = normalizeAngle(start + gap / 2);
    }
  }
  return bestAngle;
}

function minimumAngularClearance(angle, occupiedAngles) {
  if (occupiedAngles.length === 0) {
    return Math.PI;
  }
  let best = Infinity;
  for (const occupiedAngle of occupiedAngles) {
    best = Math.min(best, angularDistance(angle, occupiedAngle));
  }
  return best;
}

function choosePlacementAngles(count, occupiedAngles, preferredAngle = -Math.PI / 2) {
  if (count <= 0) {
    return [];
  }
  const working = dedupeAngles(occupiedAngles);
  const chosen = [];
  for (let index = 0; index < count; index++) {
    let bestAngle = preferredAngle;
    let bestScore = -1;
    const candidates = new Set([
      normalizeAngle(preferredAngle),
      normalizeAngle(preferredAngle + Math.PI / 2),
      normalizeAngle(preferredAngle - Math.PI / 2),
      normalizeAngle(preferredAngle + Math.PI),
      chooseLargestGapBisector(working)
    ]);
    const sorted = [...working].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    if (sorted.length > 0) {
      for (let gapIndex = 0; gapIndex < sorted.length; gapIndex++) {
        const start = sorted[gapIndex];
        const end = gapIndex === sorted.length - 1 ? sorted[0] + TAU : sorted[gapIndex + 1];
        candidates.add(normalizeAngle(start + (end - start) / 2));
      }
    }
    if (candidates.size === 0) {
      candidates.add(normalizeAngle(preferredAngle + (TAU * index) / count));
    }
    for (const candidate of candidates) {
      const score = minimumAngularClearance(candidate, working);
      const preferredDistance = angularDistance(candidate, preferredAngle);
      if (score > bestScore || (Math.abs(score - bestScore) <= 1e-6 && preferredDistance < angularDistance(bestAngle, preferredAngle))) {
        bestScore = score;
        bestAngle = candidate;
      }
    }
    chosen.push(bestAngle);
    working.push(bestAngle);
  }
  return chosen;
}

function rayDistanceToLabelBox(angle, label, fontSize) {
  const halfWidth = labelHalfW(label, fontSize);
  const halfHeight = labelHalfH(label, fontSize);
  if (halfWidth <= 0 || halfHeight <= 0) {
    return 0;
  }
  const centerX = labelTextOffset(label, fontSize);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const candidates = [];
  const minX = centerX - halfWidth;
  const maxX = centerX + halfWidth;
  const minY = -halfHeight;
  const maxY = halfHeight;

  if (Math.abs(dirX) > 1e-8) {
    for (const edgeX of [minX, maxX]) {
      const t = edgeX / dirX;
      if (t < 0) {
        continue;
      }
      const hitY = dirY * t;
      if (hitY >= minY - 1e-6 && hitY <= maxY + 1e-6) {
        candidates.push(t);
      }
    }
  }
  if (Math.abs(dirY) > 1e-8) {
    for (const edgeY of [minY, maxY]) {
      const t = edgeY / dirY;
      if (t < 0) {
        continue;
      }
      const hitX = dirX * t;
      if (hitX >= minX - 1e-6 && hitX <= maxX + 1e-6) {
        candidates.push(t);
      }
    }
  }

  return candidates.length > 0 ? Math.min(...candidates) : 0;
}

function occupiedNeighborAngles(atom, molecule, pointForAtom) {
  const center = pointForAtom(atom);
  return atom
    .getNeighbors(molecule)
    .filter(Boolean)
    .map(neighbor => {
      const point = pointForAtom(neighbor);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return null;
      }
      return Math.atan2(point.y - center.y, point.x - center.x);
    })
    .filter(Number.isFinite);
}

/**
 * Computes lone pair dot positions around an atom label.
 * @param {object} atom - Atom object.
 * @param {object} molecule - Molecule graph.
 * @param {object} options - Placement options.
 * @param {(atom: object) => {x: number, y: number}} options.pointForAtom - Atom-to-point mapper.
 * @param {string|null} [options.label] - Display label.
 * @param {number} [options.fontSize] - Font size.
 * @param {number} [options.offsetFromBoundary] - Distance from atom label.
 * @param {number} [options.dotSpacing] - Distance between dots in a pair.
 * @returns {Array<{x: number, y: number}>} Dot positions.
 */
export function computeLonePairDotPositions(atom, molecule, { pointForAtom, label = null, fontSize = 14, offsetFromBoundary = 6, dotSpacing = 4.2 } = {}) {
  if (!atom || !molecule || typeof pointForAtom !== 'function') {
    return [];
  }
  const pairCount = displayedLonePairCount(atom, molecule);
  if (pairCount <= 0) {
    return [];
  }
  const center = pointForAtom(atom);
  const occupiedAngles = [...occupiedNeighborAngles(atom, molecule, pointForAtom), ...labelOccupiedAngles(label)];
  const preferredAngle = chooseLargestGapBisector(occupiedAngles);
  const chosenAngles = choosePlacementAngles(pairCount, occupiedAngles, preferredAngle);

  return chosenAngles.flatMap(angle => {
    const boundary = label ? rayDistanceToLabelBox(angle, label, fontSize) : fontSize * 0.32;
    const distance = Math.max(fontSize * 0.35, boundary + offsetFromBoundary);
    const centerX = center.x + Math.cos(angle) * distance;
    const centerY = center.y + Math.sin(angle) * distance;
    const { nx, ny } = perpUnit(Math.cos(angle), Math.sin(angle));
    return [
      { x: centerX - nx * dotSpacing * 0.5, y: centerY - ny * dotSpacing * 0.5 },
      { x: centerX + nx * dotSpacing * 0.5, y: centerY + ny * dotSpacing * 0.5 }
    ];
  });
}

/**
 * Computes a readable charge-badge position around an atom.
 * @param {object} atom - Atom object.
 * @param {object} molecule - Molecule graph.
 * @param {object} options - Placement options.
 * @param {(atom: object) => {x: number, y: number}} options.pointForAtom - Atom-to-point mapper.
 * @param {string|null} [options.label] - Display label.
 * @param {number} [options.fontSize] - Font size.
 * @param {number} [options.baseRadius] - Minimum badge radius.
 * @param {number} [options.offsetFromBoundary] - Distance from the atom boundary.
 * @param {string} [options.chargeLabel] - Charge label text.
 * @param {number[]} [options.extraOccupiedAngles] - Additional blocked directions.
 * @param {number} [options.preferredAngle] - Preferred placement angle.
 * @returns {{x: number, y: number, radius: number, fontSize: number, text: string, angle: number}|null} Charge badge placement.
 */
export function computeChargeBadgePlacement(
  atom,
  molecule,
  {
    pointForAtom,
    label = null,
    fontSize = 14,
    baseRadius = 0,
    offsetFromBoundary = 3,
    chargeLabel = formatChargeLabel(atom?.getCharge?.() ?? 0),
    extraOccupiedAngles = [],
    preferredAngle = -Math.PI / 4
  } = {}
) {
  if (!atom || !molecule || typeof pointForAtom !== 'function' || !chargeLabel) {
    return null;
  }

  const center = pointForAtom(atom);
  const occupiedAngles = [...occupiedNeighborAngles(atom, molecule, pointForAtom), ...labelOccupiedAngles(label), ...extraOccupiedAngles];
  const candidates = [preferredAngle, -Math.PI / 4, Math.PI / 4, (-3 * Math.PI) / 4, (3 * Math.PI) / 4, -Math.PI / 2, Math.PI / 2, 0, Math.PI].map(normalizeAngle);

  let bestAngle = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = minimumAngularClearance(candidate, occupiedAngles);
    const preferredDistance = angularDistance(candidate, preferredAngle);
    if (score > bestScore || (Math.abs(score - bestScore) <= 1e-6 && preferredDistance < angularDistance(bestAngle, preferredAngle))) {
      bestScore = score;
      bestAngle = candidate;
    }
  }

  const metrics = chargeBadgeMetrics(chargeLabel, fontSize);
  const radius = Math.max(metrics.radius, baseRadius);
  const boundary = label ? rayDistanceToLabelBox(bestAngle, label, fontSize) : fontSize * 0.28;
  const distance = boundary + offsetFromBoundary + radius;

  return {
    x: center.x + Math.cos(bestAngle) * distance,
    y: center.y + Math.sin(bestAngle) * distance,
    radius,
    fontSize: metrics.fontSize,
    text: chargeLabel,
    angle: bestAngle
  };
}

/**
 * Returns the stereo center atom used for rendering a bond.
 * @param {object} molecule - Molecule graph.
 * @param {string} bondId - Bond id.
 * @returns {string|null} Center atom id.
 */
export function stereoBondCenterIdForRender(molecule, bondId) {
  if (!molecule || !bondId) {
    return null;
  }
  const bond = molecule.bonds.get(bondId);
  if (!bond) {
    return null;
  }
  const displayCenterId = bond.properties.display?.centerId ?? null;
  if (displayCenterId && bond.atoms.includes(displayCenterId)) {
    return displayCenterId;
  }
  const [firstAtomId, secondAtomId] = bond.atoms;
  if (molecule.atoms.get(firstAtomId)?.getChirality?.()) {
    return firstAtomId;
  }
  if (molecule.atoms.get(secondAtomId)?.getChirality?.()) {
    return secondAtomId;
  }
  return null;
}

/**
 * Assigns localized bond orders to aromatic bonds that lack them.
 * @param {object} molecule - Molecule graph.
 * @returns {void}
 */
export function kekulize(molecule) {
  const aromaticBonds = [];
  for (const bond of molecule.bonds.values()) {
    if (bond.properties.aromatic && bond.properties.localizedOrder == null) {
      aromaticBonds.push(bond);
    }
  }
  if (aromaticBonds.length === 0) {
    return;
  }

  const aromaticAtomIds = new Set();
  for (const bond of aromaticBonds) {
    aromaticAtomIds.add(bond.atoms[0]);
    aromaticAtomIds.add(bond.atoms[1]);
  }

  const sigmaValence = {
    B: 3,
    C: 4,
    N: 3,
    O: 2,
    F: 1,
    Si: 4,
    P: 3,
    S: 2,
    Cl: 1,
    As: 3,
    Se: 2,
    Br: 1,
    Te: 2,
    I: 1
  };

  const sigmaBondOrder = new Map();
  for (const atomId of aromaticAtomIds) {
    sigmaBondOrder.set(atomId, 0);
  }
  for (const bond of molecule.bonds.values()) {
    const contribution = bond.properties.aromatic ? 1 : (bond.properties.order ?? 1);
    for (const atomId of bond.atoms) {
      if (sigmaBondOrder.has(atomId)) {
        sigmaBondOrder.set(atomId, sigmaBondOrder.get(atomId) + contribution);
      }
    }
  }

  const canHaveDouble = new Set();
  for (const atomId of aromaticAtomIds) {
    const atom = molecule.atoms.get(atomId);
    const neutralBase = sigmaValence[atom.name] ?? 4;
    const adjustedBase = Math.max(0, neutralBase + (atom.getCharge?.() ?? 0));
    if (adjustedBase - sigmaBondOrder.get(atomId) >= 1) {
      canHaveDouble.add(atomId);
    }
  }

  const adjacency = new Map();
  for (const atomId of canHaveDouble) {
    adjacency.set(atomId, []);
  }
  for (const bond of aromaticBonds) {
    const [firstAtomId, secondAtomId] = bond.atoms;
    if (canHaveDouble.has(firstAtomId) && canHaveDouble.has(secondAtomId)) {
      adjacency.get(firstAtomId).push({ bondId: bond.id, otherId: secondAtomId });
      adjacency.get(secondAtomId).push({ bondId: bond.id, otherId: firstAtomId });
    }
  }

  const mate = new Map();
  const matchedBond = new Map();
  for (const atomId of canHaveDouble) {
    mate.set(atomId, null);
  }

  function tryAugment(startAtomId) {
    const visited = new Set([startAtomId]);
    function dfs(atomId) {
      for (const { bondId, otherId } of adjacency.get(atomId)) {
        if (visited.has(otherId)) {
          continue;
        }
        visited.add(otherId);
        const mateOfOther = mate.get(otherId);
        if (mateOfOther === null || dfs(mateOfOther)) {
          mate.set(atomId, otherId);
          mate.set(otherId, atomId);
          matchedBond.set(atomId, bondId);
          matchedBond.set(otherId, bondId);
          return true;
        }
      }
      return false;
    }
    return dfs(startAtomId);
  }

  for (const atomId of canHaveDouble) {
    if (mate.get(atomId) === null) {
      tryAugment(atomId);
    }
  }

  const doubleBondIds = new Set();
  for (const [atomId, bondId] of matchedBond) {
    if (mate.get(atomId) !== null) {
      doubleBondIds.add(bondId);
    }
  }

  for (const bond of aromaticBonds) {
    bond.properties.localizedOrder = doubleBondIds.has(bond.id) ? 2 : 1;
  }
}
