/** @module app/interactions/navigation */

import { pointInPolygon } from '../../layout/engine/geometry/polygon.js';
import { convertForceCoordsToLineLayout, convertLineCoordsToForceLayout, FORCE_LAYOUT_BOND_LENGTH, FORCE_LAYOUT_INITIAL_FIT_PAD, FORCE_LAYOUT_INITIAL_H_RADIUS_SCALE, FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER } from '../render/force-helpers.js';
import { atomRadius } from '../render/helpers.js';

const DEFAULT_LAYOUT_BOND_LENGTH = 1.5;
const CLEAN_2D_BOND_LENGTH_TOLERANCE = 0.18;
const CLEAN_RING_SNAP_MIN_SIZE = 3;
const CLEAN_RING_SNAP_MAX_SIZE = 8;
const CLEAN_RING_SNAP_MAX_DISPLACEMENT_RATIO = 0.75;
const CLEAN_RING_SNAP_RMS_DISPLACEMENT_RATIO = 0.4;
const CLEAN_RING_SNAP_MIN_MOVE = 1e-4;
const CLEAN_RING_SUBSTITUENT_MIN_ANGLE_DELTA = (1 * Math.PI) / 180;
const CLEAN_MULTI_RING_EXIT_MIN_GAP = (45 * Math.PI) / 180;
const CLEAN_MULTI_RING_EXIT_SCAN_STEP = (15 * Math.PI) / 180;
const ROTATE_FIT_FALLBACK_PAD = 40;
const ROTATE_FIT_ZOOM_MULTIPLIER = 1.3;
const ROTATE_FIT_MAX_SCALE = 30;
const FORCE_SELECTION_HYDROGEN_PARENT_ELEMENTS = new Set(['N', 'O', 'P', 'S']);
const SELECTION_PIVOT_ATOM_SNAP_RADIUS = 16;

/**
 * Preserves reaction-preview metadata on a working molecule clone so clean and
 * refinement flows keep preview-specific layout and display state intact.
 * @param {object} sourceMol - Source molecule that may carry preview metadata.
 * @param {object} targetMol - Working clone that will be refined and rendered.
 * @returns {void}
 */
function preserveReactionPreviewMetadata(sourceMol, targetMol) {
  if (!sourceMol?.__reactionPreview || !targetMol) {
    return;
  }
  targetMol.__reactionPreview = sourceMol.__reactionPreview;
}

/**
 * Restores displayed stereochemical hydrogens to their parent coordinate so
 * render-time projection can choose the canonical visible H position again.
 * @param {object} molecule - Molecule clone whose stereo H coordinates may have been dragged.
 * @returns {number} Number of hydrogens reset.
 */
function resetDisplayedStereoHydrogenCoords(molecule) {
  let resetCount = 0;
  for (const atom of molecule?.atoms?.values?.() ?? []) {
    if (atom.name !== 'H') {
      continue;
    }
    const neighbors = atom.getNeighbors?.(molecule) ?? [];
    if (neighbors.length !== 1) {
      continue;
    }
    const parent = neighbors[0];
    if (!parent || !parent.getChirality?.() || !Number.isFinite(parent.x) || !Number.isFinite(parent.y)) {
      continue;
    }
    const bond = molecule.getBond?.(atom.id, parent.id);
    const displayAs = bond?.properties?.display?.as ?? null;
    if (displayAs !== 'wedge' && displayAs !== 'dash') {
      continue;
    }
    atom.x = parent.x;
    atom.y = parent.y;
    resetCount++;
  }
  return resetCount;
}

function expandForceSelectionHydrogensForSelectedLabels(molecule, selectedAtomIds) {
  if (!molecule?.atoms || !selectedAtomIds?.size) {
    return 0;
  }
  let addedCount = 0;
  for (const atomId of [...selectedAtomIds]) {
    const parent = molecule.atoms.get(atomId);
    if (!parent || !FORCE_SELECTION_HYDROGEN_PARENT_ELEMENTS.has(parent.name)) {
      continue;
    }
    for (const neighbor of parent.getNeighbors?.(molecule) ?? []) {
      if (!neighbor || neighbor.name !== 'H') {
        continue;
      }
      if (!selectedAtomIds.has(neighbor.id)) {
        selectedAtomIds.add(neighbor.id);
        addedCount++;
      }
    }
  }
  return addedCount;
}

/**
 * Expands a local heavy-atom patch around a stretched bond endpoint.
 * A two-hop neighborhood gives refinement enough context to relax attached
 * substituents without forcing a full-component relayout.
 * @param {object} molecule - Molecule containing the distorted local patch.
 * @param {object} atom - Seed atom for the touched-neighborhood expansion.
 * @param {Set<string>} touchedAtoms - Accumulator for touched atom ids.
 * @param {Set<string>} touchedBonds - Accumulator for touched bond ids.
 * @param {number} [maxDepth] - Maximum heavy-atom bond distance to include.
 * @returns {void}
 */
function addTouchedHeavyNeighborhood(molecule, atom, touchedAtoms, touchedBonds, maxDepth = 2) {
  if (!atom || atom.name === 'H' || atom.visible === false) {
    return;
  }

  const visitedAtoms = new Set([atom.id]);
  const queue = [{ atom, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current?.atom || current.atom.name === 'H' || current.atom.visible === false) {
      continue;
    }
    touchedAtoms.add(current.atom.id);
    if (current.depth >= maxDepth) {
      continue;
    }
    for (const bond of molecule.bonds.values()) {
      if (!bond.atoms?.includes(current.atom.id)) {
        continue;
      }
      const neighborId = bond.atoms[0] === current.atom.id ? bond.atoms[1] : bond.atoms[0];
      const neighbor = molecule.atoms.get(neighborId);
      if (!neighbor || neighbor.name === 'H' || neighbor.visible === false) {
        continue;
      }
      touchedBonds.add(bond.id);
      touchedAtoms.add(neighbor.id);
      if (visitedAtoms.has(neighbor.id)) {
        continue;
      }
      visitedAtoms.add(neighbor.id);
      queue.push({ atom: neighbor, depth: current.depth + 1 });
    }
  }
}

/**
 * Seeds molecule atom coordinates from the live force-simulation node positions.
 * @param {object} molecule - Molecule clone that will receive temporary 2D coordinates.
 * @param {Array<object>} nodes - Force-simulation nodes with finite `x`/`y` positions.
 * @param {number} [bondLength] - Active line-layout bond length in molecule coordinate units.
 * @returns {Map<string, {x: number, y: number}>} Centered 2D coordinates keyed by atom id.
 */
function seedMoleculeFromForcePositions(molecule, nodes, bondLength = DEFAULT_LAYOUT_BOND_LENGTH) {
  const placedCoords = new Map();
  if (!molecule?.atoms || !Array.isArray(nodes) || nodes.length === 0) {
    return placedCoords;
  }

  const converted = convertForceCoordsToLineLayout(molecule, nodes, {
    bondLength,
    forceBondLength: FORCE_LAYOUT_BOND_LENGTH * (bondLength / DEFAULT_LAYOUT_BOND_LENGTH)
  });
  if (!converted.coords?.size) {
    return placedCoords;
  }

  for (const [atomId, pos] of converted.coords) {
    const atom = molecule.atoms.get(atomId);
    if (!atom || !Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) {
      continue;
    }
    const x = pos.x;
    const y = pos.y;
    atom.x = x;
    atom.y = y;
    placedCoords.set(atomId, { x, y });
  }

  return placedCoords;
}

/**
 * Builds a force anchor-layout map from the currently placed molecule coordinates.
 * @param {object} molecule - Molecule whose placed coordinates should anchor force layout.
 * @returns {Map<string, {x: number, y: number}>} Non-hydrogen anchor coordinates keyed by atom id.
 */
function buildForceAnchorLayoutFromPlacedCoords(molecule) {
  const anchorLayout = new Map();
  if (!molecule?.atoms) {
    return anchorLayout;
  }

  for (const [id, atom] of molecule.atoms) {
    if (atom.name === 'H' || atom.visible === false) {
      continue;
    }
    if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    anchorLayout.set(id, { x: atom.x, y: atom.y });
  }

  return anchorLayout;
}

function applyLineLayoutCoords(molecule, coords) {
  if (!molecule?.atoms || !(coords instanceof Map)) {
    return 0;
  }
  let applied = 0;
  for (const [atomId, pos] of coords) {
    const atom = molecule.atoms.get(atomId);
    if (!atom || !Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) {
      continue;
    }
    atom.x = pos.x;
    atom.y = pos.y;
    applied++;
  }
  return applied;
}

function captureFiniteAtomCoords(molecule) {
  const coords = new Map();
  for (const [atomId, atom] of molecule?.atoms ?? []) {
    if (!Number.isFinite(atom?.x) || !Number.isFinite(atom?.y)) {
      continue;
    }
    coords.set(atomId, { x: atom.x, y: atom.y });
  }
  return coords;
}

function visibleHeavyComponents(molecule) {
  const components = [];
  if (!molecule?.atoms || !molecule?.bonds) {
    return components;
  }
  const heavyAtomIds = [...molecule.atoms.values()]
    .filter(atom => atom?.name !== 'H' && atom?.visible !== false)
    .map(atom => atom.id)
    .filter(Boolean);
  const heavyAtomIdSet = new Set(heavyAtomIds);
  const adjacency = new Map(heavyAtomIds.map(atomId => [atomId, []]));
  for (const bond of molecule.bonds.values()) {
    const [firstId, secondId] = bond?.atoms ?? [];
    if (!heavyAtomIdSet.has(firstId) || !heavyAtomIdSet.has(secondId)) {
      continue;
    }
    adjacency.get(firstId).push(secondId);
    adjacency.get(secondId).push(firstId);
  }

  const visited = new Set();
  for (const atomId of heavyAtomIds) {
    if (visited.has(atomId)) {
      continue;
    }
    const queue = [atomId];
    const component = [];
    visited.add(atomId);
    for (let index = 0; index < queue.length; index++) {
      const currentAtomId = queue[index];
      component.push(currentAtomId);
      for (const neighborId of adjacency.get(currentAtomId) ?? []) {
        if (visited.has(neighborId)) {
          continue;
        }
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
    components.push(component);
  }
  return components;
}

function hasDisconnectedVisibleHeavyComponents(molecule) {
  return visibleHeavyComponents(molecule).length > 1;
}

function finiteComponentCenter(molecule, atomIds) {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const atomId of atomIds ?? []) {
    const atom = molecule?.atoms?.get?.(atomId);
    if (!Number.isFinite(atom?.x) || !Number.isFinite(atom?.y)) {
      continue;
    }
    x += atom.x;
    y += atom.y;
    count++;
  }
  return count > 0 ? { x: x / count, y: y / count } : null;
}

function captureVisibleHeavyComponentCenters(molecule) {
  return visibleHeavyComponents(molecule)
    .map(atomIds => ({ atomIds, center: finiteComponentCenter(molecule, atomIds) }))
    .filter(component => component.center);
}

function restoreComponentCenters(molecule, componentCenters) {
  let movedCount = 0;
  for (const { atomIds, center } of componentCenters ?? []) {
    const currentCenter = finiteComponentCenter(molecule, atomIds);
    if (!currentCenter || !center) {
      continue;
    }
    const dx = center.x - currentCenter.x;
    const dy = center.y - currentCenter.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
      continue;
    }
    for (const atomId of atomIds) {
      const atom = molecule.atoms.get(atomId);
      if (!atom || !Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
        continue;
      }
      atom.x += dx;
      atom.y += dy;
      movedCount++;
    }
  }
  return movedCount;
}

function visibleHeavyNeighborCount(atom, molecule, excludedAtomId = null) {
  return atom.getNeighbors(molecule).filter(neighbor => neighbor && neighbor.id !== excludedAtomId && neighbor.name !== 'H' && neighbor.visible !== false).length;
}

function reanchorStereoTerminalsToCenters(molecule, referenceCoords) {
  if (!molecule?.atoms || !molecule?.bonds || !(referenceCoords instanceof Map)) {
    return 0;
  }

  let movedCount = 0;
  for (const centerId of molecule.getChiralCenters?.() ?? []) {
    const center = molecule.atoms.get(centerId);
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      continue;
    }
    const centerReference = referenceCoords.get(centerId);
    for (const neighbor of center.getNeighbors(molecule)) {
      if (!neighbor) {
        continue;
      }
      const previousX = neighbor.x;
      const previousY = neighbor.y;
      if (neighbor.name === 'H') {
        neighbor.x = center.x;
        neighbor.y = center.y;
      } else if (
        neighbor.visible !== false &&
        !neighbor.isInRing(molecule) &&
        visibleHeavyNeighborCount(neighbor, molecule, centerId) === 0 &&
        centerReference
      ) {
        const neighborReference = referenceCoords.get(neighbor.id);
        if (!neighborReference) {
          continue;
        }
        neighbor.x = center.x + (neighborReference.x - centerReference.x);
        neighbor.y = center.y + (neighborReference.y - centerReference.y);
      } else {
        continue;
      }
      if (Math.abs((neighbor.x ?? 0) - (previousX ?? 0)) > 1e-9 || Math.abs((neighbor.y ?? 0) - (previousY ?? 0)) > 1e-9) {
        movedCount++;
      }
    }
  }
  return movedCount;
}

function ringBondIds(molecule, ring) {
  const ids = [];
  for (let index = 0; index < ring.length; index++) {
    const firstId = ring[index];
    const secondId = ring[(index + 1) % ring.length];
    const bond =
      typeof molecule.getBond === 'function'
        ? molecule.getBond(firstId, secondId)
        : [...(molecule.bonds?.values?.() ?? [])].find(candidate => candidate?.atoms?.includes(firstId) && candidate?.atoms?.includes(secondId));
    if (bond?.id != null) {
      ids.push(bond.id);
    }
  }
  return ids;
}

function bondBetween(molecule, firstId, secondId) {
  return (
    (typeof molecule.getBond === 'function' ? molecule.getBond(firstId, secondId) : null) ??
    [...(molecule.bonds?.values?.() ?? [])].find(candidate => candidate?.atoms?.includes(firstId) && candidate?.atoms?.includes(secondId)) ??
    null
  );
}

function polygonAreaForRing(ring, coords) {
  let area = 0;
  for (let index = 0; index < ring.length; index++) {
    const current = coords.get(ring[index]);
    const next = coords.get(ring[(index + 1) % ring.length]);
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function regularRingTargetsForCurrentPose(ring, coords, bondLength = DEFAULT_LAYOUT_BOND_LENGTH) {
  const size = ring.length;
  let cx = 0;
  let cy = 0;
  for (const atomId of ring) {
    const position = coords.get(atomId);
    cx += position.x;
    cy += position.y;
  }
  cx /= size;
  cy /= size;

  const radius = bondLength / (2 * Math.sin(Math.PI / size));
  const direction = polygonAreaForRing(ring, coords) >= 0 ? 1 : -1;
  let best = null;
  for (let anchorIndex = 0; anchorIndex < size; anchorIndex++) {
    const anchor = coords.get(ring[anchorIndex]);
    const startAngle = Math.atan2(anchor.y - cy, anchor.x - cx) - direction * ((2 * Math.PI * anchorIndex) / size);
    const targets = new Map();
    let score = 0;
    for (let index = 0; index < size; index++) {
      const angle = startAngle + direction * ((2 * Math.PI * index) / size);
      const target = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle)
      };
      const current = coords.get(ring[index]);
      score += (target.x - current.x) ** 2 + (target.y - current.y) ** 2;
      targets.set(ring[index], target);
    }
    if (!best || score < best.score) {
      best = { score, targets };
    }
  }
  return best?.targets ?? new Map();
}

/**
 * Rotates a connected heavy-atom substituent component around a fixed ring
 * anchor. The component walk blocks the anchor and rejects paths that return
 * to the same ring, so clean can restore an exit angle without distorting the
 * ring scaffold itself.
 * @param {object} molecule - Molecule containing atoms and bonds.
 * @param {string} anchorAtomId - Fixed ring atom id.
 * @param {string} rootAtomId - First substituent atom bonded to the anchor.
 * @param {Set<string>} blockedRingAtomIds - Any ring atoms that must not move.
 * @returns {Set<string>|null} Movable heavy atom ids, or null when unsafe.
 */
function collectMovableRingSubstituent(molecule, anchorAtomId, rootAtomId, blockedRingAtomIds) {
  const rootAtom = molecule.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.name === 'H' || rootAtom.visible === false) {
    return null;
  }

  const movedAtomIds = new Set();
  const visited = new Set([anchorAtomId]);
  const queue = [rootAtomId];
  while (queue.length > 0) {
    const atomId = queue.shift();
    if (visited.has(atomId)) {
      continue;
    }
    visited.add(atomId);
    const atom = molecule.atoms.get(atomId);
    if (!atom || atom.name === 'H' || atom.visible === false) {
      continue;
    }
    if (blockedRingAtomIds.has(atomId)) {
      return null;
    }
    movedAtomIds.add(atomId);
    for (const bond of molecule.bonds?.values?.() ?? []) {
      if (!bond.atoms?.includes(atomId)) {
        continue;
      }
      const neighborId = bond.atoms[0] === atomId ? bond.atoms[1] : bond.atoms[0];
      if (neighborId === anchorAtomId || visited.has(neighborId)) {
        continue;
      }
      const neighbor = molecule.atoms.get(neighborId);
      if (!neighbor || neighbor.name === 'H' || neighbor.visible === false) {
        continue;
      }
      queue.push(neighborId);
    }
  }

  return movedAtomIds.size > 0 ? movedAtomIds : null;
}

function cleanAngleDifference(firstAngle, secondAngle) {
  return Math.acos(Math.max(-1, Math.min(1, Math.cos(firstAngle - secondAngle))));
}

function candidateCleanExitAngles(referenceAngle) {
  const angles = [];
  const addAngle = angle => {
    if (!Number.isFinite(angle) || angles.some(existingAngle => cleanAngleDifference(existingAngle, angle) <= 1e-9)) {
      return;
    }
    angles.push(angle);
  };
  addAngle(referenceAngle);
  for (let step = 1; step < Math.ceil((2 * Math.PI) / CLEAN_MULTI_RING_EXIT_SCAN_STEP); step++) {
    addAngle(referenceAngle + step * CLEAN_MULTI_RING_EXIT_SCAN_STEP);
    addAngle(referenceAngle - step * CLEAN_MULTI_RING_EXIT_SCAN_STEP);
  }
  return angles;
}

function countPointInPolygons(point, polygons) {
  return polygons.reduce((count, polygon) => count + (polygon.length >= 3 && pointInPolygon(point, polygon) ? 1 : 0), 0);
}

function visibleHeavyCoordsForMolecule(molecule) {
  const coords = new Map();
  for (const [atomId, atom] of molecule?.atoms ?? []) {
    if (atom?.name === 'H' || atom?.visible === false || !Number.isFinite(atom?.x) || !Number.isFinite(atom?.y)) {
      continue;
    }
    coords.set(atomId, { x: atom.x, y: atom.y });
  }
  return coords;
}

function ringNeighborAnglesAtAnchor(molecule, coords, anchorAtomId, allRingAtomIds) {
  const anchor = coords.get(anchorAtomId);
  if (!anchor) {
    return [];
  }
  const angles = [];
  for (const bond of molecule.bonds?.values?.() ?? []) {
    if (!bond.atoms?.includes(anchorAtomId)) {
      continue;
    }
    const neighborId = bond.atoms[0] === anchorAtomId ? bond.atoms[1] : bond.atoms[0];
    if (!allRingAtomIds.has(neighborId)) {
      continue;
    }
    const neighbor = coords.get(neighborId);
    if (!neighbor) {
      continue;
    }
    const angle = Math.atan2(neighbor.y - anchor.y, neighbor.x - anchor.x);
    if (!angles.some(existingAngle => cleanAngleDifference(existingAngle, angle) <= 1e-9)) {
      angles.push(angle);
    }
  }
  return angles;
}

function minimumAngleGap(angle, neighborAngles) {
  if (neighborAngles.length === 0) {
    return Math.PI;
  }
  return Math.min(...neighborAngles.map(neighborAngle => cleanAngleDifference(angle, neighborAngle)));
}

function bestCleanMultiRingExitAngle({ anchor, root, rootRadius, ringPolygons, ringNeighborAngles, referenceAngle, currentAngle }) {
  const currentInsideCount = countPointInPolygons(root, ringPolygons);
  const currentGap = minimumAngleGap(currentAngle, ringNeighborAngles);
  let best = null;
  for (const candidateAngle of candidateCleanExitAngles(referenceAngle)) {
    const probe = {
      x: anchor.x + rootRadius * Math.cos(candidateAngle),
      y: anchor.y + rootRadius * Math.sin(candidateAngle)
    };
    const insideCount = countPointInPolygons(probe, ringPolygons);
    const gap = minimumAngleGap(candidateAngle, ringNeighborAngles);
    const record = {
      angle: candidateAngle,
      insideCount,
      gap,
      referenceDelta: cleanAngleDifference(candidateAngle, referenceAngle),
      currentDelta: cleanAngleDifference(candidateAngle, currentAngle)
    };
    if (
      !best ||
      record.insideCount < best.insideCount ||
      (record.insideCount === best.insideCount && record.gap > best.gap + 1e-9) ||
      (record.insideCount === best.insideCount && Math.abs(record.gap - best.gap) <= 1e-9 && record.referenceDelta < best.referenceDelta - 1e-9) ||
      (record.insideCount === best.insideCount && Math.abs(record.gap - best.gap) <= 1e-9 && Math.abs(record.referenceDelta - best.referenceDelta) <= 1e-9 && record.currentDelta < best.currentDelta)
    ) {
      best = record;
    }
  }
  if (!best) {
    return null;
  }
  const improvesInside = best.insideCount < currentInsideCount;
  const improvesGap = best.gap > currentGap + 1e-9;
  if (best.insideCount > 0 || best.gap < CLEAN_MULTI_RING_EXIT_MIN_GAP - 1e-9 || (!improvesInside && !improvesGap)) {
    return null;
  }
  return best.angle;
}

function rotateCleanSubstituent(molecule, coords, anchorAtomId, movedAtomIds, delta) {
  if (Math.abs(delta) < CLEAN_RING_SUBSTITUENT_MIN_ANGLE_DELTA) {
    return 0;
  }
  const anchor = coords.get(anchorAtomId);
  if (!anchor) {
    return 0;
  }
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  let movedCount = 0;
  for (const atomId of movedAtomIds) {
    const position = coords.get(atomId);
    const atom = molecule.atoms.get(atomId);
    if (!position || !atom) {
      continue;
    }
    const dx = position.x - anchor.x;
    const dy = position.y - anchor.y;
    const x = anchor.x + dx * cos - dy * sin;
    const y = anchor.y + dx * sin + dy * cos;
    position.x = x;
    position.y = y;
    atom.x = x;
    atom.y = y;
    movedCount++;
  }
  return movedCount;
}

function repairCleanMultiRingSubstituentExits(molecule, referenceCoords) {
  if (!molecule?.atoms || !molecule?.bonds || typeof molecule.getRings !== 'function') {
    return 0;
  }
  const coords = visibleHeavyCoordsForMolecule(molecule);
  const rings = molecule.getRings();
  const allRingAtomIds = new Set(rings.flat());
  let movedCount = 0;

  for (const anchorAtomId of allRingAtomIds) {
    const anchor = coords.get(anchorAtomId);
    const incidentRings = rings.filter(ring => ring.includes(anchorAtomId) && ring.every(atomId => coords.has(atomId)));
    if (!anchor || incidentRings.length < 2) {
      continue;
    }
    const ringPolygons = incidentRings.map(ring => ring.map(atomId => coords.get(atomId)));
    const ringNeighborAngles = ringNeighborAnglesAtAnchor(molecule, coords, anchorAtomId, allRingAtomIds);
    if (ringNeighborAngles.length < 2) {
      continue;
    }

    for (const bond of molecule.bonds.values()) {
      if (!bond.atoms?.includes(anchorAtomId)) {
        continue;
      }
      const rootAtomId = bond.atoms[0] === anchorAtomId ? bond.atoms[1] : bond.atoms[0];
      if (allRingAtomIds.has(rootAtomId)) {
        continue;
      }
      const root = coords.get(rootAtomId);
      if (!root) {
        continue;
      }
      const currentAngle = Math.atan2(root.y - anchor.y, root.x - anchor.x);
      const rootInsideCount = countPointInPolygons(root, ringPolygons);
      const currentGap = minimumAngleGap(currentAngle, ringNeighborAngles);
      if (rootInsideCount === 0 && currentGap >= CLEAN_MULTI_RING_EXIT_MIN_GAP - 1e-9) {
        continue;
      }
      const movedAtomIds = collectMovableRingSubstituent(molecule, anchorAtomId, rootAtomId, allRingAtomIds);
      if (!movedAtomIds) {
        continue;
      }
      const referenceAnchor = referenceCoords?.get?.(anchorAtomId);
      const referenceRoot = referenceCoords?.get?.(rootAtomId);
      const referenceAngle =
        referenceAnchor && referenceRoot ? Math.atan2(referenceRoot.y - referenceAnchor.y, referenceRoot.x - referenceAnchor.x) : currentAngle;
      const rootRadius = Math.hypot(root.x - anchor.x, root.y - anchor.y);
      if (!(rootRadius > 0)) {
        continue;
      }
      const targetAngle = bestCleanMultiRingExitAngle({
        anchor,
        root,
        rootRadius,
        ringPolygons,
        ringNeighborAngles,
        referenceAngle,
        currentAngle
      });
      if (targetAngle == null) {
        continue;
      }
      movedCount += rotateCleanSubstituent(molecule, coords, anchorAtomId, movedAtomIds, targetAngle - currentAngle);
    }
  }

  return movedCount;
}

/**
 * Snaps single heavy substituent exits on regularized rings to the local
 * exterior bisector by rotating the substituent subtree around the ring atom.
 * @param {object} molecule - Molecule whose coordinates should be repaired.
 * @param {Map<string, {x: number, y: number}>} coords - Current heavy-atom coordinates.
 * @param {Array<string>} ring - Ring atom ids in perimeter order.
 * @param {Set<string>} allRingAtomIds - All ring atom ids in the molecule.
 * @param {object} hints - Accumulator with snapped atom/bond sets.
 * @returns {number} Number of substituent roots moved.
 */
function snapRingSubstituentAngles(molecule, coords, ring, allRingAtomIds, hints) {
  if (!molecule?.atoms || !molecule?.bonds || ring.length < 3) {
    return 0;
  }
  const ringAtomIds = new Set(ring);
  let cx = 0;
  let cy = 0;
  for (const atomId of ring) {
    const position = coords.get(atomId);
    if (!position) {
      return 0;
    }
    cx += position.x;
    cy += position.y;
  }
  cx /= ring.length;
  cy /= ring.length;

  let movedCount = 0;
  for (const anchorAtomId of ring) {
    const anchor = coords.get(anchorAtomId);
    if (!anchor) {
      continue;
    }
    const substituentIds = [];
    for (const bond of molecule.bonds.values()) {
      if (!bond.atoms?.includes(anchorAtomId)) {
        continue;
      }
      const neighborId = bond.atoms[0] === anchorAtomId ? bond.atoms[1] : bond.atoms[0];
      if (ringAtomIds.has(neighborId)) {
        continue;
      }
      if (allRingAtomIds.has(neighborId)) {
        continue;
      }
      const neighbor = molecule.atoms.get(neighborId);
      if (!neighbor || neighbor.name === 'H' || neighbor.visible === false || !coords.has(neighborId)) {
        continue;
      }
      substituentIds.push(neighborId);
    }
    if (substituentIds.length !== 1) {
      continue;
    }

    const rootAtomId = substituentIds[0];
    const root = coords.get(rootAtomId);
    const currentAngle = Math.atan2(root.y - anchor.y, root.x - anchor.x);
    const targetAngle = Math.atan2(anchor.y - cy, anchor.x - cx);
    const delta = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
    if (Math.abs(delta) < CLEAN_RING_SUBSTITUENT_MIN_ANGLE_DELTA) {
      continue;
    }
    const movedAtomIds = collectMovableRingSubstituent(molecule, anchorAtomId, rootAtomId, allRingAtomIds);
    if (!movedAtomIds) {
      continue;
    }
    const cos = Math.cos(delta);
    const sin = Math.sin(delta);
    for (const atomId of movedAtomIds) {
      const position = coords.get(atomId);
      const atom = molecule.atoms.get(atomId);
      if (!position || !atom) {
        continue;
      }
      const dx = position.x - anchor.x;
      const dy = position.y - anchor.y;
      const x = anchor.x + dx * cos - dy * sin;
      const y = anchor.y + dx * sin + dy * cos;
      position.x = x;
      position.y = y;
      atom.x = x;
      atom.y = y;
      hints.snappedAtoms.add(atomId);
    }
    hints.snappedAtoms.add(anchorAtomId);
    const anchorBond = bondBetween(molecule, anchorAtomId, rootAtomId);
    if (anchorBond?.id != null) {
      hints.snappedBonds.add(anchorBond.id);
    }
    movedCount++;
  }

  return movedCount;
}

function measureMedianHeavyBondLength(molecule, atomIdFilter = null) {
  if (!molecule?.atoms || !molecule?.bonds) {
    return 0;
  }
  const lengths = [];
  for (const bond of molecule.bonds.values()) {
    const [firstId, secondId] = bond.atoms ?? [];
    if (atomIdFilter && (!atomIdFilter.has(firstId) || !atomIdFilter.has(secondId))) {
      continue;
    }
    const firstAtom = molecule.atoms.get(firstId);
    const secondAtom = molecule.atoms.get(secondId);
    if (!firstAtom || !secondAtom || firstAtom.name === 'H' || secondAtom.name === 'H') {
      continue;
    }
    if (firstAtom.visible === false || secondAtom.visible === false) {
      continue;
    }
    if (!Number.isFinite(firstAtom.x) || !Number.isFinite(firstAtom.y) || !Number.isFinite(secondAtom.x) || !Number.isFinite(secondAtom.y)) {
      continue;
    }
    lengths.push(Math.hypot(firstAtom.x - secondAtom.x, firstAtom.y - secondAtom.y));
  }
  if (lengths.length === 0) {
    return 0;
  }
  lengths.sort((a, b) => a - b);
  const mid = Math.floor(lengths.length / 2);
  return lengths.length % 2 === 1 ? lengths[mid] : (lengths[mid - 1] + lengths[mid]) / 2;
}

function componentAtomIdsWithAttachedHydrogens(molecule, heavyAtomIds) {
  const atomIds = new Set(heavyAtomIds);
  const heavyAtomIdSet = new Set(heavyAtomIds);
  for (const bond of molecule?.bonds?.values?.() ?? []) {
    const [firstId, secondId] = bond.atoms ?? [];
    const firstAtom = molecule.atoms.get(firstId);
    const secondAtom = molecule.atoms.get(secondId);
    if (heavyAtomIdSet.has(firstId) && secondAtom?.name === 'H') {
      atomIds.add(secondId);
    }
    if (heavyAtomIdSet.has(secondId) && firstAtom?.name === 'H') {
      atomIds.add(firstId);
    }
  }
  return atomIds;
}

function scaleAtomIdsAroundCenter(molecule, atomIds, center, scale) {
  if (!center || Math.abs(scale - 1) < 0.05) {
    return;
  }
  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if (!atom || !Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    atom.x = center.x + (atom.x - center.x) * scale;
    atom.y = center.y + (atom.y - center.y) * scale;
  }
}

function normalizeCoordsToBondLength(molecule, bondLength) {
  const components = visibleHeavyComponents(molecule);
  if (components.length > 1) {
    for (const componentAtomIds of components) {
      const componentAtomIdSet = new Set(componentAtomIds);
      const medianBondLength = measureMedianHeavyBondLength(molecule, componentAtomIdSet);
      if (medianBondLength <= 0) {
        continue;
      }
      const scale = bondLength / medianBondLength;
      const center = finiteComponentCenter(molecule, componentAtomIds);
      scaleAtomIdsAroundCenter(molecule, componentAtomIdsWithAttachedHydrogens(molecule, componentAtomIds), center, scale);
    }
    return;
  }

  const medianBondLength = measureMedianHeavyBondLength(molecule);
  if (medianBondLength <= 0) {
    return;
  }
  const scale = bondLength / medianBondLength;
  if (Math.abs(scale - 1) < 0.05) {
    return;
  }
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const atom of molecule.atoms.values()) {
    if (atom.name === 'H' || atom.visible === false || !Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    cx += atom.x;
    cy += atom.y;
    count++;
  }
  if (count === 0) {
    return;
  }
  cx /= count;
  cy /= count;
  scaleAtomIdsAroundCenter(molecule, [...molecule.atoms.keys()], { x: cx, y: cy }, scale);
}

function snapCleanRingsToRegularGeometry(molecule, { bondLength = DEFAULT_LAYOUT_BOND_LENGTH } = {}) {
  const snappedAtoms = new Set();
  const snappedBonds = new Set();
  const targetSums = new Map();
  if (!molecule?.atoms || !molecule?.bonds || typeof molecule.getRings !== 'function') {
    return { snappedAtoms, snappedBonds, snappedCount: 0 };
  }

  const coords = new Map();
  for (const [atomId, atom] of molecule.atoms) {
    if (atom.name === 'H' || atom.visible === false || !Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    coords.set(atomId, { x: atom.x, y: atom.y });
  }

  const rings = molecule.getRings();
  const allRingAtomIds = new Set(rings.flat());

  for (const ring of rings) {
    if (ring.length < CLEAN_RING_SNAP_MIN_SIZE || ring.length > CLEAN_RING_SNAP_MAX_SIZE || !ring.every(atomId => coords.has(atomId))) {
      continue;
    }
    const targets = regularRingTargetsForCurrentPose(ring, coords, bondLength);
    if (targets.size !== ring.length) {
      continue;
    }

    let maxMove = 0;
    let moveSquared = 0;
    for (const atomId of ring) {
      const current = coords.get(atomId);
      const target = targets.get(atomId);
      const move = Math.hypot(target.x - current.x, target.y - current.y);
      maxMove = Math.max(maxMove, move);
      moveSquared += move * move;
    }
    const rmsMove = Math.sqrt(moveSquared / ring.length);
    if (
      maxMove < CLEAN_RING_SNAP_MIN_MOVE ||
      maxMove > bondLength * CLEAN_RING_SNAP_MAX_DISPLACEMENT_RATIO ||
      rmsMove > bondLength * CLEAN_RING_SNAP_RMS_DISPLACEMENT_RATIO
    ) {
      continue;
    }

    for (const atomId of ring) {
      const target = targets.get(atomId);
      const sum = targetSums.get(atomId) ?? { x: 0, y: 0, count: 0 };
      sum.x += target.x;
      sum.y += target.y;
      sum.count += 1;
      targetSums.set(atomId, sum);
      snappedAtoms.add(atomId);
    }
    for (const bondId of ringBondIds(molecule, ring)) {
      snappedBonds.add(bondId);
    }
  }

  for (const [atomId, sum] of targetSums) {
    const atom = molecule.atoms.get(atomId);
    if (!atom || sum.count === 0) {
      continue;
    }
    atom.x = sum.x / sum.count;
    atom.y = sum.y / sum.count;
    coords.set(atomId, { x: atom.x, y: atom.y });
  }

  let snappedSubstituentCount = 0;
  for (const ring of rings) {
    if (ring.length < CLEAN_RING_SNAP_MIN_SIZE || ring.length > CLEAN_RING_SNAP_MAX_SIZE || !ring.every(atomId => coords.has(atomId))) {
      continue;
    }
    snappedSubstituentCount += snapRingSubstituentAngles(molecule, coords, ring, allRingAtomIds, {
      snappedAtoms,
      snappedBonds
    });
  }

  if (snappedAtoms.size > 0) {
    for (const atomId of [...snappedAtoms]) {
      addTouchedHeavyNeighborhood(molecule, molecule.atoms.get(atomId), snappedAtoms, snappedBonds, 1);
    }
  }

  return { snappedAtoms, snappedBonds, snappedCount: targetSums.size + snappedSubstituentCount };
}

function hasCleanableRings(molecule) {
  if (typeof molecule?.getRings !== 'function') {
    return false;
  }
  return molecule.getRings().some(ring => ring.length >= CLEAN_RING_SNAP_MIN_SIZE && ring.length <= CLEAN_RING_SNAP_MAX_SIZE);
}

function forcePatchEntryForNode(node) {
  const entry = { x: node.x, y: node.y };
  if (node.forcePlacementParentId != null) {
    entry.forcePlacementParentId = node.forcePlacementParentId;
  }
  if (Number.isFinite(node.forcePlacementAngle)) {
    entry.forcePlacementAngle = node.forcePlacementAngle;
  }
  return entry;
}

function isActiveForceResonancePair(context, mol = context.state.documentState.getCurrentMol?.()) {
  return context.overlays?.hasActiveResonanceView?.() === true && mol?.__reactionPreview?.resonancePair === true;
}

function isActiveForcePreviewComplex(context, mol = context.state.documentState.getCurrentMol?.()) {
  return context.overlays?.hasReactionPreview?.() === true || isActiveForceResonancePair(context, mol);
}

function lineRotateFitTransform(context, bbox) {
  if (!bbox || !Number.isFinite(bbox.minX) || !Number.isFinite(bbox.maxX) || !Number.isFinite(bbox.minY) || !Number.isFinite(bbox.maxY)) {
    return null;
  }
  const width = context.dom.plotEl?.clientWidth || 600;
  const height = context.dom.plotEl?.clientHeight || 400;
  const pad = context.force?.fitPad ?? ROTATE_FIT_FALLBACK_PAD;
  const pads = context.overlays.viewportFitPadding?.(pad) ?? { left: pad, right: pad, top: pad, bottom: pad };
  const horizontalPad = Math.max(pad, (pads.left + pads.right) / 2);
  const verticalPad = Math.max(pad, (pads.top + pads.bottom) / 2);
  const molSVGW = (bbox.maxX - bbox.minX) * context.view.scale || 1;
  const molSVGH = (bbox.maxY - bbox.minY) * context.view.scale || 1;
  const fitWidth = Math.max(1, width - horizontalPad * 2);
  const fitHeight = Math.max(1, height - verticalPad * 2);
  const exactFitScale = Math.min(fitWidth / molSVGW, fitHeight / molSVGH, ROTATE_FIT_MAX_SCALE);
  const scaleMultiplier = context.force?.initialZoomMultiplier ?? ROTATE_FIT_ZOOM_MULTIPLIER;
  const scale = exactFitScale < 1 ? exactFitScale : Math.min(scaleMultiplier, exactFitScale, ROTATE_FIT_MAX_SCALE);
  return context.view.makeZoomIdentity?.(width / 2 - (width / 2) * scale, height / 2 - (height / 2) * scale, scale) ?? {
    x: width / 2 - (width / 2) * scale,
    y: height / 2 - (height / 2) * scale,
    k: scale
  };
}

function applyZoomTransform(transform, point) {
  if (!point) {
    return null;
  }
  if (typeof transform?.applyX === 'function' && typeof transform?.applyY === 'function') {
    return {
      x: transform.applyX(point.x),
      y: transform.applyY(point.y)
    };
  }
  const k = Number.isFinite(Number(transform?.k)) ? Number(transform.k) : 1;
  const x = Number.isFinite(Number(transform?.x)) ? Number(transform.x) : 0;
  const y = Number.isFinite(Number(transform?.y)) ? Number(transform.y) : 0;
  return {
    x: point.x * k + x,
    y: point.y * k + y
  };
}

function pointOutsidePlot(context, point, pad = 0) {
  if (!point) {
    return false;
  }
  const width = context.dom?.plotEl?.clientWidth || 600;
  const height = context.dom?.plotEl?.clientHeight || 400;
  return point.x < pad || point.x > width - pad || point.y < pad || point.y > height - pad;
}

function anyRotated2dAtomOutsideView(context, atoms) {
  const transform = context.view?.getZoomTransform?.() ?? null;
  const scale = Number.isFinite(Number(context.view?.scale)) ? Number(context.view.scale) : 40;
  return atoms.some(atom => {
    const rendered = {
      x: (context.dom?.plotEl?.clientWidth || 600) / 2 + (atom.x - (context.state.viewState.getCx2d?.() ?? 0)) * scale,
      y: (context.dom?.plotEl?.clientHeight || 400) / 2 - (atom.y - (context.state.viewState.getCy2d?.() ?? 0)) * scale
    };
    return pointOutsidePlot(context, applyZoomTransform(transform, rendered));
  });
}

function fit2dViewportLikeAutoZoom(context, atoms) {
  if (context.view.fitCurrent2dView) {
    context.view.fitCurrent2dView();
    return;
  }
  if (!atoms?.length) {
    return;
  }
  const bbox = context.helpers.atomBBox(atoms);
  context.state.viewState.setCx2d?.(bbox.cx);
  context.state.viewState.setCy2d?.(bbox.cy);
  const fitTransform = lineRotateFitTransform(context, bbox);
  if (fitTransform) {
    context.view.setZoomTransform(fitTransform);
  }
}

function fit2dViewportAfterRotationIfNeeded(context, atoms) {
  if (!atoms?.length || !anyRotated2dAtomOutsideView(context, atoms)) {
    return false;
  }
  if (context.view?.zoomToFitIf2d) {
    context.view.zoomToFitIf2d({ pad: context.force?.fitPad ?? ROTATE_FIT_FALLBACK_PAD });
    return true;
  }
  fit2dViewportLikeAutoZoom(context, atoms);
  return true;
}

function anyForceNodeOutsideView(context, nodes) {
  const transform = context.view?.getZoomTransform?.() ?? null;
  const scale = Number.isFinite(Number(transform?.k)) ? Number(transform.k) : 1;
  return nodes.some(node => {
    const radius = atomRadius(node.protons ?? null) * Math.max(1, scale);
    return pointOutsidePlot(context, applyZoomTransform(transform, { x: node.x, y: node.y }), radius);
  });
}

function fitForceViewportAfterRotationIfNeeded(context, nodes, mol) {
  if (!nodes?.length || !anyForceNodeOutsideView(context, nodes)) {
    return false;
  }
  const currentTransform = context.view.getZoomTransform();
  const isPreviewComplex = isActiveForcePreviewComplex(context, mol);
  const fitTransform = context.force.forceFitTransform(nodes, isPreviewComplex ? (context.force.initialFitPad ?? FORCE_LAYOUT_INITIAL_FIT_PAD) : context.force.fitPad, {
    scaleMultiplier: isPreviewComplex ? (context.force.initialZoomMultiplier ?? FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER) : context.force.initialZoomMultiplier,
    ...(isPreviewComplex ? { reactionLike: true } : {})
  });
  if (fitTransform && context.force.zoomTransformsDiffer(fitTransform, currentTransform)) {
    context.view.setZoomTransform(fitTransform);
    return true;
  }
  return false;
}

/**
 * Detects obviously distorted local bonds so clean actions can relayout just
 * the damaged patch instead of preserving the entire existing component
 * geometry. Ring scaffolds often contain intentionally shortened projected
 * bonds, and macrocycle projections may relax aryl-adjacent ring bonds, so
 * compressed-bond detection is limited to non-ring bonds while overstretch
 * detection skips aryl-adjacent ring bonds.
 * @param {object} molecule - Molecule whose current placed coordinates are inspected.
 * @param {object} [options] - Detection options.
 * @param {number} [options.bondLength] - Expected bond length for the active 2D layout.
 * @param {number} [options.tolerance] - Relative bond-length deviation threshold.
 * @returns {{touchedAtoms: Set<string>, touchedBonds: Set<string>}} Refinement hints.
 */
function derive2dCleanRefinementHints(molecule, { bondLength = DEFAULT_LAYOUT_BOND_LENGTH, tolerance = CLEAN_2D_BOND_LENGTH_TOLERANCE } = {}) {
  const touchedAtoms = new Set();
  const touchedBonds = new Set();
  if (!molecule?.atoms || !molecule?.bonds) {
    return { touchedAtoms, touchedBonds };
  }

  const maxDeviation = bondLength * tolerance;
  for (const bond of molecule.bonds.values()) {
    const [firstId, secondId] = bond.atoms ?? [];
    const firstAtom = molecule.atoms.get(firstId);
    const secondAtom = molecule.atoms.get(secondId);
    if (!firstAtom || !secondAtom) {
      continue;
    }
    if (firstAtom.name === 'H' || secondAtom.name === 'H') {
      continue;
    }
    if (firstAtom.visible === false || secondAtom.visible === false) {
      continue;
    }
    if (!Number.isFinite(firstAtom.x) || !Number.isFinite(firstAtom.y) || !Number.isFinite(secondAtom.x) || !Number.isFinite(secondAtom.y)) {
      continue;
    }
    const length = Math.hypot(firstAtom.x - secondAtom.x, firstAtom.y - secondAtom.y);
    const bondIsInRing = typeof bond.isInRing === 'function' ? bond.isInRing(molecule) : false;
    const isArylAdjacentRingBond = bondIsInRing && (firstAtom.properties?.aromatic === true || secondAtom.properties?.aromatic === true);
    const isOverstretched = length > bondLength + maxDeviation && !isArylAdjacentRingBond;
    const isCompressedNonRing = !bondIsInRing && length < bondLength - maxDeviation;
    if (!Number.isFinite(length) || (!isOverstretched && !isCompressedNonRing)) {
      continue;
    }
    touchedBonds.add(bond.id);
    addTouchedHeavyNeighborhood(molecule, firstAtom, touchedAtoms, touchedBonds);
    addTouchedHeavyNeighborhood(molecule, secondAtom, touchedAtoms, touchedBonds);
  }

  return { touchedAtoms, touchedBonds };
}

/**
 * Re-applies reaction-preview pair orientation after a force-clean refinement.
 * Force mode seeds from live node positions, so without this pass a cleaned
 * reaction preview can keep or amplify a mirrored component arrangement instead
 * of returning to the canonical reactant-left/product-right layout.
 * @param {object} molecule - Working molecule clone being cleaned.
 * @param {object} overlays - Overlay helpers that know how to arrange previews.
 * @param {number} [bondLength] - Target layout bond length for reaction geometry.
 * @returns {void}
 */
function reapplyReactionPreviewForceLayout(molecule, overlays, bondLength = DEFAULT_LAYOUT_BOND_LENGTH) {
  if (!molecule?.__reactionPreview?.mappedAtomPairs?.length || !overlays) {
    return;
  }
  overlays.alignReaction2dProductOrientation?.(molecule, bondLength);
  overlays.spreadReaction2dProductComponents?.(molecule, bondLength);
  overlays.centerReaction2dPairCoords?.(molecule, bondLength);
}

/**
 * Creates navigation action handlers for mode toggling, layout cleaning, rotation, and flipping in both 2D and force-layout modes.
 * @param {object} context - Dependency context providing state, history, view, renderers, dom, simulation, force, helpers, overlays, parsers, and actions.
 * @returns {object} Object with `cleanLayout2d`, `cleanLayoutForce`, `toggleMode`, `startRotate`, `stopRotate`, and `flip`.
 */
export function createNavigationActions(context) {
  let rotateInterval = null;
  let pendingRotateFit = null;
  let clean2dBtnTimer = null;
  let cleanForceBtnTimer = null;

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function transformSelectionPivot(transform) {
    const pivot = context.state.overlayState?.getSelectionPivot?.() ?? null;
    const pivotX = finiteNumber(pivot?.x);
    const pivotY = finiteNumber(pivot?.y);
    if (pivotX == null || pivotY == null) {
      return;
    }
    context.state.overlayState?.setSelectionPivot?.(transform({ x: pivotX, y: pivotY }));
  }

  function mirrorSelectionPivot(axis, center) {
    transformSelectionPivot(pivot =>
      axis === 'h'
        ? {
            x: 2 * center.x - pivot.x,
            y: pivot.y
          }
        : {
            x: pivot.x,
            y: 2 * center.y - pivot.y
          }
    );
  }

  function currentSelectionPivot() {
    const pivot = context.state.overlayState?.getSelectionPivot?.() ?? null;
    const x = finiteNumber(pivot?.x);
    const y = finiteNumber(pivot?.y);
    return x == null || y == null ? null : { x, y };
  }

  function selectedAtomIds() {
    return context.state.overlayState?.getSelectedAtomIds?.() ?? new Set();
  }

  function selectionPivotAnchorFromPoints(points) {
    const pivot = currentSelectionPivot();
    if (!pivot) {
      return null;
    }
    let best = null;
    for (const point of points) {
      const x = finiteNumber(point?.x);
      const y = finiteNumber(point?.y);
      if (x == null || y == null) {
        continue;
      }
      const distance = Math.hypot(x - pivot.x, y - pivot.y);
      if (distance <= SELECTION_PIVOT_ATOM_SNAP_RADIUS && (!best || distance < best.distance)) {
        best = { atomId: point.atomId, distance };
      }
    }
    return best?.atomId ?? null;
  }

  function forceSelectionPivotAnchor(nodes) {
    const selectedIds = selectedAtomIds();
    if (!selectedIds.size) {
      return null;
    }
    return selectionPivotAnchorFromPoints(
      nodes
        .filter(node => selectedIds.has(node.id))
        .map(node => ({
          atomId: node.id,
          x: node.x,
          y: node.y
        }))
    );
  }

  function rendered2dPointForMolPoint(point) {
    const plot = context.dom?.plotEl ?? {};
    const width = finiteNumber(plot.clientWidth) ?? 600;
    const height = finiteNumber(plot.clientHeight) ?? 400;
    const centerX = finiteNumber(context.state.viewState.getCx2d?.()) ?? 0;
    const centerY = finiteNumber(context.state.viewState.getCy2d?.()) ?? 0;
    const scale = finiteNumber(context.view?.scale) ?? 40;
    return {
      x: width / 2 + (point.x - centerX) * scale,
      y: height / 2 - (point.y - centerY) * scale
    };
  }

  function molPointForRendered2dPoint(point) {
    if (!point) {
      return null;
    }
    const plot = context.dom?.plotEl ?? {};
    const width = finiteNumber(plot.clientWidth) ?? 600;
    const height = finiteNumber(plot.clientHeight) ?? 400;
    const centerX = finiteNumber(context.state.viewState.getCx2d?.()) ?? 0;
    const centerY = finiteNumber(context.state.viewState.getCy2d?.()) ?? 0;
    const scale = finiteNumber(context.view?.scale) ?? 40;
    if (!scale) {
      return null;
    }
    return {
      x: centerX + (point.x - width / 2) / scale,
      y: centerY - (point.y - height / 2) / scale
    };
  }

  function currentPlotSize() {
    const plot = context.dom?.plotEl ?? {};
    return {
      width: finiteNumber(plot.clientWidth) ?? 600,
      height: finiteNumber(plot.clientHeight) ?? 400
    };
  }

  function currentZoomTransform() {
    const transform = context.view?.getZoomTransform?.() ?? {};
    return {
      x: finiteNumber(transform.x) ?? 0,
      y: finiteNumber(transform.y) ?? 0,
      k: finiteNumber(transform.k) ?? 1
    };
  }

  function preTransformViewportCenter(transform) {
    const { width, height } = currentPlotSize();
    const k = finiteNumber(transform?.k) ?? 1;
    if (!k) {
      return { x: width / 2, y: height / 2 };
    }
    return {
      x: (width / 2 - (finiteNumber(transform?.x) ?? 0)) / k,
      y: (height / 2 - (finiteNumber(transform?.y) ?? 0)) / k
    };
  }

  function forcePointFromLinePoint(point, converted) {
    if (!point || !converted || !(converted.scale > 0)) {
      return converted?.forceCenter ?? { x: 0, y: 0 };
    }
    return {
      x: converted.forceCenter.x + (point.x - converted.lineCenter.x) * converted.scale,
      y: converted.forceCenter.y - (point.y - converted.lineCenter.y) * converted.scale
    };
  }

  function linePointFromForcePoint(point, converted) {
    if (!point || !converted || !(converted.scale > 0)) {
      return converted?.lineCenter ?? { x: 0, y: 0 };
    }
    return {
      x: converted.lineCenter.x + (point.x - converted.forceCenter.x) * converted.scale,
      y: converted.lineCenter.y - (point.y - converted.forceCenter.y) * converted.scale
    };
  }

  function equivalentModeSwitchTransform({ sourceTransform, targetCenterPoint, sourcePixelsPerUnit, targetPixelsPerUnit }) {
    const sourceK = finiteNumber(sourceTransform?.k) ?? 1;
    const { width, height } = currentPlotSize();
    const sourceScreenCenter = { x: width / 2, y: height / 2 };
    const scaleRatio = targetPixelsPerUnit > 0 ? sourcePixelsPerUnit / targetPixelsPerUnit : 1;
    const nextK = sourceK * scaleRatio;
    const nextX = sourceScreenCenter.x - nextK * targetCenterPoint.x;
    const nextY = sourceScreenCenter.y - nextK * targetCenterPoint.y;
    return context.view.makeZoomIdentity?.(nextX, nextY, nextK) ?? { x: nextX, y: nextY, k: nextK };
  }

  function twoDRenderedPointForLinePoint(point) {
    return rendered2dPointForMolPoint(point);
  }

  function applyEquivalentModeSwitchTransform(args) {
    const transform = equivalentModeSwitchTransform(args);
    context.view.setZoomTransform?.(transform);
    return transform;
  }

  function renderedDomHeavyCenterLocal(mol, selector) {
    const plotRect = context.dom?.plotEl?.getBoundingClientRect?.() ?? null;
    if (!plotRect) {
      return null;
    }
    const points = [];
    for (const element of context.dom.plotEl.querySelectorAll?.(selector) ?? []) {
      const atomId = element.closest?.('g[data-atom-id]')?.dataset?.atomId;
      const atom = atomId ? mol?.atoms?.get?.(atomId) : null;
      if (atom?.name === 'H' || atom?.visible === false) {
        continue;
      }
      const rect = element.getBoundingClientRect?.();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
        continue;
      }
      points.push({
        x: rect.left + rect.width / 2 - plotRect.left,
        y: rect.top + rect.height / 2 - plotRect.top
      });
    }
    if (points.length === 0) {
      return null;
    }
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    };
  }

  function renderedForceHeavyCenterLocal() {
    const transform = currentZoomTransform();
    const nodes = context.simulation?.nodes?.() ?? [];
    const points = nodes
      .filter(node => node?.name !== 'H' && Number.isFinite(node?.x) && Number.isFinite(node?.y))
      .map(node => ({
        x: transform.x + transform.k * node.x,
        y: transform.y + transform.k * node.y
      }));
    if (points.length === 0) {
      return null;
    }
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    };
  }

  function renderedModeHeavyCenterLocal(mode, mol) {
    return mode === 'force' ? renderedForceHeavyCenterLocal() : renderedDomHeavyCenterLocal(mol, 'g[data-atom-id] .atom-hit');
  }

  function nudgeModeSwitchTransformToRenderedCenter(sourceCenter, targetMode, targetMol) {
    if (!sourceCenter) {
      return false;
    }
    const targetCenter = renderedModeHeavyCenterLocal(targetMode, targetMol);
    if (!targetCenter) {
      return false;
    }
    const dx = sourceCenter.x - targetCenter.x;
    const dy = sourceCenter.y - targetCenter.y;
    if (Math.hypot(dx, dy) <= 0.1) {
      return false;
    }
    const transform = currentZoomTransform();
    context.view.setZoomTransform?.(context.view.makeZoomIdentity?.(transform.x + dx, transform.y + dy, transform.k) ?? { x: transform.x + dx, y: transform.y + dy, k: transform.k });
    return true;
  }

  function twoDSelectionPivotAnchor(mol) {
    const selectedIds = selectedAtomIds();
    if (!selectedIds.size) {
      return null;
    }
    const points = [];
    for (const atomId of selectedIds) {
      const atom = mol?.atoms?.get?.(atomId);
      if (!atom) {
        continue;
      }
      const point = rendered2dPointForMolPoint(atom);
      points.push({
        atomId,
        x: point.x,
        y: point.y
      });
    }
    return selectionPivotAnchorFromPoints(points);
  }

  function currentLayoutBondLength() {
    return context.helpers?.getLayoutBondLength?.() ?? DEFAULT_LAYOUT_BOND_LENGTH;
  }

  function defaultForceAutoFitScaleMultiplier() {
    const linePixelsPerUnit = finiteNumber(context.view?.scale);
    if (linePixelsPerUnit == null) {
      return context.force?.initialZoomMultiplier ?? FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER;
    }
    return linePixelsPerUnit * DEFAULT_LAYOUT_BOND_LENGTH / FORCE_LAYOUT_BOND_LENGTH;
  }

  function stopRotate() {
    if (rotateInterval !== null) {
      clearInterval(rotateInterval);
      rotateInterval = null;
    }
    if (!pendingRotateFit) {
      return;
    }
    const pending = pendingRotateFit;
    pendingRotateFit = null;
    if (pending.mode === 'force') {
      fitForceViewportAfterRotationIfNeeded(context, pending.nodes, pending.mol);
    } else if (pending.mode === '2d') {
      fit2dViewportAfterRotationIfNeeded(context, pending.atoms);
    }
  }

  function cleanLayout2d() {
    if (context.state.viewState.getMode() !== '2d' || !context.state.documentState.getMol2d()) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });
    const mol = context.state.documentState.getMol2d();
    const relayoutMol = mol.clone();
    preserveReactionPreviewMetadata(mol, relayoutMol);
    resetDisplayedStereoHydrogenCoords(relayoutMol);
    const cleanReferenceCoords = captureFiniteAtomCoords(relayoutMol);
    const bondLength = currentLayoutBondLength();
    normalizeCoordsToBondLength(relayoutMol, bondLength);
    const ringSnapHints = snapCleanRingsToRegularGeometry(relayoutMol, {
      bondLength
    });
    const freezeCleanRings = hasCleanableRings(relayoutMol);
    const hasRefinementRelayout = typeof context.helpers?.refineExistingCoords === 'function';
    const refinementHints = derive2dCleanRefinementHints(relayoutMol, {
      bondLength
    });
    for (const atomId of ringSnapHints.snappedAtoms) {
      refinementHints.touchedAtoms.add(atomId);
    }
    for (const bondId of ringSnapHints.snappedBonds) {
      refinementHints.touchedBonds.add(bondId);
    }
    const refinedCoords = hasRefinementRelayout
      ? context.helpers.refineExistingCoords(relayoutMol, {
          suppressH: true,
          bondLength,
          maxPasses: 6,
          ...(freezeCleanRings ? { freezeRings: true } : {}),
          preserveStereoDisplay: true,
          hiddenHydrogenMode: 'inherit',
          touchedAtoms: refinementHints.touchedAtoms,
          touchedBonds: refinementHints.touchedBonds
        })
      : null;
    if (refinedCoords instanceof Map) {
      normalizeCoordsToBondLength(relayoutMol, bondLength);
      snapCleanRingsToRegularGeometry(relayoutMol, {
        bondLength
      });
    }
    const multiRingExitRepairCount = repairCleanMultiRingSubstituentExits(relayoutMol, cleanReferenceCoords);
    resetDisplayedStereoHydrogenCoords(relayoutMol);
    const preserveGeometry = ringSnapHints.snappedCount > 0 || multiRingExitRepairCount > 0 || (refinedCoords instanceof Map ? refinedCoords.size > 0 : hasRefinementRelayout);
    context.view.setPreserveSelectionOnNextRender(true);
    context.renderers.renderMol(relayoutMol, {
      preserveHistory: true,
      preserveAnalysis: true,
      preserveGeometry
    });
    const btn = context.dom.clean2dButton;
    if (btn) {
      btn.textContent = '✓';
      clearTimeout(clean2dBtnTimer);
      clean2dBtnTimer = setTimeout(() => {
        btn.textContent = '🧹';
      }, 1500);
    }
  }

  function cleanLayoutForce() {
    if (context.state.viewState.getMode() !== 'force' || !context.state.documentState.getCurrentMol()) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });
    const mol = context.state.documentState.getCurrentMol();
    const relayoutMol = mol.clone();
    preserveReactionPreviewMetadata(mol, relayoutMol);
    const bondLength = currentLayoutBondLength();
    const shouldFreshCleanDisconnectedComponents =
      !relayoutMol.__reactionPreview && hasDisconnectedVisibleHeavyComponents(relayoutMol) && typeof context.helpers?.generate2dCoords === 'function';
    let cleanReferenceCoords = new Map();
    if (shouldFreshCleanDisconnectedComponents) {
      seedMoleculeFromForcePositions(relayoutMol, context.simulation.nodes?.(), bondLength);
      const componentCenters = captureVisibleHeavyComponentCenters(relayoutMol);
      context.helpers.generate2dCoords(relayoutMol, {
        suppressH: true,
        bondLength,
        maxPasses: 6,
        preserveStereoDisplay: true
      });
      normalizeCoordsToBondLength(relayoutMol, bondLength);
      snapCleanRingsToRegularGeometry(relayoutMol, {
        bondLength
      });
      restoreComponentCenters(relayoutMol, componentCenters);
    } else {
      seedMoleculeFromForcePositions(relayoutMol, context.simulation.nodes?.(), bondLength);
      cleanReferenceCoords = captureFiniteAtomCoords(relayoutMol);
      normalizeCoordsToBondLength(relayoutMol, bondLength);
      const ringSnapHints = snapCleanRingsToRegularGeometry(relayoutMol, {
        bondLength
      });
      const freezeCleanRings = hasCleanableRings(relayoutMol);
      const refinementHints = derive2dCleanRefinementHints(relayoutMol, {
        bondLength
      });
      for (const atomId of ringSnapHints.snappedAtoms) {
        refinementHints.touchedAtoms.add(atomId);
      }
      for (const bondId of ringSnapHints.snappedBonds) {
        refinementHints.touchedBonds.add(bondId);
      }
      if (typeof context.helpers?.refineExistingCoords === 'function') {
        context.helpers.refineExistingCoords(relayoutMol, {
          suppressH: true,
          bondLength,
          maxPasses: 6,
          ...(freezeCleanRings ? { freezeRings: true } : {}),
          preserveStereoDisplay: true,
          hiddenHydrogenMode: 'inherit',
          touchedAtoms: refinementHints.touchedAtoms,
          touchedBonds: refinementHints.touchedBonds
        });
        normalizeCoordsToBondLength(relayoutMol, bondLength);
        snapCleanRingsToRegularGeometry(relayoutMol, {
          bondLength
        });
      }
      repairCleanMultiRingSubstituentExits(relayoutMol, cleanReferenceCoords);
    }
    reapplyReactionPreviewForceLayout(relayoutMol, context.overlays, bondLength);
    resetDisplayedStereoHydrogenCoords(relayoutMol);
    const forceAnchorLayout = buildForceAnchorLayoutFromPlacedCoords(relayoutMol);
    context.view.setPreserveSelectionOnNextRender(true);
    context.renderers.renderMol(relayoutMol, {
      preserveHistory: true,
      preserveAnalysis: true,
      preserveView: false,
      forceAnchorLayout: forceAnchorLayout.size > 0 ? forceAnchorLayout : null,
      forceRestartSimulation: false,
      forceSettleInitialLayout: false
    });
    const btn = context.dom.cleanForceButton;
    if (btn) {
      btn.textContent = '✓';
      clearTimeout(cleanForceBtnTimer);
      cleanForceBtnTimer = setTimeout(() => {
        btn.textContent = '🧹';
      }, 1500);
    }
  }

  function toggleMode() {
    context.view.clearPrimitiveHover();
    const previousMode = context.state.viewState.getMode();
    const currentMol = context.state.documentState.getCurrentMol();
    const currentSmiles = context.state.documentState.getCurrentSmiles();
    const currentInchi = context.state.documentState.getCurrentInchi();
    if (!currentMol && !currentSmiles && !currentInchi) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });

    const displayedMol = previousMode === 'force' ? context.state.documentState.getCurrentMol() : context.state.documentState.getMol2d();
    const sourceRenderedCenter = renderedModeHeavyCenterLocal(previousMode, displayedMol);
    const activeResonanceView = context.overlays.hasActiveResonanceView?.() === true;
    const resonanceSourceMol = context.overlays.getActiveResonanceSourceMolecule?.(displayedMol) ?? displayedMol;
    const modeSwitchMol = activeResonanceView ? displayedMol : resonanceSourceMol;
    const hadReactionPreview = context.overlays.hasReactionPreview();
    const nextMode = previousMode === 'force' ? '2d' : 'force';
    context.state.viewState.setMode(nextMode);
    context.dom.updateModeChrome(nextMode);

    if (!hadReactionPreview && !activeResonanceView) {
      context.overlays.resetActiveResonanceView(resonanceSourceMol);
    }
    context.simulation.stop();
    context.state.viewState.setRotationDeg(0);
    context.state.viewState.setFlipH(false);
    context.state.viewState.setFlipV(false);
    context.view.setPreserveSelectionOnNextRender(true);

    if (hadReactionPreview && context.overlays.reapplyActiveReactionPreview()) {
      context.view.setPreserveSelectionOnNextRender(false);
      return;
    }

    const mol = modeSwitchMol ? modeSwitchMol.clone() : currentInchi ? context.parsers.parseINCHI(currentInchi) : context.parsers.parseSMILES(currentSmiles);
    preserveReactionPreviewMetadata(modeSwitchMol, mol);
    const bondLength = currentLayoutBondLength();
    const sourceTransform = currentZoomTransform();
    const linePixelsPerUnit = finiteNumber(context.view?.scale) ?? 40;
    if (previousMode === 'force') {
      const converted = convertForceCoordsToLineLayout(mol, context.simulation.nodes?.(), {
        bondLength,
        forceBondLength: FORCE_LAYOUT_BOND_LENGTH * (bondLength / DEFAULT_LAYOUT_BOND_LENGTH),
        coordinateSource: 'anchor'
      });
      const sourceViewportPoint = preTransformViewportCenter(sourceTransform);
      const lineViewportPoint = linePointFromForcePoint(sourceViewportPoint, converted);
      const appliedCount = applyLineLayoutCoords(mol, converted.coords);
      const shouldSnapConvertedRings = !converted.usedCompleteHeavyAnchors;
      const preSnapLineCoords = shouldSnapConvertedRings ? captureFiniteAtomCoords(mol) : new Map();
      const ringSnapHints = shouldSnapConvertedRings
        ? snapCleanRingsToRegularGeometry(mol, {
            bondLength
          })
        : { snappedAtoms: new Set(), snappedBonds: new Set(), snappedCount: 0 };
      const reanchoredStereoCount = shouldSnapConvertedRings ? reanchorStereoTerminalsToCenters(mol, preSnapLineCoords) : 0;
      context.renderers.renderMol(mol, {
        preserveHistory: true,
        preserveGeometry: appliedCount > 0 || ringSnapHints.snappedCount > 0 || reanchoredStereoCount > 0,
        ...(activeResonanceView
          ? {
              recomputeResonance: false,
              refreshResonancePanel: false,
              preserveAnalysis: true
            }
          : {})
      });
      applyEquivalentModeSwitchTransform({
        sourceTransform,
        sourcePixelsPerUnit: converted.scale > 0 ? 1 / converted.scale : FORCE_LAYOUT_BOND_LENGTH / DEFAULT_LAYOUT_BOND_LENGTH,
        targetCenterPoint: twoDRenderedPointForLinePoint(lineViewportPoint),
        targetPixelsPerUnit: linePixelsPerUnit
      });
      nudgeModeSwitchTransformToRenderedCenter(sourceRenderedCenter, nextMode, mol);
      context.actions?.syncPastePreviewToMode?.();
      return;
    }

    const { width: plotWidth, height: plotHeight } = currentPlotSize();
    const lineViewportPoint = molPointForRendered2dPoint(preTransformViewportCenter(sourceTransform));
    const converted = convertLineCoordsToForceLayout(mol, {
      bondLength,
      forceCenter: { x: plotWidth / 2, y: plotHeight / 2 }
    });
    expandForceSelectionHydrogensForSelectedLabels(mol, context.state.overlayState?.getSelectedAtomIds?.());
    context.renderers.renderMol(mol, {
      preserveHistory: true,
      ...(activeResonanceView
        ? {
            recomputeResonance: false,
            refreshResonancePanel: false,
            preserveAnalysis: true
          }
        : {}),
      forceAnchorLayout: converted.lineAnchorCoords.size > 0 ? converted.lineAnchorCoords : null,
      forceInitialPatchPos: converted.coords.size > 0 ? converted.coords : null,
      preserveView: true,
      forceRestartSimulation: false,
      forceSettleInitialLayout: false
    });
    applyEquivalentModeSwitchTransform({
      sourceTransform,
      sourcePixelsPerUnit: linePixelsPerUnit,
      targetCenterPoint: forcePointFromLinePoint(lineViewportPoint, converted),
      targetPixelsPerUnit: converted.scale,
    });
    nudgeModeSwitchTransformToRenderedCenter(sourceRenderedCenter, nextMode, mol);
    context.actions?.syncPastePreviewToMode?.();
  }

  function autoZoom() {
    const mode = context.state.viewState.getMode();
    if (mode === 'force') {
      const nodes = context.simulation.nodes?.().filter(node => Number.isFinite(node.x) && Number.isFinite(node.y)) ?? [];
      if (!nodes.length) {
        return;
      }
      const isPreviewComplex = isActiveForcePreviewComplex(context);
      const fitTransform = context.force.forceFitTransform(nodes, context.force.initialFitPad ?? FORCE_LAYOUT_INITIAL_FIT_PAD, {
        hydrogenRadiusScale: FORCE_LAYOUT_INITIAL_H_RADIUS_SCALE,
        scaleMultiplier: isPreviewComplex ? (context.force.initialZoomMultiplier ?? FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER) : defaultForceAutoFitScaleMultiplier(),
        ...(isPreviewComplex ? { reactionLike: true } : {})
      });
      if (fitTransform) {
        context.view.setZoomTransform(fitTransform);
      }
      return;
    }

    const mol = context.state.documentState.getMol2d();
    if (mode !== '2d' || !mol) {
      return;
    }
    if (context.view.fitCurrent2dView) {
      context.view.fitCurrent2dView();
      return;
    }
    const atoms = [...mol.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
    if (!atoms.length) {
      return;
    }
    const bbox = context.helpers.atomBBox(atoms);
    context.state.viewState.setCx2d?.(bbox.cx);
    context.state.viewState.setCy2d?.(bbox.cy);
    fit2dViewportLikeAutoZoom(context, atoms);
  }

  function startRotate(delta) {
    stopRotate();
    const mode = context.state.viewState.getMode();
    if (mode === 'force') {
      const mol = context.state.documentState.getCurrentMol();
      if (!mol) {
        return;
      }
      context.history.takeSnapshot({ clearReactionPreview: false });
      const forceDelta = -delta;
      const step = () => {
        const nodes = context.simulation.nodes().filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
        if (!nodes.length) {
          return;
        }
        let cx = 0;
        let cy = 0;
        for (const node of nodes) {
          cx += node.x;
          cy += node.y;
        }
        cx /= nodes.length;
        cy /= nodes.length;
        const rad = (forceDelta * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const patchPos = new Map();
        for (const node of nodes) {
          const dx = node.x - cx;
          const dy = node.y - cy;
          node.x = cx + dx * cosR - dy * sinR;
          node.y = cy + dx * sinR + dy * cosR;
          if (Number.isFinite(node.forcePlacementAngle)) {
            node.forcePlacementAngle += rad;
          }
          node.vx = 0;
          node.vy = 0;
          patchPos.set(node.id, forcePatchEntryForNode(node));
        }
        context.force.patchForceNodePositions(patchPos, { setAnchors: true, alpha: 0, restart: false });
        context.force.syncPositions?.();
        pendingRotateFit = { mode: 'force', nodes: [...nodes], mol };
      };
      step();
      rotateInterval = setInterval(step, 40);
      return;
    }

    const mol = context.state.documentState.getMol2d();
    if (mode !== '2d' || !mol) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });
    context.view.restorePersistentHighlight();
    const step = () => {
      const allAtoms = [...mol.atoms.values()].filter(atom => atom.x != null);
      if (!allAtoms.length) {
        return;
      }
      let mx = 0;
      let my = 0;
      for (const atom of allAtoms) {
        mx += atom.x;
        my += atom.y;
      }
      mx /= allAtoms.length;
      my /= allAtoms.length;
      const rad = (delta * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      for (const atom of allAtoms) {
        const dx = atom.x - mx;
        const dy = atom.y - my;
        atom.x = mx + dx * cosR - dy * sinR;
        atom.y = my + dx * sinR + dy * cosR;
      }
      context.state.viewState.setRotationDeg((context.state.viewState.getRotationDeg() + delta) % 360);
      context.renderers.draw2d();
      pendingRotateFit = { mode: '2d', atoms: [...allAtoms] };
    };
    step();
    rotateInterval = setInterval(step, 40);
  }

  function flip(axis) {
    const mode = context.state.viewState.getMode();
    if (mode === 'force') {
      const mol = context.state.documentState.getCurrentMol();
      if (!mol) {
        return;
      }
      context.history.takeSnapshot({ clearReactionPreview: false });
      const nodes = context.simulation.nodes().filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
      if (!nodes.length) {
        return;
      }
      let cx = 0;
      let cy = 0;
      for (const node of nodes) {
        cx += node.x;
        cy += node.y;
      }
      cx /= nodes.length;
      cy /= nodes.length;
      const isFlipH = axis === 'h';
      const pivotAnchorAtomId = forceSelectionPivotAnchor(nodes);
      if (!pivotAnchorAtomId) {
        mirrorSelectionPivot(axis, { x: cx, y: cy });
      }
      const patchPos = new Map();
      for (const node of nodes) {
        if (isFlipH) {
          node.x = 2 * cx - node.x;
          if (Number.isFinite(node.forcePlacementAngle)) {
            node.forcePlacementAngle = Math.PI - node.forcePlacementAngle;
          }
        } else {
          node.y = 2 * cy - node.y;
          if (Number.isFinite(node.forcePlacementAngle)) {
            node.forcePlacementAngle = -node.forcePlacementAngle;
          }
        }
        node.vx = 0;
        node.vy = 0;
        patchPos.set(node.id, forcePatchEntryForNode(node));
      }
      if (pivotAnchorAtomId) {
        const node = nodes.find(candidate => candidate.id === pivotAnchorAtomId);
        const x = finiteNumber(node?.x);
        const y = finiteNumber(node?.y);
        if (x != null && y != null) {
          context.state.overlayState?.setSelectionPivot?.({ x, y });
        }
      }
      context.force.patchForceNodePositions(patchPos, { setAnchors: true, alpha: 0, restart: false });
      const flipResult = context.helpers.flipDisplayStereo?.(mol);
      if (flipResult?.size && mol?.__reactionPreview) {
        // Flip every stereo-type entry in all reaction-preview Maps.
        // These Map objects are the same references as the module-level
        // _reactionPreview* variables in reaction-2d.js (passed by reference
        // via _alignReaction2dProductOrientation → preserveReaction2dStereoDisplay).
        // preserveReaction2dStereoDisplay rebuilds forcedStereoByCenter /
        // forcedStereoBondTypes from the preserved* maps every render, so ALL
        // maps must be flipped here to prevent the next render from undoing it.
        const flipType = t => (t === 'wedge' ? 'dash' : t === 'dash' ? 'wedge' : t);
        const preview = mol.__reactionPreview;
        for (const [k, v] of preview.forcedStereoBondTypes ?? new Map()) {
          preview.forcedStereoBondTypes.set(k, flipType(v));
        }
        for (const [k, v] of preview.preservedReactantStereoBondTypes ?? new Map()) {
          preview.preservedReactantStereoBondTypes.set(k, flipType(v));
        }
        for (const [k, v] of preview.preservedProductStereoBondTypes ?? new Map()) {
          preview.preservedProductStereoBondTypes.set(k, flipType(v));
        }
        for (const [k, v] of preview.forcedStereoByCenter ?? new Map()) {
          if (v?.type) {
            preview.forcedStereoByCenter.set(k, { ...v, type: flipType(v.type) });
          }
        }
        for (const [k, v] of preview.preservedReactantStereoByCenter ?? new Map()) {
          if (v?.type) {
            preview.preservedReactantStereoByCenter.set(k, { ...v, type: flipType(v.type) });
          }
        }
        for (const [k, v] of preview.preservedProductStereoByCenter ?? new Map()) {
          if (v?.type) {
            preview.preservedProductStereoByCenter.set(k, { ...v, type: flipType(v.type) });
          }
        }
      }
      context.renderers.updateForce(mol, { preservePositions: true, preserveView: true, restartSimulation: false });
      if (context.overlays.hasReactionPreview()) {
        const renderedNodes = context.simulation.nodes().filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
        const fitTransform = context.force.forceFitTransform(renderedNodes, context.force.initialFitPad ?? FORCE_LAYOUT_INITIAL_FIT_PAD, {
          scaleMultiplier: context.force.initialZoomMultiplier ?? FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER,
          reactionLike: true
        });
        if (fitTransform) {
          const currentTransform = context.view.getZoomTransform();
          if (context.force.zoomTransformsDiffer(fitTransform, currentTransform)) {
            context.view.setZoomTransform(fitTransform);
          }
        }
      }
      context.view.restorePersistentHighlight();
      return;
    }

    const mol = context.state.documentState.getMol2d();
    if (mode !== '2d' || !mol) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });
    context.view.restorePersistentHighlight();
    if (axis === 'h') {
      context.state.viewState.setFlipH(!context.state.viewState.getFlipH());
    } else {
      context.state.viewState.setFlipV(!context.state.viewState.getFlipV());
    }

    const allAtoms = [...mol.atoms.values()].filter(atom => atom.x != null);
    const pivotAnchorAtomId = twoDSelectionPivotAnchor(mol);
    const pivotMolPoint = pivotAnchorAtomId ? null : molPointForRendered2dPoint(currentSelectionPivot());
    let mx = 0;
    let my = 0;
    for (const atom of allAtoms) {
      mx += atom.x;
      my += atom.y;
    }
    mx /= allAtoms.length;
    my /= allAtoms.length;
    if (axis === 'h') {
      for (const atom of allAtoms) {
        atom.x = 2 * mx - atom.x;
      }
    } else {
      for (const atom of allAtoms) {
        atom.y = 2 * my - atom.y;
      }
    }

    const bbox = context.helpers.atomBBox(allAtoms);
    context.state.viewState.setCx2d(bbox.cx);
    context.state.viewState.setCy2d(bbox.cy);
    const pivotAnchorAtom = pivotAnchorAtomId ? mol.atoms.get(pivotAnchorAtomId) : null;
    if (pivotAnchorAtom) {
      context.state.overlayState?.setSelectionPivot?.(rendered2dPointForMolPoint(pivotAnchorAtom));
    } else if (pivotMolPoint) {
      context.state.overlayState?.setSelectionPivot?.(
        rendered2dPointForMolPoint(
          axis === 'h'
            ? {
                x: 2 * mx - pivotMolPoint.x,
                y: pivotMolPoint.y
              }
            : {
                x: pivotMolPoint.x,
                y: 2 * my - pivotMolPoint.y
              }
        )
      );
    }
    context.view.flipStereoMap2d?.(mol);
    context.renderers.draw2d();
  }

  return {
    autoZoom,
    cleanLayout2d,
    cleanLayoutForce,
    toggleMode,
    startRotate,
    stopRotate,
    flip
  };
}

/**
 * Attaches document-level mouse event listeners for rotate and flip button interactions.
 * @param {object} params - Navigation interaction parameters.
 * @param {Document} [params.doc] - Document to attach listeners to (defaults to globalThis.document).
 * @param {object} params.controller - App controller with `performViewAction` for dispatching navigation actions.
 */
export function initNavigationInteractions({ doc = document, controller }) {
  const stopRotation = () => {
    controller.performViewAction('stop-rotate');
  };
  doc.addEventListener('mousedown', event => {
    const btn = event.target.closest('#rotate-ccw, #rotate-cw, #force-rotate-ccw, #force-rotate-cw');
    if (!btn) {
      return;
    }
    controller.performViewAction('start-rotate', {
      delta: btn.id === 'rotate-cw' || btn.id === 'force-rotate-cw' ? -5 : 5
    });
  });
  doc.addEventListener('mouseup', stopRotation);
  doc.addEventListener('pointerup', stopRotation);
  doc.addEventListener('mouseleave', stopRotation);
  doc.defaultView?.addEventListener?.('mouseup', stopRotation);
  doc.defaultView?.addEventListener?.('pointerup', stopRotation);
  doc.defaultView?.addEventListener?.('blur', stopRotation);
  doc.addEventListener('click', event => {
    const btn = event.target.closest('#flip-h, #flip-v, #force-flip-h, #force-flip-v');
    if (!btn) {
      return;
    }
    controller.performViewAction('flip', {
      axis: btn.id === 'flip-h' || btn.id === 'force-flip-h' ? 'h' : 'v'
    });
  });
}
