/**
 * mol2d-helpers.js — shared 2D rendering utilities
 *
 * Pure functions and constants used by both the browser renderer (index.html)
 * and the server-side SVG/PNG exporter (render2d.js).  No DOM, no D3, no
 * Node-only dependencies — safe to import in any environment.
 */

import { assignCIPRanks } from '../core/Molecule.js';

// ---------------------------------------------------------------------------
// CPK atom colours
// ---------------------------------------------------------------------------
export const CPK = {
  H: '#FFFFFF',
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

/**
 * Returns the CPK fill colour for an element symbol.
 * @param {string} sym - Element symbol (e.g. `'C'`, `'O'`).
 * @returns {string} Hex colour string (e.g. `'#FF0D0D'`), or hot-pink for unknown elements.
 */
export function atomColor(sym) {
  return CPK[sym] ?? DEFAULT_COLOR;
}

// ---------------------------------------------------------------------------
// Stereo bond constants (same in both renderers)
// ---------------------------------------------------------------------------
export const WEDGE_HALF_W = 6; // px — half-width at the wide end
export const WEDGE_DASHES = 6; // number of hash lines in a dashed bond

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Returns the length of a 2D vector. Returns at least `1` to avoid
 * division-by-zero in callers that use this as a denominator.
 * @param {number} x - X coordinate.
 * @param {number} y - Y coordinate.
 * @returns {number} The computed numeric value.
 */
export function vecLen(x, y) {
  return Math.sqrt(x * x + y * y) || 1;
}

/**
 * Axis-aligned bounding box of a set of atoms with 2D coordinates.
 * @param {Array<{x:number, y:number}>} atoms - Array of objects with x and y properties.
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number, cx: number, cy: number }} The result object.
 */
export function atomBBox(atoms) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const a of atoms) {
    if (a.x < minX) {
      minX = a.x;
    }
    if (a.x > maxX) {
      maxX = a.x;
    }
    if (a.y < minY) {
      minY = a.y;
    }
    if (a.y > maxY) {
      maxY = a.y;
    }
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/**
 * Returns a unit vector perpendicular to `(dx, dy)`, rotated 90° counter-clockwise.
 * @param {number} dx - X-axis displacement.
 * @param {number} dy - Y-axis displacement.
 * @returns {{ nx: number, ny: number }} The result object.
 */
export function perpUnit(dx, dy) {
  const len = vecLen(dx, dy);
  return { nx: -dy / len, ny: dx / len };
}

/**
 * Shortens a line segment by `d1` at the start and `d2` at the end,
 * keeping the original direction.
 * @param {number} x1 - Start point x.
 * @param {number} y1 - Start point y.
 * @param {number} x2 - End point x.
 * @param {number} y2 - End point y.
 * @param {number} d1 - Distance to trim from the start.
 * @param {number} d2 - Distance to trim from the end.
 * @returns {{ x1: number, y1: number, x2: number, y2: number }} The result object.
 */
export function shortenLine(x1, y1, x2, y2, d1, d2) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const len = vecLen(dx, dy);
  const ux = dx / len,
    uy = dy / len;
  return {
    x1: x1 + ux * d1,
    y1: y1 + uy * d1,
    x2: x2 - ux * d2,
    y2: y2 - uy * d2
  };
}

/**
 * Returns +1 or -1 indicating which side of the bond axis the secondary
 * parallel line of a double bond should be placed on, based on the
 * positions of neighbouring heavy atoms.
 * @param {import('../core/Atom.js').Atom} a1 - The a1 value.
 * @param {import('../core/Atom.js').Atom} a2 - The a2 value.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {(atom: import('../core/Atom.js').Atom) => {x: number, y: number}} toSVG - Converts an atom to `{x, y}` in SVG space.
 * @returns {1|-1} The computed result.
 */
export function secondaryDir(a1, a2, mol, toSVG) {
  const s1 = toSVG(a1),
    s2 = toSVG(a2);
  const { nx, ny } = perpUnit(s2.x - s1.x, s2.y - s1.y);
  const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };

  const ringDots = mol
    .getRings()
    .filter(ring => ring.includes(a1.id) && ring.includes(a2.id))
    .map(ring => {
      const ringPoints = ring
        .map(id => {
          const atom = mol.atoms.get(id);
          const svg = atom ? toSVG(atom) : null;
          return atom && svg ? { atom, svg } : null;
        })
        .filter(Boolean);
      if (ringPoints.length < 3) {
        return null;
      }
      let cx = 0;
      let cy = 0;
      for (const { svg } of ringPoints) {
        cx += svg.x;
        cy += svg.y;
      }
      cx /= ringPoints.length;
      cy /= ringPoints.length;
      return (cx - mid.x) * nx + (cy - mid.y) * ny;
    })
    .filter(dot => dot != null && Math.abs(dot) > 1e-6);

  if (ringDots.length > 0) {
    const firstSign = Math.sign(ringDots[0]);
    if (ringDots.every(dot => Math.sign(dot) === firstSign)) {
      return firstSign >= 0 ? 1 : -1;
    }
  }

  const resolveNbs = (atom, excludeId) => atom.getNeighbors(mol).filter(n => n && n.id !== excludeId && n.name !== 'H' && n.x != null);
  const allNb = [...resolveNbs(a1, a2.id), ...resolveNbs(a2, a1.id)];
  if (allNb.length === 0) {
    return 1;
  }
  let dot = 0;
  for (const n of allNb) {
    const sn = toSVG(n);
    dot += (sn.x - mid.x) * nx + (sn.y - mid.y) * ny;
  }
  return dot >= 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Atom label helpers
// ---------------------------------------------------------------------------

/**
 * Half-width of an atom label bounding box in SVG pixels.
 * @param {string|null} label - The label string.
 * @param {number} fontSize - font size in px
 * @returns {number} The computed numeric value.
 */
export function labelHalfW(label, fontSize) {
  if (!label) {
    return 0;
  }
  return fontSize * 0.38 * label.length + 4;
}

/**
 * Half-height of an atom label bounding box in SVG pixels.
 * @param {string|null} label - The label string.
 * @param {number} fontSize - font size in px
 * @returns {number} The computed numeric value.
 */
export function labelHalfH(label, fontSize) {
  if (!label) {
    return 0;
  }
  const subscriptDescent = /\d/.test(label) ? fontSize * 0.18 : 0;
  return fontSize * 0.58 + 2 + subscriptDescent;
}

/**
 * Returns the horizontal shift applied to the rendered text box so the element
 * symbol stays centered on the atom while any attached H fragment extends to
 * the chosen side.
 * @param {string|null} label - The label string.
 * @param {number} fontSize - font size in px
 * @returns {number} The computed numeric value.
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
 * read as buried inside the ring.
 * @param {import('../core/Atom.js').Atom} atom - Atom descriptor.
 * @param {import('../core/Molecule.js').Molecule} mol - Molecule graph.
 * @param {(atom: import('../core/Atom.js').Atom) => {x: number, y: number}} pointForAtom - Atom-to-screen mapper.
 * @param {string|null} label - Atom label string.
 * @param {number} fontSize - Label font size in pixels.
 * @returns {{dx: number, dy: number}} Label anchor offset.
 */
export function ringLabelOffset(atom, mol, pointForAtom, label, fontSize) {
  const baseDx = labelTextOffset(label, fontSize);
  if (!label || !atom || atom.name === 'C') {
    return { dx: baseDx, dy: 0 };
  }

  const rings = typeof mol?.getRings === 'function' ? mol.getRings() : [];

  let dx = baseDx;
  let dy = 0;
  const heavyNeighbors = atom
    .getNeighbors(mol)
    .filter(neighbor => neighbor && neighbor.name !== 'H' && neighbor.x != null && neighbor.y != null);
  if (heavyNeighbors.length === 1) {
    const anchor = heavyNeighbors[0];
    const anchorBond = mol.getBond?.(atom.id, anchor.id)
      ?? [...(mol.bonds?.values() ?? [])].find(bond => bond.atoms.includes(atom.id) && bond.atoms.includes(anchor.id))
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

  const incidentRingCentroids = rings
    .filter(ringAtomIds => ringAtomIds.includes(atom.id))
    .map(ringAtomIds =>
      ringAtomIds
        .map(atomId => mol.atoms.get(atomId))
        .filter(Boolean)
        .map(ringAtom => pointForAtom(ringAtom))
        .filter(Boolean)
    )
    .filter(points => points.length >= 3)
    .map(points => ({
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    }));

  if (incidentRingCentroids.length === 0) {
    return { dx, dy };
  }

  const atomPoint = pointForAtom(atom);
  const ringPolygons = rings
    .filter(ringAtomIds => ringAtomIds.includes(atom.id))
    .map(ringAtomIds =>
      ringAtomIds
        .map(atomId => mol.atoms.get(atomId))
        .filter(Boolean)
        .map(ringAtom => pointForAtom(ringAtom))
        .filter(Boolean)
    )
    .filter(points => points.length >= 3);
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
 * Formats a formal charge integer as a display string suitable for rendering
 * in a charge badge.
 *
 * - `0` → `''`
 * - `1` → `'+'`
 * - `n > 1` → `'n+'`
 * - `-1` → `'−'` (Unicode minus)
 * - `n < -1` → `'|n|−'`
 * @param {number} charge - Formal charge value.
 * @returns {string} The result string.
 */
export function formatChargeLabel(charge) {
  if (!charge) {
    return '';
  }
  return charge === 1 ? '+' : charge > 1 ? `${charge}+` : charge === -1 ? '−' : `${Math.abs(charge)}−`;
}

/**
 * Computes the font size and circle radius for a charge badge.
 *
 * The badge radius is at least large enough to contain one character and
 * scales with the text length for multi-character labels (e.g. `'2+'`).
 * @param {string} chargeLabel - The formatted charge string (from `formatChargeLabel`).
 * @param {number} fontSize - Base font size in px.
 * @returns {{ fontSize: number, radius: number }} The result object.
 */
export function chargeBadgeMetrics(chargeLabel, fontSize) {
  const label = chargeLabel ?? '';
  const textLength = Math.max(1, label.length);
  const chargeFontSize = fontSize * 0.8;
  const radius = Math.max(chargeFontSize * 0.62, chargeFontSize * 0.28 * textLength + 2.6);
  return { fontSize: chargeFontSize, radius };
}

/**
 * Returns the display label for an atom in 2D skeletal notation, or null
 * for unlabelled carbons. The H-count fragment is placed left or right of the
 * element symbol based on the average neighbour direction.
 * @param {import('../core/Atom.js').Atom} atom - The atom object.
 * @param {Map<string,number>} hCounts - atom id → implicit-H count
 * @param {(atom: import('../core/Atom.js').Atom) => {x: number, y: number}} toSVG - Converts an atom to `{x, y}` in SVG space.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {string|null} The result string, or `null` if not applicable.
 */
export function getAtomLabel(atom, hCounts, toSVG, mol) {
  const symbol = atom.name;
  const hCount = hCounts.get(atom.id) ?? 0;
  const charge = atom.getCharge();
  if (symbol === 'C' && charge === 0 && atom.getNeighbors(mol).some(n => n.name !== 'H')) {
    return null;
  }
  if (hCount === 0) {
    return symbol;
  }
  const hStr = hCount === 1 ? 'H' : `H${hCount}`;
  const aSVG = toSVG(atom);
  let avgDx = 0,
    nbCount = 0;
  for (const n of atom.getNeighbors(mol)) {
    if (n && n.name !== 'H' && n.x != null) {
      avgDx += toSVG(n).x - aSVG.x;
      nbCount++;
    }
  }
  // Standalone atom (no heavy-atom neighbors): use conventional formula order.
  // Halogens and chalcogens write H first: HF, HCl, HBr, HI, H2O, H2S, H2Se.
  if (nbCount === 0) {
    const hFirstStandalone = new Set(['F', 'Cl', 'Br', 'I', 'O', 'S', 'Se', 'Te']);
    return hFirstStandalone.has(symbol) ? hStr + symbol : symbol + hStr;
  }
  return avgDx > 0 ? hStr + symbol : symbol + hStr;
}

// ---------------------------------------------------------------------------
// Lone-pair placement
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

function normalizeAngle(angle) {
  let result = angle % TAU;
  if (result < 0) {
    result += TAU;
  }
  return result;
}

function dedupeAngles(angles, tolerance = 1e-3) {
  const sorted = angles
    .filter(Number.isFinite)
    .map(normalizeAngle)
    .sort((a, b) => a - b);
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

function displayedBondOrderSum(atom, mol) {
  let sum = 0;
  for (const bondId of atom.bonds) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    sum += bond.properties.aromatic ? 1 : (bond.properties.order ?? 1);
  }
  return sum;
}

/**
 * Returns the number of lone pairs to render for `atom`.
 *
 * Computed as `floor((valenceElectrons − bondOrderSum − formalCharge − radicalElectrons) / 2)`.
 * Returns 0 for transition metals, noble gases, unknown elements, and when
 * `atom` or `mol` are falsy.
 * @param {import('../core/Atom.js').Atom} atom - The atom object.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @returns {number} The computed numeric value.
 */
export function displayedLonePairCount(atom, mol) {
  if (!atom || !mol) {
    return 0;
  }
  const valenceElectrons = displayedValenceElectrons(atom);
  if (valenceElectrons <= 0) {
    return 0;
  }
  const charge = atom.getCharge() ?? 0;
  const radical = atom.getRadical?.() ?? 0;
  const nonbondingElectrons = valenceElectrons - displayedBondOrderSum(atom, mol) - charge - radical;
  return Math.max(0, Math.floor(nonbondingElectrons / 2));
}

function rotatedAngles(baseAngles, rotation) {
  return baseAngles.map(angle => normalizeAngle(angle + rotation));
}

function angularDistance(a, b) {
  const delta = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(delta, TAU - delta);
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

function choosePreferredSingleAngle(occupiedAngles, preferredNorthAngle = -Math.PI / 2) {
  const candidateGroups = [
    [preferredNorthAngle],
    rotatedAngles([-Math.PI / 4, Math.PI / 4], preferredNorthAngle),
    rotatedAngles([-Math.PI / 2, Math.PI / 2, Math.PI], preferredNorthAngle),
    rotatedAngles([(-3 * Math.PI) / 4, (3 * Math.PI) / 4], preferredNorthAngle)
  ];

  for (const candidates of candidateGroups) {
    let bestAngle = null;
    let bestScore = -1;
    let bestNorthDistance = Infinity;
    for (const angle of candidates) {
      const score = minimumAngularClearance(angle, occupiedAngles);
      const northDistance = angularDistance(angle, preferredNorthAngle);
      if (score > bestScore || (Math.abs(score - bestScore) <= 1e-6 && northDistance < bestNorthDistance)) {
        bestScore = score;
        bestNorthDistance = northDistance;
        bestAngle = angle;
      }
    }
    if (bestScore >= Math.PI / 6) {
      return bestAngle;
    }
  }

  let fallbackAngle = preferredNorthAngle;
  let fallbackScore = -1;
  let fallbackNorthDistance = Infinity;
  for (const angle of candidateGroups.flat()) {
    const score = minimumAngularClearance(angle, occupiedAngles);
    const northDistance = angularDistance(angle, preferredNorthAngle);
    if (score > fallbackScore || (Math.abs(score - fallbackScore) <= 1e-6 && northDistance < fallbackNorthDistance)) {
      fallbackScore = score;
      fallbackNorthDistance = northDistance;
      fallbackAngle = angle;
    }
  }
  return fallbackAngle;
}

function hasMinimumAngularClearance(angles, occupiedAngles, minimum = Math.PI / 6) {
  return angles.every(angle => minimumAngularClearance(angle, occupiedAngles) >= minimum);
}

function preferredPatternAngles(count, preferredNorthAngle) {
  if (!Number.isFinite(preferredNorthAngle)) {
    return null;
  }
  if (count === 1) {
    return [preferredNorthAngle];
  }
  if (count === 2) {
    return rotatedAngles([(-3 * Math.PI) / 4, -Math.PI / 4], preferredNorthAngle + Math.PI / 2);
  }
  if (count === 3) {
    return rotatedAngles([Math.PI, -Math.PI / 2, 0], preferredNorthAngle + Math.PI / 2);
  }
  if (count === 4) {
    return rotatedAngles([-Math.PI / 2, Math.PI / 2, Math.PI, 0], preferredNorthAngle + Math.PI / 2);
  }
  return null;
}

function ringVertexNorthAngle(atom, mol, pointForAtom) {
  if (!atom?.isInRing?.(mol)) {
    return null;
  }
  const center = pointForAtom(atom);
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return null;
  }

  const ringNeighborIds = new Set();
  const ringCenters = [];
  for (const ring of mol.getRings()) {
    const atomIndex = ring.indexOf(atom.id);
    if (atomIndex < 0 || ring.length < 3) {
      continue;
    }
    ringNeighborIds.add(ring[(atomIndex - 1 + ring.length) % ring.length]);
    ringNeighborIds.add(ring[(atomIndex + 1) % ring.length]);

    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const atomId of ring) {
      const point = pointForAtom(mol.atoms.get(atomId));
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        continue;
      }
      cx += point.x;
      cy += point.y;
      count++;
    }
    if (count > 0) {
      ringCenters.push({ x: cx / count, y: cy / count });
    }
  }

  let inwardX = 0;
  let inwardY = 0;
  for (const neighborId of ringNeighborIds) {
    const point = pointForAtom(mol.atoms.get(neighborId));
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    inwardX += point.x - center.x;
    inwardY += point.y - center.y;
  }
  if (Math.hypot(inwardX, inwardY) <= 1e-6) {
    for (const ringCenter of ringCenters) {
      inwardX += ringCenter.x - center.x;
      inwardY += ringCenter.y - center.y;
    }
  }
  if (Math.hypot(inwardX, inwardY) <= 1e-6) {
    return null;
  }
  return Math.atan2(-inwardY, -inwardX);
}

function chooseLargestGapBisector(angles) {
  const normalized = dedupeAngles(angles);
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length === 1) {
    return normalizeAngle(normalized[0] + Math.PI);
  }
  let bestAngle = normalized[0];
  let bestGap = -1;
  for (let idx = 0; idx < normalized.length; idx++) {
    const start = normalized[idx];
    const end = idx === normalized.length - 1 ? normalized[0] + TAU : normalized[idx + 1];
    const gap = end - start;
    if (gap > bestGap) {
      bestGap = gap;
      bestAngle = normalizeAngle(start + gap / 2);
    }
  }
  return bestAngle;
}

function localNorthAngle(atom, mol, pointForAtom) {
  const ringNorth = ringVertexNorthAngle(atom, mol, pointForAtom);
  if (Number.isFinite(ringNorth)) {
    return ringNorth;
  }

  const center = pointForAtom(atom);
  const heavyNeighborAngles = atom
    .getNeighbors(mol)
    .filter(neighbor => neighbor && neighbor.name !== 'H')
    .map(neighbor => {
      const point = pointForAtom(neighbor);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return null;
      }
      return Math.atan2(point.y - center.y, point.x - center.x);
    })
    .filter(Number.isFinite);

  if (heavyNeighborAngles.length === 1) {
    return normalizeAngle(heavyNeighborAngles[0] + Math.PI);
  }
  if (heavyNeighborAngles.length >= 2) {
    return chooseLargestGapBisector(heavyNeighborAngles);
  }
  return -Math.PI / 2;
}

function chooseLonePairAngles(occupiedAngles, count, preferredNorthAngle = -Math.PI / 2) {
  if (!Number.isFinite(count) || count <= 0) {
    return [];
  }
  const occupied = dedupeAngles(occupiedAngles);
  const preferredPattern = preferredPatternAngles(count, preferredNorthAngle);
  if (preferredPattern && hasMinimumAngularClearance(preferredPattern, occupied)) {
    return preferredPattern;
  }
  if (occupied.length === 0) {
    if (preferredPattern) {
      return preferredPattern;
    }
    return Array.from({ length: count }, (_, index) => normalizeAngle((TAU * index) / count));
  }
  if (count === 1) {
    return [choosePreferredSingleAngle(occupied, preferredNorthAngle)];
  }
  if (occupied.length === 1) {
    const opposite = normalizeAngle(occupied[0] + Math.PI);
    if (count === 2) {
      return [normalizeAngle(opposite - Math.PI / 4), normalizeAngle(opposite + Math.PI / 4)];
    }
    if (count === 3) {
      return [normalizeAngle(opposite - Math.PI / 2), opposite, normalizeAngle(opposite + Math.PI / 2)];
    }
  }

  const working = [...occupied];
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const sorted = [...working].sort((a, b) => a - b);
    let bestAngle = sorted[0];
    let bestGap = -1;
    for (let idx = 0; idx < sorted.length; idx++) {
      const start = sorted[idx];
      const end = idx === sorted.length - 1 ? sorted[0] + TAU : sorted[idx + 1];
      const gap = end - start;
      if (gap > bestGap) {
        bestGap = gap;
        bestAngle = normalizeAngle(start + gap / 2);
      }
    }
    working.push(bestAngle);
    chosen.push(bestAngle);
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

/**
 * Computes a non-overlapping position for a circled charge badge near an atom.
 * @param {import('../core/Atom.js').Atom} atom - The atom object.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {object} options - Configuration options.
 * @param {(atom: import('../core/Atom.js').Atom) => {x: number, y: number}} options.pointForAtom - Maps an atom to `{x, y}` render coordinates.
 * @param {(atom: import('../core/Atom.js').Atom) => {x: number, y: number}} [options.orientationPointForAtom] - Maps an atom to orientation render coordinates.
 * @param {string|null} [options.label] - rendered atom label, if any
 * @param {number} [options.fontSize] - Font size for rendering.
 * @param {number} [options.baseRadius] - Configuration sub-option.
 * @param {number} [options.offsetFromBoundary] - Configuration sub-option.
 * @param {string} [options.chargeLabel] - Configuration sub-option.
 * @param {number[]} [options.extraOccupiedAngles] - Additional blocked angular directions.
 * @param {number} [options.preferredAngle] - preferred angle for badge placement in radians
 * @param {number|null} [options.stickyAngle] - if set, locks badge to this angle
 * @param {number} [options.stickyTolerance] - angular tolerance for sticky snapping
 * @returns {{x:number,y:number,radius:number,fontSize:number,text:string,angle:number}|null} The result object.
 */
export function computeChargeBadgePlacement(
  atom,
  mol,
  {
    pointForAtom,
    orientationPointForAtom = pointForAtom,
    label = null,
    fontSize = 14,
    baseRadius = 0,
    offsetFromBoundary = 3,
    chargeLabel = formatChargeLabel(atom?.getCharge?.() ?? 0),
    extraOccupiedAngles = [],
    preferredAngle = -Math.PI / 4,
    stickyAngle = null,
    stickyTolerance = Math.PI / 18
  } = {}
) {
  if (!atom || !mol || typeof pointForAtom !== 'function' || !chargeLabel) {
    return null;
  }

  const center = pointForAtom(atom);
  const orientationCenter = orientationPointForAtom(atom);
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return null;
  }
  if (!orientationCenter || !Number.isFinite(orientationCenter.x) || !Number.isFinite(orientationCenter.y)) {
    return null;
  }

  const occupiedAngles = [];
  for (const neighbor of atom.getNeighbors(mol)) {
    const point = orientationPointForAtom(neighbor);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const dx = point.x - orientationCenter.x;
    const dy = point.y - orientationCenter.y;
    if (Math.hypot(dx, dy) <= 1e-6) {
      continue;
    }
    occupiedAngles.push(Math.atan2(dy, dx));
  }
  occupiedAngles.push(...extraOccupiedAngles);

  let bestAngle = preferredAngle;
  let bestScore = -1;
  let bestPreference = Infinity;
  for (let idx = 0; idx < 16; idx++) {
    const angle = normalizeAngle(preferredAngle + (TAU * idx) / 16);
    const score = minimumAngularClearance(angle, occupiedAngles);
    const preference = angularDistance(angle, preferredAngle);
    if (score > bestScore || (Math.abs(score - bestScore) <= 1e-6 && preference < bestPreference)) {
      bestScore = score;
      bestPreference = preference;
      bestAngle = angle;
    }
  }

  if (stickyAngle != null && Number.isFinite(stickyAngle)) {
    const normalizedStickyAngle = normalizeAngle(stickyAngle);
    const stickyScore = minimumAngularClearance(normalizedStickyAngle, occupiedAngles);
    if (stickyScore + stickyTolerance >= bestScore) {
      bestAngle = normalizedStickyAngle;
    }
  }

  const metrics = chargeBadgeMetrics(chargeLabel, fontSize);
  const boundary = Math.max(baseRadius, rayDistanceToLabelBox(bestAngle, label, fontSize));
  const distance = boundary + offsetFromBoundary + metrics.radius;
  return {
    x: center.x + Math.cos(bestAngle) * distance,
    y: center.y + Math.sin(bestAngle) * distance,
    radius: metrics.radius,
    fontSize: metrics.fontSize,
    text: chargeLabel,
    angle: bestAngle
  };
}

/**
 * Computes rendered lone-pair dot positions for a labeled atom.
 *
 * The caller supplies a point-mapping function so the same placement logic
 * can be reused by both the SVG/browser 2D renderer and the force renderer.
 * Angles are chosen only after the final neighbor geometry is known.
 * @param {import('../core/Atom.js').Atom} atom - The atom object.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {object} options - Configuration options.
 * @param {(atom: import('../core/Atom.js').Atom) => {x: number, y: number}} options.pointForAtom - Maps an atom to `{x, y}` render coordinates.
 * @param {(atom: import('../core/Atom.js').Atom) => {x: number, y: number}} [options.orientationPointForAtom] - Maps an atom to orientation coordinates.
 * @param {string|null} [options.label] - rendered atom label, if any
 * @param {number} [options.fontSize] - Font size for rendering.
 * @param {number} [options.baseRadius] - minimum clearance around the atom
 * @param {number} [options.offsetFromBoundary] - radial offset beyond atom/label
 * @param {number} [options.dotSpacing] - distance between the two dots
 * @param {number} [options.pairCount] - explicit lone-pair count override
 * @param {number[]} [options.extraOccupiedAngles] - Additional blocked angular directions.
 * @returns {Array<{x:number, y:number}>} Array of results.
 */
export function computeLonePairDotPositions(
  atom,
  mol,
  {
    pointForAtom,
    orientationPointForAtom = pointForAtom,
    label = null,
    fontSize = 14,
    baseRadius = 0,
    offsetFromBoundary = 6,
    dotSpacing = 4,
    pairCount = displayedLonePairCount(atom, mol),
    extraOccupiedAngles = []
  } = {}
) {
  if (!atom || !mol || typeof pointForAtom !== 'function' || pairCount <= 0) {
    return [];
  }

  const center = pointForAtom(atom);
  const orientationCenter = orientationPointForAtom(atom);
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return [];
  }
  if (!orientationCenter || !Number.isFinite(orientationCenter.x) || !Number.isFinite(orientationCenter.y)) {
    return [];
  }

  const occupiedAngles = [];
  for (const neighbor of atom.getNeighbors(mol)) {
    const point = orientationPointForAtom(neighbor);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const dx = point.x - orientationCenter.x;
    const dy = point.y - orientationCenter.y;
    if (Math.hypot(dx, dy) <= 1e-6) {
      continue;
    }
    occupiedAngles.push(Math.atan2(dy, dx));
  }
  occupiedAngles.push(...labelOccupiedAngles(label));
  occupiedAngles.push(...extraOccupiedAngles);

  const preferredNorthAngle = localNorthAngle(atom, mol, orientationPointForAtom);
  const chosenAngles = chooseLonePairAngles(occupiedAngles, pairCount, preferredNorthAngle);
  const dots = [];
  for (const angle of chosenAngles) {
    const boundary = Math.max(baseRadius, rayDistanceToLabelBox(angle, label, fontSize));
    const distance = boundary + offsetFromBoundary;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const tangentX = -dirY;
    const tangentY = dirX;
    const pairCenterX = center.x + dirX * distance;
    const pairCenterY = center.y + dirY * distance;
    const halfSpacing = dotSpacing / 2;
    dots.push(
      { x: pairCenterX - tangentX * halfSpacing, y: pairCenterY - tangentY * halfSpacing },
      { x: pairCenterX + tangentX * halfSpacing, y: pairCenterY + tangentY * halfSpacing }
    );
  }
  return dots;
}

// ---------------------------------------------------------------------------
// Stereochemistry
// ---------------------------------------------------------------------------

/**
 * Returns a Map from bond ID → `'wedge'` | `'dash'` for all chiral centers
 * in the molecule that have 2D coordinates assigned.
 *
 * Picks exactly one bond per chiral center, preferring visible exocyclic
 * substituents, then visible ring atoms, then H.  Within each tier the bond
 * with the largest vertical offset from the center is chosen (most
 * perpendicular to the main chain).  The wedge/dash type is determined via
 * parity-aware CIP winding so the correct absolute configuration is conveyed
 * regardless of which substituent is chosen.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {string} centerId - ID of the stereo center atom.
 * @param {string|null} [preferredBondId] - Preferred bond ID for the stereo wedge.
 * @returns {Map<string, 'wedge'|'dash'>} The resulting map.
 */
export function stereoBondTypeForCenter(mol, centerId, preferredBondId = null) {
  const center = mol.atoms.get(centerId);
  if (!center || center.x == null) {
    return null;
  }
  const chirality = center.getChirality();
  if (!chirality) {
    return null;
  }

  const neighbors = center.getNeighbors(mol).filter(n => n && n.x != null);
  if (neighbors.length !== 4) {
    return null;
  }

  const ranks = assignCIPRanks(
    centerId,
    neighbors.map(n => n.id),
    mol
  );
  const entries = neighbors
    .map((n, i) => {
      const bond = [...mol.bonds.values()].find(b => (b.atoms[0] === centerId && b.atoms[1] === n.id) || (b.atoms[1] === centerId && b.atoms[0] === n.id));
      return { atom: n, rank: ranks[i], bond };
    })
    .filter(e => e.bond);

  if (entries.length !== 4) {
    return null;
  }
  entries.sort((a, b) => a.rank - b.rank);

  const v = e => ({ x: e.atom.x - center.x, y: e.atom.y - center.y });
  const cross2D = (u, w) => u.x * w.y - u.y * w.x;
  const visible = entries.filter(e => e.atom.visible !== false);
  const exocyclic = visible.filter(e => !e.atom.isInRing(mol));
  const exocyclicHeavy = exocyclic.filter(e => e.atom.name !== 'H');
  const candidates = exocyclicHeavy.length > 0 ? exocyclicHeavy : exocyclic.length > 0 ? exocyclic : visible.length > 0 ? visible : entries;

  const preferred =
    preferredBondId != null ? (candidates.find(cand => cand.bond.id === preferredBondId) ?? entries.find(entry => entry.bond.id === preferredBondId) ?? null) : null;

  const chosen = preferred ?? candidates.reduce((best, cand) => (cand.rank > best.rank || (cand.rank === best.rank && cand.bond.id < best.bond.id) ? cand : best));

  const others = entries.filter(e => e !== chosen).sort((a, b) => b.rank - a.rank);
  const heavyOtherVecs = others.filter(e => !(e.atom.name === 'H' && e.atom.visible === false)).map(v);

  const safeV = e => {
    if (e.atom.name === 'H' && e.atom.visible === false && heavyOtherVecs.length === 2) {
      const sx = -(heavyOtherVecs[0].x + heavyOtherVecs[1].x);
      const sy = -(heavyOtherVecs[0].y + heavyOtherVecs[1].y);
      const len = vecLen(sx, sy);
      const bl = vecLen(heavyOtherVecs[0].x, heavyOtherVecs[0].y);
      return { x: (sx / len) * bl, y: (sy / len) * bl };
    }
    return v(e);
  };

  const [vA, vB, vD] = others.map(safeV);
  const signedArea = cross2D(vA, vB) + cross2D(vB, vD) + cross2D(vD, vA);
  const lowerCount = entries.filter(e => e.rank < chosen.rank).length;
  let computed = signedArea > 0 ? 'S' : 'R';
  if (lowerCount % 2 === 1) {
    computed = computed === 'S' ? 'R' : 'S';
  }
  return {
    bondId: chosen.bond.id,
    type: computed === chirality ? 'dash' : 'wedge',
    centerId
  };
}

/**
 * Applies an explicit displayed stereo choice back onto the chiral center by
 * updating its stored CIP designation so the requested bond renders as the
 * requested wedge/dash type for the current geometry.
 *
 * This should only be used for intentional stereo-edit actions. Ordinary
 * redraws should continue treating stored chirality as the chemistry truth and
 * derive wedge/dash from that.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {string} centerId - ID of the center atom.
 * @param {string} bondId - The bond ID.
 * @param {'wedge'|'dash'} desiredType - The desiredType value.
 * @returns {{ bondId: string, type: 'wedge'|'dash', centerId: string }|null} The result object.
 */
export function applyDisplayedStereoToCenter(mol, centerId, bondId, desiredType) {
  if (!mol || !centerId || !bondId || (desiredType !== 'wedge' && desiredType !== 'dash')) {
    return null;
  }
  const center = mol.atoms.get(centerId);
  const bond = mol.bonds.get(bondId);
  if (!center || !bond || !bond.atoms.includes(centerId)) {
    return null;
  }

  const current = stereoBondTypeForCenter(mol, centerId, bondId);
  if (current?.type === desiredType) {
    return current;
  }

  const candidates = center.getChirality() ? [center.getChirality() === 'R' ? 'S' : 'R'] : ['R', 'S'];
  const originalChirality = center.getChirality();
  for (const candidate of candidates) {
    try {
      center.setChirality(candidate, mol);
    } catch {
      continue;
    }
    const resolved = stereoBondTypeForCenter(mol, centerId, bondId);
    if (resolved?.type === desiredType) {
      return resolved;
    }
  }

  center.setChirality(originalChirality);
  return stereoBondTypeForCenter(mol, centerId, bondId);
}

function _bondSidePriority(mol, startId, blockedId) {
  const visited = new Set([blockedId]);
  const queue = [{ atomId: startId, depth: 0 }];
  let heavyCount = 0;
  let totalProtons = 0;
  let branchScore = 0;
  let maxDepth = 0;
  const shellSignature = [];

  while (queue.length > 0) {
    const { atomId, depth } = queue.shift();
    if (visited.has(atomId)) {
      continue;
    }
    visited.add(atomId);
    const atom = mol?.atoms?.get?.(atomId) ?? null;
    if (!atom || atom.name === 'H') {
      continue;
    }

    heavyCount += 1;
    totalProtons += atom.properties?.protons ?? 0;
    maxDepth = Math.max(maxDepth, depth);
    shellSignature[depth] ??= [];
    shellSignature[depth].push(atom.properties?.protons ?? 0);

    const nextHeavyNeighbors = atom.getNeighbors(mol).filter(neighbor => neighbor && neighbor.id !== blockedId && neighbor.name !== 'H' && !visited.has(neighbor.id));
    if (nextHeavyNeighbors.length > 1) {
      branchScore += nextHeavyNeighbors.length - 1;
    }
    for (const neighbor of nextHeavyNeighbors) {
      queue.push({ atomId: neighbor.id, depth: depth + 1 });
    }
  }

  for (const layer of shellSignature) {
    if (Array.isArray(layer)) {
      layer.sort((a, b) => b - a);
    }
  }

  const startAtom = mol?.atoms?.get?.(startId) ?? null;
  const startHeavyDegree = startAtom ? startAtom.getNeighbors(mol).filter(neighbor => neighbor && neighbor.id !== blockedId && neighbor.name !== 'H').length : 0;

  return {
    heavyCount,
    totalProtons,
    branchScore,
    maxDepth,
    startProtons: startAtom?.properties?.protons ?? 0,
    startHeavyDegree,
    shellSignature
  };
}

function _compareBondSidePriority(left, right) {
  const scalarKeys = ['heavyCount', 'totalProtons', 'branchScore', 'maxDepth', 'startHeavyDegree', 'startProtons'];
  for (const key of scalarKeys) {
    const diff = (left?.[key] ?? 0) - (right?.[key] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  const maxShells = Math.max(left?.shellSignature?.length ?? 0, right?.shellSignature?.length ?? 0);
  for (let i = 0; i < maxShells; i++) {
    const leftShell = left?.shellSignature?.[i] ?? [];
    const rightShell = right?.shellSignature?.[i] ?? [];
    const maxEntries = Math.max(leftShell.length, rightShell.length);
    for (let j = 0; j < maxEntries; j++) {
      const diff = (leftShell[j] ?? -1) - (rightShell[j] ?? -1);
      if (diff !== 0) {
        return diff;
      }
    }
  }

  return 0;
}

/**
 * Returns the preferred stereo center atom ID to use when rendering the given bond.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {string} bondId - Bond ID to query.
 * @param {string|null} [preferredCenterId] - Hint for preferred center.
 * @returns {string|null} The preferred center atom ID, or null.
 */
export function getPreferredBondDisplayCenterId(mol, bondId, preferredCenterId = null) {
  if (!mol || !bondId) {
    return null;
  }
  const bond = mol.bonds.get(bondId);
  if (!bond) {
    return null;
  }
  if (preferredCenterId && bond.atoms.includes(preferredCenterId)) {
    return preferredCenterId;
  }

  const [atomIdA, atomIdB] = bond.atoms;
  if (!atomIdA || !atomIdB) {
    return atomIdA ?? atomIdB ?? null;
  }

  const priorityA = _bondSidePriority(mol, atomIdA, atomIdB);
  const priorityB = _bondSidePriority(mol, atomIdB, atomIdA);
  const comparison = _compareBondSidePriority(priorityA, priorityB);
  if (comparison > 0) {
    return atomIdA;
  }
  if (comparison < 0) {
    return atomIdB;
  }
  return atomIdA;
}

/**
 * Returns the stereo center atom ID to use when rendering the given bond.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {string} bondId - Bond ID to query.
 * @returns {string|null} The center atom ID, or null.
 */
export function stereoBondCenterIdForRender(mol, bondId) {
  if (!mol || !bondId) {
    return null;
  }
  const bond = mol.bonds.get(bondId);
  if (!bond) {
    return null;
  }

  const forcedCenterId = mol?.__reactionPreview?.forcedStereoBondCenters?.get?.(bondId) ?? null;
  if (forcedCenterId && bond.atoms.includes(forcedCenterId)) {
    return forcedCenterId;
  }

  const displayCenterId = bond.properties.display?.centerId ?? null;
  if (displayCenterId && bond.atoms.includes(displayCenterId)) {
    return displayCenterId;
  }

  const [aId, bId] = bond.atoms;
  if (mol.atoms.get(aId)?.getChirality?.()) {
    return aId;
  }
  if (mol.atoms.get(bId)?.getChirality?.()) {
    return bId;
  }
  return null;
}

function _clearBondDisplayStereo(bond) {
  if (!bond?.properties?.display) {
    return;
  }
  delete bond.properties.display.as;
  delete bond.properties.display.centerId;
  delete bond.properties.display.manual;
  if (Object.keys(bond.properties.display).length === 0) {
    delete bond.properties.display;
  }
}

function _setBondDisplayStereo(bond, type, centerId = null, manual = false) {
  if (!bond || (type !== 'wedge' && type !== 'dash')) {
    _clearBondDisplayStereo(bond);
    return;
  }
  bond.properties.display ??= {};
  bond.properties.display.as = type;
  if (manual) {
    bond.properties.display.manual = true;
  } else {
    delete bond.properties.display.manual;
  }
  if (centerId) {
    bond.properties.display.centerId = centerId;
  } else {
    delete bond.properties.display.centerId;
  }
}

/**
 * Returns whether the given display center currently represents a true chiral
 * stereo center handled by the wedge-selection logic.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {string|null} centerId - Candidate display-center atom ID.
 * @returns {boolean} True when the atom is a chiral center.
 */
function _isChiralDisplayCenter(mol, centerId) {
  if (!centerId) {
    return false;
  }
  return !!mol?.atoms?.get?.(centerId)?.getChirality?.();
}

function _resolveStereoDisplayAssignments(mol, previousStereoMap = null) {
  const assignments = [];
  const forcedBondTypes = mol?.__reactionPreview?.forcedStereoBondTypes ?? null;
  const forcedBondCenters = mol?.__reactionPreview?.forcedStereoBondCenters ?? null;
  const lockedCenters = new Set();
  for (const bond of mol?.bonds?.values?.() ?? []) {
    const displayAs = bond.properties.display?.as ?? null;
    if ((displayAs !== 'wedge' && displayAs !== 'dash') || bond.properties.display?.manual !== true) {
      continue;
    }
    const centerId = bond.properties.display?.centerId ?? null;
    assignments.push({ bondId: bond.id, type: displayAs, centerId, manual: true });
    if (centerId) {
      lockedCenters.add(centerId);
    }
  }
  for (const [bondId, type] of forcedBondTypes ?? new Map()) {
    const bond = mol?.bonds?.get(bondId);
    if (!bond) {
      continue;
    }
    const centerId = forcedBondCenters?.get?.(bondId) ?? bond.atoms.find(atomId => mol.atoms.get(atomId)?.getChirality?.()) ?? null;
    assignments.push({ bondId, type, centerId });
    if (centerId) {
      lockedCenters.add(centerId);
    }
  }
  const storedDisplayByCenter = new Map();
  const preservedNonChiralAssignments = [];
  const preferredBondByCenter = new Map();
  for (const bond of mol?.bonds?.values?.() ?? []) {
    const displayAs = bond.properties.display?.as ?? null;
    if ((displayAs !== 'wedge' && displayAs !== 'dash') || bond.properties.display?.manual === true) {
      continue;
    }
    const centerId = bond.properties.display?.centerId ?? stereoBondCenterIdForRender(mol, bond.id);
    if (!_isChiralDisplayCenter(mol, centerId)) {
      preservedNonChiralAssignments.push({
        bondId: bond.id,
        type: displayAs,
        centerId
      });
      continue;
    }
    if (!centerId || preferredBondByCenter.has(centerId)) {
      continue;
    }
    preferredBondByCenter.set(centerId, bond.id);
    storedDisplayByCenter.set(centerId, {
      bondId: bond.id,
      type: displayAs,
      centerId
    });
  }
  for (const [bondId] of previousStereoMap ?? new Map()) {
    const centerId = stereoBondCenterIdForRender(mol, bondId);
    if (!_isChiralDisplayCenter(mol, centerId)) {
      continue;
    }
    if (!centerId || preferredBondByCenter.has(centerId)) {
      continue;
    }
    preferredBondByCenter.set(centerId, bondId);
    storedDisplayByCenter.set(centerId, {
      bondId,
      type: previousStereoMap.get(bondId),
      centerId
    });
  }
  const forcedByCenter = mol?.__reactionPreview?.forcedStereoByCenter ?? mol?.__reactionPreview?.forcedProductStereoByCenter ?? null;
  const visitedCenters = new Set();
  for (const centerId of mol.getChiralCenters()) {
    visitedCenters.add(centerId);
    if (lockedCenters.has(centerId)) {
      continue;
    }
    const stored = storedDisplayByCenter.get(centerId) ?? null;
    if (stored) {
      const storedBond = mol?.bonds?.get?.(stored.bondId) ?? null;
      if (storedBond && storedBond.atoms.includes(centerId)) {
        assignments.push(stored);
        continue;
      }
    }
    const forced = forcedByCenter?.get(centerId) ?? null;
    const stereo = stereoBondTypeForCenter(mol, centerId, forced?.bondId ?? preferredBondByCenter.get(centerId) ?? null);
    if (!stereo) {
      continue;
    }
    assignments.push({
      bondId: stereo.bondId,
      type: forced?.type ?? stereo.type,
      centerId
    });
  }
  // Preserve stored assignments for centers whose chirality was cleared (not in getChiralCenters).
  // This prevents nearby auto-assigned stereo bonds from disappearing when a bond is drawn
  // between two existing stereocenters and clearStereoAnnotations resets one center's chirality.
  for (const [centerId, stored] of storedDisplayByCenter) {
    if (visitedCenters.has(centerId) || lockedCenters.has(centerId)) {
      continue;
    }
    if (assignments.some(a => a.centerId === centerId)) {
      continue;
    }
    const storedBond = mol?.bonds?.get?.(stored.bondId) ?? null;
    if (storedBond && storedBond.atoms.includes(centerId)) {
      assignments.push({ bondId: stored.bondId, type: stored.type, centerId });
    }
  }
  const assignedBondIds = new Set(assignments.map(({ bondId }) => bondId));
  for (const assignment of preservedNonChiralAssignments) {
    if (assignedBondIds.has(assignment.bondId)) {
      continue;
    }
    assignments.push(assignment);
    assignedBondIds.add(assignment.bondId);
  }
  return assignments;
}

/**
 * Computes a Map of bond ID to stereo wedge type ('wedge' | 'dash') for all chiral centers.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {Map.<string, string>|null} [previousStereoMap] - Previous stereo assignment map.
 * @returns {Map.<string, string>} Map from bond ID to 'wedge' or 'dash'.
 */
export function pickStereoWedges(mol, previousStereoMap = null) {
  const result = new Map();
  for (const { bondId, type } of _resolveStereoDisplayAssignments(mol, previousStereoMap)) {
    result.set(bondId, type);
  }
  return result;
}

/**
 * Applies stereo wedge assignments to bond display properties.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {Map.<string, string>|null} [previousStereoMap] - Previous stereo assignment map.
 * @returns {Map.<string, string>} New stereo map from bond ID to 'wedge' or 'dash'.
 */
export function syncDisplayStereo(mol, previousStereoMap = null) {
  const assignments = _resolveStereoDisplayAssignments(mol, previousStereoMap);
  for (const bond of mol?.bonds?.values?.() ?? []) {
    _clearBondDisplayStereo(bond);
  }
  for (const { bondId, type, centerId, manual = false } of assignments) {
    _setBondDisplayStereo(mol?.bonds?.get?.(bondId) ?? null, type, centerId, manual);
  }
  return new Map(assignments.map(({ bondId, type }) => [bondId, type]));
}

/**
 * Flips all stereo wedge assignments (wedge ↔ dash) and applies them.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {Map.<string, string>|null} [previousStereoMap] - Previous stereo assignment map.
 * @returns {Map.<string, string>} New stereo map from bond ID to 'wedge' or 'dash'.
 */
export function flipDisplayStereo(mol, previousStereoMap = null) {
  const assignments = _resolveStereoDisplayAssignments(mol, previousStereoMap).map(({ bondId, type, centerId, manual = false }) => ({
    bondId,
    type: type === 'wedge' ? 'dash' : 'wedge',
    centerId,
    manual
  }));
  for (const bond of mol?.bonds?.values?.() ?? []) {
    _clearBondDisplayStereo(bond);
  }
  for (const { bondId, type, centerId, manual = false } of assignments) {
    _setBondDisplayStereo(mol?.bonds?.get?.(bondId) ?? null, type, centerId, manual);
  }
  return new Map(assignments.map(({ bondId, type }) => [bondId, type]));
}

// ---------------------------------------------------------------------------
// kekulize — assign localizedOrder (1 or 2) to aromatic bonds that lack it.
//
// Uses DFS augmenting-path maximum matching on the aromatic π-subgraph.
// Bonds that already have localizedOrder (e.g. from InChI parsing) are
// left untouched.  The function mutates bond.properties in-place and is
// idempotent — calling it twice has no additional effect.
// ---------------------------------------------------------------------------
/**
 * Assigns localizedOrder (1 or 2) to aromatic bonds that lack it, using maximum matching.
 * Mutates bond properties in-place.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 */
export function kekulize(mol) {
  const aroBonds = [];
  for (const bond of mol.bonds.values()) {
    if (bond.properties.aromatic && bond.properties.localizedOrder == null) {
      aroBonds.push(bond);
    }
  }
  if (aroBonds.length === 0) {
    return;
  }

  const aroAtomIds = new Set();
  for (const b of aroBonds) {
    aroAtomIds.add(b.atoms[0]);
    aroAtomIds.add(b.atoms[1]);
  }

  // Neutral σ-frame valence for common aromatic elements.
  // Used to determine whether an atom has capacity for a π (double) bond.
  const SIGMA_VAL = {
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

  // For each aromatic atom, sum the σ-frame contribution of every bond it has
  // (treating all aromatic bonds as order 1, non-aromatic bonds at face value).
  // This tells us how much of the atom's valence is already committed to the σ
  // skeleton, leaving the remainder for a possible π bond.
  const sigmaBO = new Map();
  for (const id of aroAtomIds) {
    sigmaBO.set(id, 0);
  }
  for (const bond of mol.bonds.values()) {
    const [a, c] = bond.atoms;
    const contrib = bond.properties.aromatic ? 1 : (bond.properties.order ?? 1);
    if (aroAtomIds.has(a)) {
      sigmaBO.set(a, sigmaBO.get(a) + contrib);
    }
    if (aroAtomIds.has(c)) {
      sigmaBO.set(c, sigmaBO.get(c) + contrib);
    }
  }

  // An atom can hold a π bond only when its available sigma-frame valence
  // leaves room for one more bond order. Positive charges can expand that
  // capacity for common aromatic heteroatoms (for example pyrylium O+ and
  // pyridinium [nH+]), while negative charges can reduce it.
  // Examples that are correctly excluded:
  //   Indolizine N (3 aro bonds, val 3): 3 − 3 = 0 → lone-pair donor, no C=N
  //   Furan O     (2 aro bonds, val 2): 2 − 2 = 0 → lone-pair donor, no C=O
  //   Pyrrole N–H (2 aro bonds + 1 H):  3 − 3 = 0 → lone-pair donor
  //   Pyridine N  (2 aro bonds, val 3): 3 − 2 = 1 → included ✓
  const canHaveDouble = new Set();
  for (const id of aroAtomIds) {
    const atom = mol.atoms.get(id);
    const neutralBase = SIGMA_VAL[atom.name] ?? 4;
    const adjustedBase = Math.max(0, neutralBase + (atom?.getCharge() ?? 0));
    if (adjustedBase - sigmaBO.get(id) >= 1) {
      canHaveDouble.add(id);
    }
  }

  // Build matching adjacency — only bonds between two π-capable atoms.
  const adj = new Map();
  for (const id of canHaveDouble) {
    adj.set(id, []);
  }
  for (const b of aroBonds) {
    const [a, c] = b.atoms;
    if (canHaveDouble.has(a) && canHaveDouble.has(c)) {
      adj.get(a).push({ bondId: b.id, otherId: c });
      adj.get(c).push({ bondId: b.id, otherId: a });
    }
  }

  const mate = new Map();
  for (const id of canHaveDouble) {
    mate.set(id, null);
  }
  const matchedBond = new Map();

  function tryAugment(startId) {
    const visited = new Set([startId]);
    function dfs(v) {
      for (const { bondId, otherId: u } of adj.get(v)) {
        if (visited.has(u)) {
          continue;
        }
        visited.add(u);
        const mateOfU = mate.get(u);
        if (mateOfU === null || dfs(mateOfU)) {
          mate.set(v, u);
          mate.set(u, v);
          matchedBond.set(v, bondId);
          matchedBond.set(u, bondId);
          return true;
        }
      }
      return false;
    }
    return dfs(startId);
  }

  for (const id of canHaveDouble) {
    if (mate.get(id) === null) {
      tryAugment(id);
    }
  }

  const doubleBondIds = new Set();
  for (const [atomId, bondId] of matchedBond) {
    if (mate.get(atomId) !== null) {
      doubleBondIds.add(bondId);
    }
  }
  for (const b of aroBonds) {
    b.properties.localizedOrder = doubleBondIds.has(b.id) ? 2 : 1;
  }
}
