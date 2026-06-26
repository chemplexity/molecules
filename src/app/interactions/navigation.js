/** @module app/interactions/navigation */

import { convertForceCoordsToLineLayout, convertLineCoordsToForceLayout, FORCE_LAYOUT_BOND_LENGTH, FORCE_LAYOUT_INITIAL_FIT_PAD, FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER } from '../render/force-helpers.js';

const DEFAULT_LAYOUT_BOND_LENGTH = 1.5;
const CLEAN_2D_BOND_LENGTH_TOLERANCE = 0.18;
const CLEAN_RING_SNAP_MIN_SIZE = 3;
const CLEAN_RING_SNAP_MAX_SIZE = 8;
const CLEAN_RING_SNAP_MAX_DISPLACEMENT_RATIO = 0.75;
const CLEAN_RING_SNAP_RMS_DISPLACEMENT_RATIO = 0.4;
const CLEAN_RING_SNAP_MIN_MOVE = 1e-4;
const CLEAN_RING_SUBSTITUENT_MIN_ANGLE_DELTA = (1 * Math.PI) / 180;
const ROTATE_FIT_FALLBACK_PAD = 40;
const ROTATE_FIT_ZOOM_MULTIPLIER = 1.3;
const ROTATE_FIT_MAX_SCALE = 30;

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

function measureMedianHeavyBondLength(molecule) {
  if (!molecule?.atoms || !molecule?.bonds) {
    return 0;
  }
  const lengths = [];
  for (const bond of molecule.bonds.values()) {
    const [firstId, secondId] = bond.atoms ?? [];
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

function normalizeCoordsToBondLength(molecule, bondLength) {
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
  for (const atom of molecule.atoms.values()) {
    if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    atom.x = cx + (atom.x - cx) * scale;
    atom.y = cy + (atom.y - cy) * scale;
  }
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

function fit2dViewportLikeAutoZoom(context, atoms) {
  if (context.view.fitCurrent2dView) {
    context.view.fitCurrent2dView();
    return;
  }
  if (!atoms?.length) {
    return;
  }
  const bbox = context.helpers.atomBBox(atoms);
  const fitTransform = lineRotateFitTransform(context, bbox);
  if (fitTransform) {
    context.view.setZoomTransform(fitTransform);
  }
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
  let clean2dBtnTimer = null;
  let cleanForceBtnTimer = null;

  function currentLayoutBondLength() {
    return context.helpers?.getLayoutBondLength?.() ?? DEFAULT_LAYOUT_BOND_LENGTH;
  }

  function stopRotate() {
    if (rotateInterval !== null) {
      clearInterval(rotateInterval);
      rotateInterval = null;
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
    const bondLength = currentLayoutBondLength();
    normalizeCoordsToBondLength(relayoutMol, bondLength);
    const ringSnapHints = snapCleanRingsToRegularGeometry(relayoutMol, {
      bondLength
    });
    const hasRefinementRelayout = typeof context.helpers.refineExistingCoords === 'function';
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
          ...(ringSnapHints.snappedCount > 0 ? { freezeRings: true } : {}),
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
    const preserveGeometry = ringSnapHints.snappedCount > 0 || (refinedCoords instanceof Map ? refinedCoords.size > 0 : hasRefinementRelayout);
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
    seedMoleculeFromForcePositions(relayoutMol, context.simulation.nodes?.(), bondLength);
    normalizeCoordsToBondLength(relayoutMol, bondLength);
    const ringSnapHints = snapCleanRingsToRegularGeometry(relayoutMol, {
      bondLength
    });
    const refinementHints = derive2dCleanRefinementHints(relayoutMol, {
      bondLength
    });
    for (const atomId of ringSnapHints.snappedAtoms) {
      refinementHints.touchedAtoms.add(atomId);
    }
    for (const bondId of ringSnapHints.snappedBonds) {
      refinementHints.touchedBonds.add(bondId);
    }
    if (typeof context.helpers.refineExistingCoords === 'function') {
      context.helpers.refineExistingCoords(relayoutMol, {
        suppressH: true,
        bondLength,
        maxPasses: 6,
        ...(ringSnapHints.snappedCount > 0 ? { freezeRings: true } : {}),
        touchedAtoms: refinementHints.touchedAtoms,
        touchedBonds: refinementHints.touchedBonds
      });
      normalizeCoordsToBondLength(relayoutMol, bondLength);
      snapCleanRingsToRegularGeometry(relayoutMol, {
        bondLength
      });
    }
    reapplyReactionPreviewForceLayout(relayoutMol, context.overlays, bondLength);
    const forceAnchorLayout = buildForceAnchorLayoutFromPlacedCoords(relayoutMol);
    context.view.setPreserveSelectionOnNextRender(true);
    context.renderers.renderMol(relayoutMol, {
      preserveHistory: true,
      preserveAnalysis: true,
      preserveView: false,
      forceAnchorLayout: forceAnchorLayout.size > 0 ? forceAnchorLayout : null
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
    if (previousMode === 'force') {
      const converted = convertForceCoordsToLineLayout(mol, context.simulation.nodes?.(), {
        bondLength,
        forceBondLength: FORCE_LAYOUT_BOND_LENGTH * (bondLength / DEFAULT_LAYOUT_BOND_LENGTH)
      });
      const appliedCount = applyLineLayoutCoords(mol, converted.coords);
      const preSnapLineCoords = captureFiniteAtomCoords(mol);
      const ringSnapHints = snapCleanRingsToRegularGeometry(mol, {
        bondLength
      });
      const reanchoredStereoCount = reanchorStereoTerminalsToCenters(mol, preSnapLineCoords);
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
      return;
    }

    const plotWidth = context.dom.plotEl?.clientWidth || 600;
    const plotHeight = context.dom.plotEl?.clientHeight || 400;
    const converted = convertLineCoordsToForceLayout(mol, {
      bondLength,
      forceCenter: { x: plotWidth / 2, y: plotHeight / 2 }
    });
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
      forceInitialPatchPos: converted.coords.size > 0 ? converted.coords : null
    });
  }

  function autoZoom() {
    const mode = context.state.viewState.getMode();
    if (mode === 'force') {
      const nodes = context.simulation.nodes?.().filter(node => Number.isFinite(node.x) && Number.isFinite(node.y)) ?? [];
      if (!nodes.length) {
        return;
      }
      const isPreviewComplex = isActiveForcePreviewComplex(context);
      const fitTransform = context.force.forceFitTransform(nodes, isPreviewComplex ? (context.force.initialFitPad ?? FORCE_LAYOUT_INITIAL_FIT_PAD) : context.force.fitPad, {
        scaleMultiplier: isPreviewComplex ? (context.force.initialZoomMultiplier ?? FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER) : context.force.initialZoomMultiplier,
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
        context.force.patchForceNodePositions(patchPos, { setAnchors: true, alpha: 0 });
        const currentTransform = context.view.getZoomTransform();
        const isPreviewComplex = isActiveForcePreviewComplex(context, mol);
        const fitTransform = context.force.forceFitTransform(nodes, isPreviewComplex ? (context.force.initialFitPad ?? FORCE_LAYOUT_INITIAL_FIT_PAD) : context.force.fitPad, {
          scaleMultiplier: isPreviewComplex ? (context.force.initialZoomMultiplier ?? FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER) : context.force.initialZoomMultiplier,
          ...(isPreviewComplex ? { reactionLike: true } : {})
        });
        if (fitTransform && context.force.zoomTransformsDiffer(fitTransform, currentTransform)) {
          context.view.setZoomTransform(fitTransform);
        }
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

      const bbox = context.helpers.atomBBox(allAtoms);
      context.state.viewState.setCx2d(bbox.cx);
      context.state.viewState.setCy2d(bbox.cy);
      context.renderers.draw2d();
      fit2dViewportLikeAutoZoom(context, allAtoms);
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
      context.force.patchForceNodePositions(patchPos, { setAnchors: true, alpha: 0 });
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
  doc.addEventListener('mousedown', event => {
    const btn = event.target.closest('#rotate-ccw, #rotate-cw, #force-rotate-ccw, #force-rotate-cw');
    if (!btn) {
      return;
    }
    controller.performViewAction('start-rotate', {
      delta: btn.id === 'rotate-cw' || btn.id === 'force-rotate-cw' ? -5 : 5
    });
  });
  doc.addEventListener('mouseup', () => {
    controller.performViewAction('stop-rotate');
  });
  doc.addEventListener('mouseleave', () => {
    controller.performViewAction('stop-rotate');
  });
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
