/** @module layout/hydrogen-display */

function atomGroup(atom) {
  return atom?.properties?.group ?? atom?.group ?? 0;
}

const POST_TRANSITION_METAL_SYMBOLS = new Set(['Al', 'Ga', 'In', 'Tl', 'Sn', 'Pb', 'Bi', 'Po', 'Nh', 'Fl', 'Mc', 'Lv']);
const TAU = Math.PI * 2;
const GEOMETRY_EPSILON = 1e-6;

/**
 * Returns whether an atom should keep directly attached hydrogens explicit in 2D skeletal rendering.
 * @param {object|null|undefined} atom - Atom-like object.
 * @returns {boolean} True for common metal atoms.
 */
export function isHydrideDisplayMetal(atom) {
  const group = atomGroup(atom);
  if (atom?.name !== 'H' && group >= 1 && group <= 12) {
    return true;
  }
  return POST_TRANSITION_METAL_SYMBOLS.has(atom?.name);
}

/**
 * Returns whether a hydrogen is directly bonded to a transition metal.
 * @param {object|null|undefined} atom - Atom-like object.
 * @param {object|null|undefined} molecule - Molecule-like graph.
 * @returns {boolean} True for metal hydride display hydrogens.
 */
export function isMetalBoundHydrogen(atom, molecule) {
  if (!atom || atom.name !== 'H' || !molecule) {
    return false;
  }
  return atom.getNeighbors?.(molecule)?.some(neighbor => isHydrideDisplayMetal(neighbor)) ?? false;
}

/**
 * Counts hydrogens that should be folded into atom labels in 2D skeletal rendering.
 * Metal-bound hydrogens stay explicit so hydrides render as Fe-H instead of FeH.
 * @param {object|null|undefined} molecule - Molecule-like graph.
 * @returns {Map<string, number>} Atom id to folded hydrogen count.
 */
export function collect2dHydrogenLabelCounts(molecule) {
  const hCounts = new Map();
  if (!molecule?.atoms) {
    return hCounts;
  }
  for (const atom of molecule.atoms.values()) {
    if (atom.name === 'H') {
      continue;
    }
    const count = atom.getNeighbors(molecule).filter(neighbor => neighbor.name === 'H' && !isMetalBoundHydrogen(neighbor, molecule)).length;
    if (count > 0) {
      hCounts.set(atom.id, count);
    }
  }
  return hCounts;
}

/**
 * Hides ordinary hydrogens for skeletal 2D rendering while keeping metal hydrides explicit.
 * @param {object|null|undefined} molecule - Molecule-like graph.
 * @returns {object|null|undefined} The input molecule.
 */
export function hideHydrogensFor2d(molecule) {
  if (!molecule?.atoms) {
    return molecule;
  }
  for (const atom of molecule.atoms.values()) {
    if (atom.name === 'H') {
      atom.visible = isMetalBoundHydrogen(atom, molecule);
    }
  }
  return molecule;
}

/**
 * Marks metal-bound hydrogens visible without changing other hydrogens.
 * @param {object|null|undefined} molecule - Molecule-like graph.
 * @returns {object|null|undefined} The input molecule.
 */
export function showMetalBoundHydrogens(molecule) {
  if (!molecule?.atoms) {
    return molecule;
  }
  for (const atom of molecule.atoms.values()) {
    if (isMetalBoundHydrogen(atom, molecule)) {
      atom.visible = true;
    }
  }
  return molecule;
}

function isFinitePoint(atom) {
  return Number.isFinite(atom?.x) && Number.isFinite(atom?.y);
}

function normalizeAngle(angle) {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

function largestAngularGapMidpoint(angles, fallbackAngle = 0) {
  if (angles.length === 0) {
    return normalizeAngle(fallbackAngle);
  }
  const sorted = [...angles].sort((a, b) => a - b);
  let bestStart = sorted[0];
  let bestGap = -Infinity;
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index];
    const end = index === sorted.length - 1 ? sorted[0] + TAU : sorted[index + 1];
    const gap = end - start;
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = start;
    }
  }
  return normalizeAngle(bestStart + bestGap / 2);
}

/**
 * Materializes coordinates for visible metal-bound hydrogens that are missing or collapsed onto the metal.
 * @param {object|null|undefined} molecule - Molecule-like graph.
 * @param {object} [options] - Placement options.
 * @param {number} [options.bondLength] - Target metal-H display bond length.
 * @returns {number} Number of hydrogen atoms moved.
 */
export function materializeMetalHydrideCoords(molecule, { bondLength = 1.5 } = {}) {
  if (!molecule?.atoms) {
    return 0;
  }
  const targetBondLength = Number.isFinite(Number(bondLength)) && Number(bondLength) > 0 ? Number(bondLength) : 1.5;
  let moved = 0;
  for (const hydrogen of molecule.atoms.values()) {
    if (!isMetalBoundHydrogen(hydrogen, molecule)) {
      continue;
    }
    const parent = hydrogen.getNeighbors?.(molecule)?.find(neighbor => isHydrideDisplayMetal(neighbor) && isFinitePoint(neighbor)) ?? null;
    if (!parent) {
      continue;
    }
    hydrogen.visible = true;
    const currentDistance = isFinitePoint(hydrogen) ? Math.hypot(hydrogen.x - parent.x, hydrogen.y - parent.y) : 0;
    if (currentDistance > targetBondLength * 0.2) {
      continue;
    }
    const occupiedAngles = [];
    for (const neighbor of parent.getNeighbors?.(molecule) ?? []) {
      if (neighbor.id === hydrogen.id || !isFinitePoint(neighbor)) {
        continue;
      }
      const dx = neighbor.x - parent.x;
      const dy = neighbor.y - parent.y;
      if (Math.hypot(dx, dy) <= GEOMETRY_EPSILON) {
        continue;
      }
      occupiedAngles.push(normalizeAngle(Math.atan2(dy, dx)));
    }
    const angle = largestAngularGapMidpoint(occupiedAngles, 0);
    hydrogen.x = parent.x + Math.cos(angle) * targetBondLength;
    hydrogen.y = parent.y + Math.sin(angle) * targetBondLength;
    moved++;
  }
  return moved;
}
