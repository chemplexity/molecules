/** @module app/interactions/structural-edit-actions */

import { ReactionPreviewPolicy, ResonancePolicy, SnapshotPolicy, ViewportPolicy } from '../core/editor-actions.js';
import { applyDisplayedStereoToCenter, getPreferredBondDisplayCenterId } from '../../layout/mol2d-helpers.js';
import { repairImplicitHydrogensWhenValenceImproves } from './implicit-hydrogen-repair.js';
import { DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE, synthesizeHydrogenPosition } from '../../layout/engine/stereo/wedge-geometry.js';
import { normalizeRingAtomIds, normalizeRingFillStyle, normalizeVisualStyle, ringAtomKey } from '../../core/style.js';

const FORCE_RESEAT_HYDROGEN_DISTANCE = 25;
const DEFAULT_2D_BOND_LENGTH = 1.5;
const RING_TEMPLATE_MIN_SIZE = 3;
const RING_TEMPLATE_MAX_SIZE = 7;
const RING_TEMPLATE_REUSE_DISTANCE_FACTOR = 0.2;
const FORCE_RING_TEMPLATE_BOND_LENGTH_FACTOR = 1.3;
const TAU = Math.PI * 2;
const GEOMETRY_EPSILON = 1e-6;

function normalizeRingTemplateSize(size) {
  const normalizedSize = Number(size);
  if (!Number.isInteger(normalizedSize) || normalizedSize < RING_TEMPLATE_MIN_SIZE || normalizedSize > RING_TEMPLATE_MAX_SIZE) {
    return null;
  }
  return normalizedSize;
}

function regularRingPositions(size, cx, cy, bondLength) {
  const radius = bondLength / (2 * Math.sin(Math.PI / size));
  const startAngle = size % 2 === 0 ? -Math.PI / 2 + Math.PI / size : -Math.PI / 2;
  const positions = [];
  for (let index = 0; index < size; index++) {
    const angle = startAngle + (index * Math.PI * 2) / size;
    positions.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius
    });
  }
  return positions;
}

function normalizeAngle(angle) {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

function isFinitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointDistance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

function bondAnchorPointsWithLength(anchorA, anchorB, targetLength) {
  if (!isFinitePoint(anchorA) || !isFinitePoint(anchorB) || !Number.isFinite(targetLength)) {
    return [anchorA, anchorB];
  }
  const dx = anchorB.x - anchorA.x;
  const dy = anchorB.y - anchorA.y;
  const length = Math.hypot(dx, dy);
  if (length <= GEOMETRY_EPSILON) {
    return [anchorA, anchorB];
  }
  const midpoint = {
    x: (anchorA.x + anchorB.x) * 0.5,
    y: (anchorA.y + anchorB.y) * 0.5
  };
  const halfX = (dx / length) * targetLength * 0.5;
  const halfY = (dy / length) * targetLength * 0.5;
  return [
    { x: midpoint.x - halfX, y: midpoint.y - halfY },
    { x: midpoint.x + halfX, y: midpoint.y + halfY }
  ];
}

function neighborAnglesForRingAnchor(mol, atom, anchorPoint) {
  if (!atom || typeof atom.getNeighbors !== 'function') {
    return [];
  }
  const angles = [];
  for (const neighbor of atom.getNeighbors(mol)) {
    if (!neighbor || neighbor.visible === false || neighbor.name === 'H' || !Number.isFinite(neighbor.x) || !Number.isFinite(neighbor.y)) {
      continue;
    }
    const dx = neighbor.x - anchorPoint.x;
    const dy = neighbor.y - anchorPoint.y;
    if (Math.hypot(dx, dy) <= GEOMETRY_EPSILON) {
      continue;
    }
    angles.push(normalizeAngle(Math.atan2(dy, dx)));
  }
  return angles;
}

function largestAngularGapMidpoint(angles, fallbackAngle = -Math.PI / 2) {
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

function anchoredRingPositions(size, anchorPoint, bondLength, centerAngle) {
  const radius = bondLength / (2 * Math.sin(Math.PI / size));
  const center = {
    x: anchorPoint.x + Math.cos(centerAngle) * radius,
    y: anchorPoint.y + Math.sin(centerAngle) * radius
  };
  const anchorAngleFromCenter = centerAngle + Math.PI;
  const positions = [{ x: anchorPoint.x, y: anchorPoint.y }];
  for (let index = 1; index < size; index++) {
    const angle = anchorAngleFromCenter + (index * TAU) / size;
    positions.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }
  return positions;
}

function anchoredRingPositionsForAtom(mol, anchorAtom, size, bondLength, fallbackAngle = -Math.PI / 2, centerAngleOverride = null) {
  const anchorPoint = { x: anchorAtom.x, y: anchorAtom.y };
  const centerAngle = Number.isFinite(centerAngleOverride) ? centerAngleOverride : largestAngularGapMidpoint(neighborAnglesForRingAnchor(mol, anchorAtom, anchorPoint), fallbackAngle);
  return anchoredRingPositions(size, anchorPoint, bondLength, centerAngle);
}

function regularRingPositionsForBondPoints(anchorA, anchorB, size, sideSign = 1) {
  if (!isFinitePoint(anchorA) || !isFinitePoint(anchorB)) {
    return null;
  }
  const dx = anchorB.x - anchorA.x;
  const dy = anchorB.y - anchorA.y;
  const bondLength = Math.hypot(dx, dy);
  if (bondLength <= GEOMETRY_EPSILON) {
    return null;
  }
  const ux = dx / bondLength;
  const uy = dy / bondLength;
  const midpoint = {
    x: (anchorA.x + anchorB.x) / 2,
    y: (anchorA.y + anchorB.y) / 2
  };
  const apothem = bondLength / (2 * Math.tan(Math.PI / size));
  const center = {
    x: midpoint.x - uy * apothem * sideSign,
    y: midpoint.y + ux * apothem * sideSign
  };
  const step = TAU / size;
  const angleA = Math.atan2(anchorA.y - center.y, anchorA.x - center.x);
  const angleB = Math.atan2(anchorB.y - center.y, anchorB.x - center.x);
  const direction = normalizeAngle(angleB - angleA) <= Math.PI ? 1 : -1;
  const positions = [
    { x: anchorA.x, y: anchorA.y },
    { x: anchorB.x, y: anchorB.y }
  ];
  for (let index = 2; index < size; index++) {
    const angle = angleB + direction * step * (index - 1);
    positions.push({
      x: center.x + Math.cos(angle) * (bondLength / (2 * Math.sin(Math.PI / size))),
      y: center.y + Math.sin(angle) * (bondLength / (2 * Math.sin(Math.PI / size)))
    });
  }
  return positions;
}

function scoreBondAnchoredRingSide(newPositions, occupiedPoints, bondLength) {
  let score = 0;
  for (const position of newPositions) {
    for (const occupied of occupiedPoints) {
      const distance = pointDistance(position, occupied);
      if (distance <= GEOMETRY_EPSILON) {
        score += 1e6;
        continue;
      }
      score += 1 / (distance * distance);
      if (distance < bondLength * 0.8) {
        score += (bondLength * 0.8 - distance) * 100;
      }
    }
  }
  return score;
}

function normalizeBondSideSign(sideSign) {
  if (!Number.isFinite(sideSign) || Math.abs(sideSign) <= GEOMETRY_EPSILON) {
    return null;
  }
  return sideSign < 0 ? -1 : 1;
}

function chooseBondAnchoredRingPositions(anchorA, anchorB, size, occupiedPoints = [], preferredSideSign = null) {
  const normalizedSideSign = normalizeBondSideSign(preferredSideSign);
  if (normalizedSideSign !== null) {
    return regularRingPositionsForBondPoints(anchorA, anchorB, size, normalizedSideSign);
  }
  const first = regularRingPositionsForBondPoints(anchorA, anchorB, size, 1);
  const second = regularRingPositionsForBondPoints(anchorA, anchorB, size, -1);
  if (!first || !second) {
    return null;
  }
  const bondLength = pointDistance(anchorA, anchorB);
  const firstScore = scoreBondAnchoredRingSide(first.slice(2), occupiedPoints, bondLength);
  const secondScore = scoreBondAnchoredRingSide(second.slice(2), occupiedPoints, bondLength);
  return firstScore <= secondScore ? first : second;
}

function bondAnchoredRingPositionsForBond(mol, anchorBond, size, sideSign = null) {
  const [anchorA, anchorB] = anchorBond?.getAtomObjects?.(mol) ?? [];
  if (!anchorA || !anchorB || anchorA.name === 'H' || anchorB.name === 'H' || !Number.isFinite(anchorA.x) || !Number.isFinite(anchorA.y) || !Number.isFinite(anchorB.x) || !Number.isFinite(anchorB.y)) {
    return null;
  }
  const anchorIds = new Set(anchorBond.atoms);
  const occupiedPoints = [...mol.atoms.values()]
    .filter(atom => !anchorIds.has(atom.id) && atom.name !== 'H' && atom.visible !== false && Number.isFinite(atom.x) && Number.isFinite(atom.y))
    .map(atom => ({ x: atom.x, y: atom.y }));
  return chooseBondAnchoredRingPositions({ x: anchorA.x, y: anchorA.y }, { x: anchorB.x, y: anchorB.y }, size, occupiedPoints, sideSign);
}

function findReusableRingTemplateAtomId(mol, position, usedAtomIds, tolerance) {
  if (!isFinitePoint(position)) {
    return null;
  }
  const entries = [];
  for (const atom of mol?.atoms?.values?.() ?? []) {
    if (!atom || atom.name === 'H' || atom.visible === false || !Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    entries.push(atom);
  }
  return findReusableRingTemplateAtomEntryId(entries, position, usedAtomIds, tolerance);
}

function findReusableRingTemplateAtomEntryId(entries, position, usedAtomIds, tolerance) {
  if (!isFinitePoint(position)) {
    return null;
  }
  let bestAtomId = null;
  let bestDistance = tolerance;
  for (const atom of entries ?? []) {
    if (!atom || usedAtomIds.has(atom.id) || !Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    const distance = pointDistance(position, atom);
    if (distance <= bestDistance + GEOMETRY_EPSILON) {
      bestAtomId = atom.id;
      bestDistance = distance;
    }
  }
  return bestAtomId;
}

function addOrReuseRingTemplateAtom(mol, position, ringAtomIds, usedAtomIds, bondLength, reuseOptions = {}) {
  const reusePosition = reuseOptions.position ?? position;
  const tolerance = reuseOptions.tolerance ?? bondLength * RING_TEMPLATE_REUSE_DISTANCE_FACTOR;
  const reusableAtomId = reuseOptions.entries
    ? findReusableRingTemplateAtomEntryId(reuseOptions.entries, reusePosition, usedAtomIds, tolerance)
    : findReusableRingTemplateAtomId(mol, reusePosition, usedAtomIds, tolerance);
  if (reusableAtomId) {
    usedAtomIds.add(reusableAtomId);
    ringAtomIds.push(reusableAtomId);
    return null;
  }
  const atom = mol.addAtom(null, 'C', {}, { recompute: false });
  atom.x = position.x;
  atom.y = position.y;
  usedAtomIds.add(atom.id);
  ringAtomIds.push(atom.id);
  return atom.id;
}

function forceBondAnchoredRingPositions(currentForceNodes, anchorBond, size, sideSign, forceBondLength) {
  const nodeById = new Map((currentForceNodes ?? []).map(node => [node.id, node]));
  const anchorA = nodeById.get(anchorBond?.atoms?.[0]);
  const anchorB = nodeById.get(anchorBond?.atoms?.[1]);
  if (!isFinitePoint(anchorA) || !isFinitePoint(anchorB)) {
    return null;
  }
  const [forceAnchorA, forceAnchorB] = bondAnchorPointsWithLength(anchorA, anchorB, forceBondLength);
  const anchorIds = new Set(anchorBond.atoms);
  const occupiedPoints = currentForceNodes
    .filter(node => !anchorIds.has(node.id) && node.name !== 'H' && Number.isFinite(node.x) && Number.isFinite(node.y))
    .map(node => ({ x: node.x, y: node.y }));
  return chooseBondAnchoredRingPositions(forceAnchorA, forceAnchorB, size, occupiedPoints, sideSign);
}

function addRingTemplateAtom(mol, position, ringAtomIds, usedAtomIds) {
  const atom = mol.addAtom(null, 'C', {}, { recompute: false });
  atom.x = position.x;
  atom.y = position.y;
  usedAtomIds.add(atom.id);
  ringAtomIds.push(atom.id);
  return atom.id;
}

/**
 * Returns ring polygons incident to one atom using already-placed 2D coords.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @param {string} atomId - Atom id whose incident ring polygons are requested.
 * @returns {Array<Array<{x: number, y: number}>>} Incident ring polygons.
 */
function incidentRingPolygonsForAtom(molecule, atomId) {
  return molecule
    .getRings()
    .filter(ringAtomIds => ringAtomIds.includes(atomId))
    .map(ringAtomIds =>
      ringAtomIds
        .map(ringAtomId => molecule.atoms.get(ringAtomId))
        .filter(atom => atom && Number.isFinite(atom.x) && Number.isFinite(atom.y))
        .map(atom => ({ x: atom.x, y: atom.y }))
    )
    .filter(polygon => polygon.length >= 3);
}

/**
 * Returns a replacement coordinate for a displayed or hidden stereochemical
 * hydrogen that is about to become a real editable atom in 2D.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @param {string} atomId - Hydrogen atom id that may need a projected position.
 * @param {number} [bondLength] - Target 2D bond length for the replacement atom.
 * @returns {{x: number, y: number}|null} Projected replacement position, or null.
 */
function getProjected2dStereoHydrogenReplacementPosition(molecule, atomId, bondLength = DEFAULT_2D_BOND_LENGTH) {
  const atom = molecule?.atoms?.get(atomId);
  if (!atom || atom.name !== 'H') {
    return null;
  }

  const neighbors = atom.getNeighbors(molecule);
  if (neighbors.length !== 1) {
    return null;
  }
  const parent = neighbors[0];
  if (!parent?.getChirality?.() || !Number.isFinite(parent.x) || !Number.isFinite(parent.y)) {
    return null;
  }

  const bond = molecule.getBond(atom.id, parent.id);
  const hasCoincidentCoords = Number.isFinite(atom.x) && Number.isFinite(atom.y) && Math.abs(atom.x - parent.x) <= 1e-6 && Math.abs(atom.y - parent.y) <= 1e-6;
  const hasDisplayedStereo = bond?.properties?.display?.as === 'wedge' || bond?.properties?.display?.as === 'dash';
  if (atom.visible !== false && !hasDisplayedStereo) {
    return null;
  }
  if (!hasCoincidentCoords && atom.visible !== false) {
    return null;
  }

  const knownPositions = parent
    .getNeighbors(molecule)
    .filter(neighbor => neighbor.id !== atom.id && Number.isFinite(neighbor.x) && Number.isFinite(neighbor.y))
    .map(neighbor => ({ x: neighbor.x, y: neighbor.y }));

  return synthesizeHydrogenPosition({ x: parent.x, y: parent.y }, knownPositions, bondLength, {
    incidentRingPolygons: incidentRingPolygonsForAtom(molecule, parent.id),
    preferCardinalAxes: true,
    cardinalAxisSectorTolerance: hasDisplayedStereo ? DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE : undefined
  });
}

/**
 * Seeds projected stereochemical hydrogen replacements onto real 2D atom
 * coordinates before the atom element changes away from hydrogen.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @param {string[]} atomIds - Atom ids being edited.
 * @param {number} [bondLength] - Target 2D bond length for projected replacements.
 * @returns {void}
 */
function seed2dReplacementCoordsForProjectedHydrogens(molecule, atomIds, bondLength = DEFAULT_2D_BOND_LENGTH) {
  for (const atomId of atomIds) {
    const atom = molecule?.atoms?.get(atomId);
    if (!atom || atom.name !== 'H') {
      continue;
    }
    const projectedPosition = getProjected2dStereoHydrogenReplacementPosition(molecule, atomId, bondLength);
    if (!projectedPosition) {
      continue;
    }
    atom.x = projectedPosition.x;
    atom.y = projectedPosition.y;
    atom.visible = true;
  }
}

function clearBondDisplayStereo(bond) {
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

function setBondDisplayStereo(bond, type, { centerId = null, manual = false } = {}) {
  if (!bond || (type !== 'wedge' && type !== 'dash')) {
    clearBondDisplayStereo(bond);
    return;
  }
  bond.properties.display ??= {};
  bond.properties.display.as = type;
  if (centerId && bond.atoms.includes(centerId)) {
    bond.properties.display.centerId = centerId;
  } else {
    delete bond.properties.display.centerId;
  }
  if (manual) {
    bond.properties.display.manual = true;
  } else {
    delete bond.properties.display.manual;
  }
}

/**
 * Resolves the preferred stereo-center atom id for an explicit bond-display edit.
 * Existing display metadata acts as a stable fallback so repeated wedge/dash
 * flips keep using the same bond origin.
 * @param {object|null|undefined} bond - Bond-like object being edited.
 * @param {string|null} [preferredCenterId] - Caller-provided preferred center.
 * @returns {string|null} Preferred stereo-center atom id when available.
 */
function resolveStoredPreferredCenterId(bond, preferredCenterId = null) {
  return preferredCenterId ?? bond?.properties?.display?.centerId ?? null;
}

/**
 * Returns whether a force-mode hydrogen bond should remain editable because it
 * represents a stereochemical hydrogen display. Ordinary force-layout H bonds
 * stay blocked, but displayed stereo hydrogens may be flipped between wedge,
 * dash, and plain single-bond display.
 * @param {object} mol - Molecule containing the bond.
 * @param {object|null|undefined} bond - Candidate bond.
 * @param {string|null} drawBondType - Requested draw-bond type.
 * @param {string|null} [preferredCenterId] - Preferred stereo-center hint.
 * @returns {boolean} True when the force-mode edit should be allowed.
 */
function isForceEditableHydrogenStereoBond(mol, bond, drawBondType, preferredCenterId = null) {
  if (!mol || !bond) {
    return false;
  }
  const atoms = bond.getAtomObjects?.(mol) ?? [];
  if (!atoms.some(atom => atom?.name === 'H')) {
    return false;
  }
  const displayAs = bond.properties?.display?.as ?? null;
  if (drawBondType === 'single') {
    return displayAs === 'wedge' || displayAs === 'dash';
  }
  if (drawBondType !== 'wedge' && drawBondType !== 'dash') {
    return false;
  }
  if (displayAs === 'wedge' || displayAs === 'dash') {
    return true;
  }
  const centerId = getPreferredBondDisplayCenterId(mol, bond.id, preferredCenterId);
  return !!centerId && !!mol.atoms.get(centerId)?.getChirality?.();
}

/**
 * Returns whether the requested draw-bond type should be a no-op for a
 * displayed stereochemical hydrogen bond.
 * @param {object} mol - Molecule containing the bond.
 * @param {object|null|undefined} bond - Candidate bond.
 * @param {string|null} drawBondType - Requested draw-bond type.
 * @returns {boolean} True when the edit should be blocked before mutation.
 */
function isIncompatibleStereoHydrogenDrawType(mol, bond, drawBondType) {
  if (!mol || !bond || (drawBondType !== 'double' && drawBondType !== 'triple' && drawBondType !== 'aromatic')) {
    return false;
  }
  const atoms = bond.getAtomObjects?.(mol) ?? [];
  if (!atoms.some(atom => atom?.name === 'H')) {
    return false;
  }
  const displayAs = bond.properties?.display?.as ?? null;
  return displayAs === 'wedge' || displayAs === 'dash';
}

function tryApplyExplicitStereoAssignment(mol, bond, drawBondType, preferredCenterId = null) {
  if (!mol || !bond || (drawBondType !== 'wedge' && drawBondType !== 'dash')) {
    return null;
  }
  const resolvedPreferredCenterId = getPreferredBondDisplayCenterId(mol, bond.id, resolveStoredPreferredCenterId(bond, preferredCenterId));
  // Only attempt chirality resolution at the preferred (origin) atom to ensure
  // the wedge/dash always originates from the intended end of the bond.
  const center = mol.atoms.get(resolvedPreferredCenterId);
  if (typeof center?.getChirality === 'function' && typeof center?.setChirality === 'function') {
    const resolved = applyDisplayedStereoToCenter(mol, resolvedPreferredCenterId, bond.id, drawBondType);
    if (resolved?.type === drawBondType) {
      setBondDisplayStereo(bond, drawBondType, { centerId: resolvedPreferredCenterId, manual: true });
      return resolved;
    }
  }

  setBondDisplayStereo(bond, drawBondType, { centerId: resolvedPreferredCenterId, manual: true });
  return null;
}

function isExplicitBondDrawTypeNoOp(bond, drawBondType, preferredCenterId = null) {
  if (!bond || !drawBondType) {
    return false;
  }
  if (drawBondType === 'double') {
    return !bond.properties.aromatic && Math.round(bond.properties.order ?? 1) === 2;
  }
  if (drawBondType === 'triple') {
    return !bond.properties.aromatic && Math.round(bond.properties.order ?? 1) === 3;
  }
  if (drawBondType === 'aromatic') {
    return bond.properties.aromatic === true;
  }
  if (drawBondType === 'wedge' || drawBondType === 'dash') {
    // Only a no-op when the type AND direction (centerId) already match.
    return (
      Math.round(bond.properties.order ?? 1) === 1 &&
      !bond.properties.aromatic &&
      bond.properties.display?.as === drawBondType &&
      (preferredCenterId == null || bond.properties.display?.centerId == null || bond.properties.display?.centerId === preferredCenterId)
    );
  }
  return false;
}

function applyExplicitBondDrawType(bond, drawBondType) {
  if (!bond || !drawBondType || drawBondType === 'single') {
    return false;
  }
  clearBondDisplayStereo(bond);
  bond.setStereo(null);
  if (drawBondType === 'aromatic') {
    bond.setAromatic(true);
    return true;
  }
  if (drawBondType === 'double') {
    bond.setOrder(2);
    return true;
  }
  if (drawBondType === 'triple') {
    bond.setOrder(3);
    return true;
  }
  bond.setOrder(1);
  if (drawBondType === 'wedge' || drawBondType === 'dash') {
    bond.properties.display ??= {};
    bond.properties.display.as = drawBondType;
    bond.properties.display.manual = true;
    return true;
  }
  return drawBondType === 'single';
}

function shouldClearDisplayedStereoBond(bond, drawBondType) {
  return drawBondType === 'single' && (bond?.properties?.order ?? 1) === 1 && (bond?.properties?.display?.as === 'wedge' || bond?.properties?.display?.as === 'dash');
}

function resolveChargeToolNextValue(currentCharge, chargeTool, explicitNextCharge = null, decrement = false) {
  if (Number.isInteger(explicitNextCharge)) {
    return explicitNextCharge;
  }
  if (chargeTool !== 'positive' && chargeTool !== 'negative') {
    return currentCharge;
  }
  const signedStep = chargeTool === 'positive' ? 1 : -1;
  return currentCharge + (decrement ? -signedStep : signedStep);
}

function normalizeStyleOrNull(style) {
  try {
    return normalizeVisualStyle(style);
  } catch {
    return null;
  }
}

function stylesMatch(currentStyle, nextStyle) {
  const normalizedCurrent = normalizeStyleOrNull(currentStyle);
  if (normalizedCurrent === null && nextStyle === null) {
    return true;
  }
  if (normalizedCurrent === null || nextStyle === null) {
    return false;
  }
  return normalizedCurrent.color === nextStyle.color && normalizedCurrent.opacity === nextStyle.opacity;
}

function ringFillMatches(entry, nextEntry) {
  return (
    entry &&
    ringAtomKey(entry.atomIds ?? []) === ringAtomKey(nextEntry.atomIds) &&
    entry.color === nextEntry.color &&
    entry.opacity === nextEntry.opacity
  );
}

function findRingFillEntry(mol, atomIds) {
  const key = ringAtomKey(atomIds);
  return mol?.getRingFills?.().find(entry => ringAtomKey(entry.atomIds ?? []) === key) ?? null;
}

function moleculeHasRingAtomSet(mol, atomIds) {
  if (!mol?.getRings) {
    return false;
  }
  const key = ringAtomKey(atomIds);
  return mol.getRings().some(ringAtomIds => ringAtomKey(ringAtomIds) === key);
}

/**
 * Creates structural edit action handlers for bond-order promotion, atom-element changes, force-hydrogen replacement, and 2D viewport restoration.
 * @param {object} context - Dependency context providing controller, getMode, getDrawBondElement, molecule, view, resonance, chemistry, force, and constants.
 * @returns {object} Object with `restore2dEditViewport`, `prepareResonanceStructuralEdit`, `promoteBondOrder`, `changeAtomElements`, `changeAtomCharge`, and `replaceForceHydrogenWithDrawElement`.
 */
export function createStructuralEditActions(context) {
  function buildForceInitialPatchPos(atomIds) {
    const simulation = context.force.getSimulation?.();
    const previousNodes = simulation?.nodes?.();
    if (!Array.isArray(previousNodes) || previousNodes.length === 0) {
      return null;
    }

    const previousNodePositions = new Map();
    for (const node of previousNodes) {
      if (!Number.isFinite(node?.x) || !Number.isFinite(node?.y)) {
        continue;
      }
      previousNodePositions.set(node.id, { x: node.x, y: node.y });
    }

    const patchPos = new Map();
    for (const atomId of atomIds) {
      const position = previousNodePositions.get(atomId);
      if (!position) {
        continue;
      }
      patchPos.set(atomId, position);
    }

    return patchPos.size > 0 ? patchPos : null;
  }

  function restore2dEditViewport(zoomSnapshot, { reactionRestored = false, reactionEntryZoomSnapshot = null, resonanceReset = false, zoomToFit = false } = {}) {
    if (context.getMode() !== '2d') {
      return;
    }
    if (reactionRestored && reactionEntryZoomSnapshot) {
      context.view.restoreZoomTransformSnapshot(reactionEntryZoomSnapshot);
      return;
    }
    if (resonanceReset && zoomSnapshot) {
      context.view.restoreZoomTransformSnapshot(zoomSnapshot);
      return;
    }
    if (zoomToFit) {
      context.view.zoomToFitIf2d();
    }
  }

  function prepareResonanceStructuralEdit(mol) {
    const structuralEdit = context.resonance.prepareResonanceStateForStructuralEdit(mol);
    if (structuralEdit.resonanceCleared || structuralEdit.resonanceReset) {
      mol = context.molecule.getActive();
    }
    return { mol: structuralEdit.mol ?? mol, resonanceReset: structuralEdit.resonanceReset };
  }

  function getAverageMoleculeCenter(mol) {
    let x = 0;
    let y = 0;
    let count = 0;
    for (const atom of mol?.atoms?.values?.() ?? []) {
      if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
        continue;
      }
      x += atom.x;
      y += atom.y;
      count++;
    }
    return count > 0 ? { x: x / count, y: y / count } : { x: 0, y: 0 };
  }

  function getRingTemplatePlacementCenter(mol, mode, ox, oy) {
    const { width: plotWidth = 600, height: plotHeight = 400 } = context.plot?.getSize?.() ?? {};
    if (mode === 'force') {
      const moleculeCenter = getAverageMoleculeCenter(mol);
      const forceScale = context.constants.forceScale ?? 25;
      return {
        x: moleculeCenter.x + (ox - plotWidth / 2) / forceScale,
        y: moleculeCenter.y - (oy - plotHeight / 2) / forceScale
      };
    }
    const scale = context.constants.scale ?? 40;
    return {
      x: (context.view2D?.getCenterX?.() ?? 0) + (ox - plotWidth / 2) / scale,
      y: (context.view2D?.getCenterY?.() ?? 0) - (oy - plotHeight / 2) / scale
    };
  }

  function placeRingTemplate(size, ox, oy, options = {}) {
    const normalizedSize = normalizeRingTemplateSize(size);
    if (normalizedSize === null) {
      return { performed: false, cancelled: true };
    }
    const anchorAtomId = options.anchorAtomId ?? null;
    const anchorBondId = options.anchorBondId ?? null;
    const anchorBondSide = normalizeBondSideSign(options.anchorBondSide);
    const anchorCenterAngle = Number.isFinite(options.anchorCenterAngle) ? options.anchorCenterAngle : null;
    const anchorForceCenterAngle = Number.isFinite(options.anchorForceCenterAngle) ? options.anchorForceCenterAngle : null;
    const allowBondPositionReuse = options.allowBondPositionReuse === true;

    const mode = context.getMode();
    if (!context.molecule.getActive?.() && context.molecule.ensureActive) {
      context.molecule.ensureActive();
    }
    const zoomSnapshot = mode === '2d' ? context.view.captureZoomTransformSnapshot() : null;
    return context.controller.performStructuralEdit(
      'place-ring-template',
      {
        overlayPolicy: ReactionPreviewPolicy.preserve,
        resonancePolicy: options.skipResonancePrep ? ResonancePolicy.preserve : ResonancePolicy.normalizeForEdit,
        snapshotPolicy: options.skipSnapshot ? SnapshotPolicy.skip : SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.restoreEdit,
        zoomSnapshot,
        preflight: ({ mode: editMode }) => editMode === '2d' || editMode === 'force'
      },
      ({ mol, mode: editMode }) => {
        mol = mol ?? context.molecule.ensureActive?.();
        if (!mol) {
          return { cancelled: true };
        }

        const bondLength = DEFAULT_2D_BOND_LENGTH;
        const anchorBond = anchorBondId ? mol.bonds.get(anchorBondId) : null;
        const anchorAtom = anchorAtomId ? mol.atoms.get(anchorAtomId) : null;
        const forceBondLength = (context.constants.forceBondLength ?? 30) * FORCE_RING_TEMPLATE_BOND_LENGTH_FACTOR;
        const currentForceNodes = editMode === 'force' ? (context.force.getSimulation?.()?.nodes?.() ?? []) : [];
        const precomputedForceBondPositions = editMode === 'force' && anchorBond
          ? forceBondAnchoredRingPositions(currentForceNodes, anchorBond, normalizedSize, anchorBondSide, forceBondLength)
          : null;
        let anchorPoint = anchorAtom && Number.isFinite(anchorAtom.x) && Number.isFinite(anchorAtom.y) ? { x: anchorAtom.x, y: anchorAtom.y } : null;
        if (anchorAtom && !anchorPoint && editMode === 'force') {
          anchorPoint = getRingTemplatePlacementCenter(mol, editMode, ox, oy);
          anchorAtom.x = anchorPoint.x;
          anchorAtom.y = anchorPoint.y;
        }
        const positions = anchorBond
          ? bondAnchoredRingPositionsForBond(mol, anchorBond, normalizedSize, editMode === '2d' && anchorBondSide !== null ? -anchorBondSide : anchorBondSide)
          : anchorAtom
            ? isFinitePoint(anchorPoint)
              ? anchoredRingPositionsForAtom(mol, anchorAtom, normalizedSize, bondLength, -Math.PI / 2, anchorCenterAngle)
              : null
            : (() => {
                const center = getRingTemplatePlacementCenter(mol, editMode, ox, oy);
                return regularRingPositions(normalizedSize, center.x, center.y, bondLength);
              })();
        if (!positions || anchorAtom?.name === 'H') {
          return { cancelled: true };
        }

        const newAtomIds = [];
        const ringAtomIds = anchorBond ? [...anchorBond.atoms] : anchorAtom ? [anchorAtom.id] : [];
        const usedRingAtomIds = new Set(ringAtomIds);
        const allowPositionReuse = (!!anchorAtom && !anchorBond) || (!!anchorBond && allowBondPositionReuse);
        const positionList = anchorBond ? positions.slice(2) : anchorAtom ? positions.slice(1) : positions;
        const forceReusePositions = anchorBond && allowBondPositionReuse && editMode === 'force' ? precomputedForceBondPositions?.slice(2) : null;
        const forceReuseEntries = forceReusePositions
          ? currentForceNodes.filter(node => node?.id && !usedRingAtomIds.has(node.id) && node.name !== 'H' && node.visible !== false && Number.isFinite(node.x) && Number.isFinite(node.y))
          : null;
        for (let index = 0; index < positionList.length; index++) {
          const position = positionList[index];
          const reuseOptions = forceReuseEntries
            ? {
                entries: forceReuseEntries,
                position: forceReusePositions[index],
                tolerance: forceBondLength * RING_TEMPLATE_REUSE_DISTANCE_FACTOR
              }
            : {};
          const newAtomId = allowPositionReuse
            ? addOrReuseRingTemplateAtom(mol, position, ringAtomIds, usedRingAtomIds, bondLength, reuseOptions)
            : addRingTemplateAtom(mol, position, ringAtomIds, usedRingAtomIds);
          if (newAtomId) {
            newAtomIds.push(newAtomId);
          }
        }
        for (let index = 0; index < ringAtomIds.length; index++) {
          const atomA = ringAtomIds[index];
          const atomB = ringAtomIds[(index + 1) % ringAtomIds.length];
          if (!mol.getBond?.(atomA, atomB)) {
            mol.addBond(null, atomA, atomB, { order: 1 }, false);
          }
        }
        mol.repairImplicitHydrogens?.(ringAtomIds);
        mol._recomputeProperties?.();
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });

        const result = {
          clearSelection: true,
          clearPrimitiveHover: true,
          ringAtomIds,
          twoD: {
            zoomToFit: true
          }
        };
        if (editMode === 'force') {
          const fallbackForceCenterAngle = () => {
            const graphAnchorPoint = { x: ox, y: oy };
            const graphNeighborAngles = (anchorAtom.getNeighbors?.(mol) ?? [])
              .filter(neighbor => neighbor && neighbor.id !== newAtomIds[0] && neighbor.visible !== false && neighbor.name !== 'H')
              .map(neighbor => {
                const position = currentForceNodes.find?.(node => node.id === neighbor.id);
                if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y) || pointDistance(position, graphAnchorPoint) <= GEOMETRY_EPSILON) {
                  return null;
                }
                return normalizeAngle(Math.atan2(position.y - graphAnchorPoint.y, position.x - graphAnchorPoint.x));
              })
              .filter(angle => angle !== null);
            return largestAngularGapMidpoint(graphNeighborAngles, -Math.PI / 2);
          };
          const forcePositions = anchorBond
            ? precomputedForceBondPositions
            : anchorAtom
              ? anchoredRingPositions(normalizedSize, { x: ox, y: oy }, forceBondLength, anchorForceCenterAngle ?? fallbackForceCenterAngle())
              : regularRingPositions(normalizedSize, ox, oy, forceBondLength);
          if (!forcePositions) {
            return result;
          }
          const patchPos = new Map(ringAtomIds.map((atomId, index) => [atomId, forcePositions[index]]));
          result.force = {
            options: { preservePositions: true, preserveView: true, initialPatchPos: patchPos },
            afterRender: () => {
              context.force.patchNodePositions(patchPos);
            },
            enableKeepInView: true
          };
        }
        return result;
      }
    );
  }

  function dearomatizeBondAromaticComponent(mol, startBondId) {
    const visitedBondIds = new Set();
    const atomIds = new Set();
    const queue = [startBondId];

    while (queue.length > 0) {
      const bondId = queue.shift();
      if (visitedBondIds.has(bondId)) {
        continue;
      }
      const bond = mol.bonds.get(bondId);
      if (!bond?.properties?.aromatic) {
        continue;
      }
      visitedBondIds.add(bondId);
      for (const atomId of bond.atoms) {
        atomIds.add(atomId);
        const atom = mol.atoms.get(atomId);
        if (!atom) {
          continue;
        }
        for (const neighborBondId of atom.bonds) {
          if (visitedBondIds.has(neighborBondId)) {
            continue;
          }
          const neighborBond = mol.bonds.get(neighborBondId);
          if (neighborBond?.properties?.aromatic) {
            queue.push(neighborBondId);
          }
        }
      }
    }

    for (const bondId of visitedBondIds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      bond.properties.order = Number.isInteger(bond.properties.localizedOrder) ? bond.properties.localizedOrder : 1;
      bond.properties.aromatic = false;
      delete bond.properties.localizedOrder;
    }
    for (const atomId of atomIds) {
      const atom = mol.atoms.get(atomId);
      if (atom) {
        atom.properties.aromatic = false;
      }
    }
  }

  function promoteBondOrder(bondId, options = {}) {
    const {
      reactionRestored = false,
      reactionEntryZoomSnapshot = null,
      skipReactionPreviewPrep = false,
      skipResonancePrep = false,
      skipSnapshot = false,
      drawBondType = null,
      preferredCenterId = null,
      zoomSnapshot = context.getMode() === '2d' ? context.view.captureZoomTransformSnapshot() : null
    } = options;
    const explicitDrawBondType = drawBondType && drawBondType !== 'single' ? drawBondType : null;

    return context.controller.performStructuralEdit(
      'promote-bond-order',
      {
        overlayPolicy: skipReactionPreviewPrep ? ReactionPreviewPolicy.preserve : ReactionPreviewPolicy.prepareBondTarget,
        reactionPreviewPayload: skipReactionPreviewPrep ? null : bondId,
        reactionEdit: skipReactionPreviewPrep ? { bondId, restored: reactionRestored, entryZoomTransform: reactionEntryZoomSnapshot } : null,
        resonancePolicy: skipResonancePrep ? ResonancePolicy.preserve : ResonancePolicy.normalizeForEdit,
        snapshotPolicy: skipSnapshot ? SnapshotPolicy.skip : SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.restoreEdit,
        zoomSnapshot,
        preflight: ({ mol, mode, reactionEdit }) => {
          const targetBondId = skipReactionPreviewPrep ? bondId : (reactionEdit?.bondId ?? bondId);
          const bond = mol.bonds.get(targetBondId);
          if (!bond) {
            return false;
          }
          const resolvedPreferredCenterId = resolveStoredPreferredCenterId(bond, preferredCenterId);
          if (mode === 'force') {
            const [atom1, atom2] = bond.getAtomObjects(mol);
            if ((atom1?.name === 'H' || atom2?.name === 'H') && !isForceEditableHydrogenStereoBond(mol, bond, drawBondType, resolvedPreferredCenterId)) {
              return false;
            }
          }
          if (isIncompatibleStereoHydrogenDrawType(mol, bond, drawBondType)) {
            return false;
          }
          if (isExplicitBondDrawTypeNoOp(bond, explicitDrawBondType, resolvedPreferredCenterId)) {
            return false;
          }
          return true;
        }
      },
      ({ mol, mode, reactionEdit }) => {
        const targetBondId = skipReactionPreviewPrep ? bondId : (reactionEdit?.bondId ?? bondId);
        let bond = mol.bonds.get(targetBondId);
        if (!bond) {
          return { cancelled: true };
        }

        if (mode === 'force') {
          const [atom1, atom2] = bond.getAtomObjects(mol);
          const resolvedPreferredCenterId = resolveStoredPreferredCenterId(bond, preferredCenterId);
          if ((atom1?.name === 'H' || atom2?.name === 'H') && !isForceEditableHydrogenStereoBond(mol, bond, drawBondType, resolvedPreferredCenterId)) {
            return { cancelled: true };
          }
        }
        if (isIncompatibleStereoHydrogenDrawType(mol, bond, drawBondType)) {
          return { cancelled: true };
        }

        const activeBondId = bond.id;
        const wasAromatic = !!bond.properties.aromatic;
        if (wasAromatic) {
          dearomatizeBondAromaticComponent(mol, activeBondId);
          bond = mol.bonds.get(activeBondId);
          if (!bond) {
            return { cancelled: true };
          }
        }

        if (shouldClearDisplayedStereoBond(bond, drawBondType)) {
          clearBondDisplayStereo(bond);
          bond.setStereo(null);
          bond.properties.order = 1;
          bond.properties.aromatic = false;
          delete bond.properties.localizedOrder;
        } else if (explicitDrawBondType) {
          applyExplicitBondDrawType(bond, explicitDrawBondType);
          delete bond.properties.localizedOrder;
        } else {
          const currentOrder = Math.round(bond.properties.order ?? 1);
          const nextOrder = currentOrder >= 3 ? 1 : currentOrder + 1;
          bond.properties.order = nextOrder;
          bond.properties.aromatic = false;
          delete bond.properties.localizedOrder;
        }

        const [atom1, atom2] = bond.getAtomObjects(mol);
        const affected = new Set([atom1?.id, atom2?.id].filter(Boolean));
        mol.clearStereoAnnotations(affected);
        if (!wasAromatic && explicitDrawBondType !== 'aromatic') {
          context.chemistry.kekulize(mol);
          context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        }
        repairImplicitHydrogensWhenValenceImproves(mol, affected);
        if (explicitDrawBondType === 'wedge' || explicitDrawBondType === 'dash') {
          tryApplyExplicitStereoAssignment(mol, bond, explicitDrawBondType, resolveStoredPreferredCenterId(bond, preferredCenterId));
        }

        const forceResult =
          mode === 'force'
            ? {
                options: { preservePositions: true },
                beforeRender: () =>
                  new Set(
                    context.force
                      .getSimulation()
                      .nodes()
                      .map(node => node.id)
                  ),
                afterRender: (_editContext, prevNodeIds) => {
                  const simulation = context.force.getSimulation();
                  const nodes = simulation.nodes();
                  const allLinks = simulation.force('link').links();
                  const newHNodes = nodes.filter(node => node.name === 'H' && !prevNodeIds.has(node.id));
                  const newHIds = new Set(newHNodes.map(node => node.id));

                  if (newHNodes.length > 0) {
                    const newHByParent = new Map();
                    for (const hNode of newHNodes) {
                      const link = allLinks.find(currentLink => currentLink.source === hNode || currentLink.target === hNode);
                      if (!link) {
                        continue;
                      }
                      const parent = link.source === hNode ? link.target : link.source;
                      if (!newHByParent.has(parent)) {
                        newHByParent.set(parent, []);
                      }
                      newHByParent.get(parent).push(hNode);
                    }
                    for (const [parent, hNodes] of newHByParent) {
                      context.force.placeHydrogensAroundParent(parent, hNodes, allLinks, {
                        distance: FORCE_RESEAT_HYDROGEN_DISTANCE,
                        excludeIds: newHIds
                      });
                    }
                  }

                  for (const node of nodes) {
                    node.vx = 0;
                    node.vy = 0;
                    node.fx = node.x;
                    node.fy = node.y;
                  }
                  simulation.on('end.unfix', () => {
                    for (const node of simulation.nodes()) {
                      node.fx = null;
                      node.fy = null;
                    }
                    simulation.on('end.unfix', null);
                    simulation.alpha(0.08).restart();
                  });
                  simulation.alpha(0);
                }
              }
            : null;

        return {
          suppressDrawBondHover: true,
          clearPrimitiveHover: true,
          restorePrimitiveHover: {
            bondIds: [activeBondId]
          },
          force: forceResult
        };
      }
    );
  }

  function changeAtomElements(atomIds, newEl, options = {}) {
    const {
      zoomSnapshot = context.getMode() === '2d' ? context.view.captureZoomTransformSnapshot() : null,
      overlayPolicy = ReactionPreviewPolicy.prepareEditTargets,
      reactionPreviewPayload = atomIds.length > 0 ? { atomId: atomIds[0] } : null,
      reactionEdit = null
    } = options;

    if (!atomIds.length) {
      return { performed: false, cancelled: true };
    }

    return context.controller.performStructuralEdit(
      'change-atom-elements',
      {
        overlayPolicy,
        reactionPreviewPayload,
        reactionEdit,
        resonancePolicy: ResonancePolicy.normalizeForEdit,
        snapshotPolicy: SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.restoreEdit,
        zoomSnapshot,
        preflight: ({ mol }) =>
          atomIds.some(atomId => {
            const atom = mol.atoms.get(atomId);
            return atom && atom.name !== newEl;
          })
      },
      ({ mol, mode }) => {
        const toChange = atomIds.filter(atomId => {
          const atom = mol.atoms.get(atomId);
          return atom && atom.name !== newEl;
        });
        if (toChange.length === 0) {
          return { cancelled: true };
        }
        if (mode === '2d' && newEl !== 'H') {
          seed2dReplacementCoordsForProjectedHydrogens(mol, toChange);
        }
        for (const atomId of toChange) {
          mol.changeAtomElement(atomId, newEl);
        }
        const affected = new Set(toChange);
        mol.clearStereoAnnotations(affected);
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        repairImplicitHydrogensWhenValenceImproves(mol, affected);
        const initialPatchPos = mode === 'force' ? buildForceInitialPatchPos(toChange) : null;
        return {
          clearSelection: true,
          clearPrimitiveHover: true,
          suppressPrimitiveHover: true,
          restorePrimitiveHover: {
            atomIds: toChange
          },
          force:
            mode === 'force'
              ? {
                  options: { preservePositions: true, preserveView: true, initialPatchPos }
                }
              : null
        };
      }
    );
  }

  function changeAtomCharge(atomId, options = {}) {
    const {
      chargeTool = null,
      decrement = false,
      nextCharge = null,
      zoomSnapshot = context.getMode() === '2d' ? context.view.captureZoomTransformSnapshot() : null,
      overlayPolicy = ReactionPreviewPolicy.prepareEditTargets,
      reactionPreviewPayload = atomId ? { atomId } : null,
      reactionEdit = null
    } = options;

    if (!atomId) {
      return { performed: false, cancelled: true };
    }

    return context.controller.performStructuralEdit(
      'change-atom-charge',
      {
        overlayPolicy,
        reactionPreviewPayload,
        reactionEdit,
        resonancePolicy: ResonancePolicy.normalizeForEdit,
        snapshotPolicy: SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.restoreEdit,
        zoomSnapshot,
        preflight: ({ mol, reactionEdit: activeReactionEdit }) => {
          const targetAtomId = activeReactionEdit?.atomId ?? atomId;
          const atom = mol.atoms.get(targetAtomId);
          if (!atom) {
            return false;
          }
          const resolvedNextCharge = resolveChargeToolNextValue(atom.getCharge?.() ?? atom.properties?.charge ?? 0, chargeTool, nextCharge, decrement);
          return resolvedNextCharge !== (atom.getCharge?.() ?? atom.properties?.charge ?? 0);
        }
      },
      ({ mol, mode, reactionEdit: activeReactionEdit }) => {
        const targetAtomId = activeReactionEdit?.atomId ?? atomId;
        const atom = mol.atoms.get(targetAtomId);
        if (!atom) {
          return { cancelled: true };
        }
        const currentCharge = atom.getCharge?.() ?? atom.properties?.charge ?? 0;
        const resolvedNextCharge = resolveChargeToolNextValue(currentCharge, chargeTool, nextCharge, decrement);
        if (resolvedNextCharge === currentCharge) {
          return { cancelled: true };
        }

        try {
          mol.setAtomCharge(targetAtomId, resolvedNextCharge);
        } catch {
          return { cancelled: true };
        }

        const affected = new Set([targetAtomId]);
        repairImplicitHydrogensWhenValenceImproves(mol, affected);
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        const initialPatchPos = mode === 'force' ? buildForceInitialPatchPos([targetAtomId]) : null;

        return {
          clearPrimitiveHover: true,
          suppressPrimitiveHover: true,
          restorePrimitiveHover: {
            atomIds: [targetAtomId]
          },
          force:
            mode === 'force'
              ? {
                  options: { preservePositions: true, preserveView: true, initialPatchPos }
                }
              : null
        };
      }
    );
  }

  function paintStyleTargets(atomIds = [], bondIds = [], style = {}, options = {}) {
    const {
      zoomSnapshot = context.getMode() === '2d' ? context.view.captureZoomTransformSnapshot() : null,
      overlayPolicy = ReactionPreviewPolicy.preserve,
      reactionPreviewPayload = null,
      reactionEdit = null,
      skipSnapshot = false
    } = options;
    const clearStyle = style == null;
    let normalizedStyle = null;

    try {
      normalizedStyle = clearStyle ? null : normalizeVisualStyle(style);
    } catch {
      return { performed: false, cancelled: true };
    }

    if ((!clearStyle && !normalizedStyle) || (atomIds.length === 0 && bondIds.length === 0)) {
      return { performed: false, cancelled: true };
    }

    return context.controller.performStructuralEdit(
      'paint-style-targets',
      {
        overlayPolicy,
        reactionPreviewPayload,
        reactionEdit,
        resonancePolicy: ResonancePolicy.preserve,
        snapshotPolicy: skipSnapshot ? SnapshotPolicy.skip : SnapshotPolicy.take,
        snapshotOptions: { clearReactionPreview: false },
        viewportPolicy: ViewportPolicy.restoreEdit,
        zoomSnapshot,
        preflight: ({ mol }) => {
          for (const atomId of atomIds) {
            const atom = mol.atoms.get(atomId);
            if (atom && !stylesMatch(atom.properties?.style, normalizedStyle)) {
              return true;
            }
          }
          for (const bondId of bondIds) {
            const bond = mol.bonds.get(bondId);
            if (bond && !stylesMatch(bond.properties?.style, normalizedStyle)) {
              return true;
            }
          }
          return false;
        }
      },
      ({ mol, mode }) => {
        const paintedAtomIds = [];
        const paintedBondIds = [];

        for (const atomId of atomIds) {
          const atom = mol.atoms.get(atomId);
          if (!atom || stylesMatch(atom.properties?.style, normalizedStyle)) {
            continue;
          }
          atom.setStyle(normalizedStyle);
          paintedAtomIds.push(atomId);
        }

        for (const bondId of bondIds) {
          const bond = mol.bonds.get(bondId);
          if (!bond || stylesMatch(bond.properties?.style, normalizedStyle)) {
            continue;
          }
          bond.setStyle(normalizedStyle);
          paintedBondIds.push(bondId);
        }

        if (paintedAtomIds.length === 0 && paintedBondIds.length === 0) {
          return { cancelled: true };
        }

        context.overlays?.paintReactionPreviewReactantSource?.({
          atomIds: paintedAtomIds,
          bondIds: paintedBondIds,
          style: normalizedStyle
        });

        return {
          syncInput: false,
          updateAnalysis: false,
          clearPrimitiveHover: true,
          suppressPrimitiveHover: true,
          restorePrimitiveHover: {
            atomIds: paintedAtomIds,
            bondIds: paintedBondIds
          },
          force:
            mode === 'force'
              ? {
                  options: { preservePositions: true, preserveView: true }
                }
              : null
        };
      }
    );
  }

  function paintRingFill(atomIds = [], style = {}, options = {}) {
    const {
      zoomSnapshot = context.getMode() === '2d' ? context.view.captureZoomTransformSnapshot() : null,
      overlayPolicy = ReactionPreviewPolicy.preserve,
      reactionPreviewPayload = null,
      reactionEdit = null,
      skipSnapshot = false
    } = options;
    const clearFill = style == null;
    let normalizedAtomIds;
    let normalizedEntry = null;

    try {
      normalizedAtomIds = normalizeRingAtomIds(atomIds);
      normalizedEntry = clearFill ? null : normalizeRingFillStyle({ ...style, atomIds: normalizedAtomIds });
    } catch {
      return { performed: false, cancelled: true };
    }

    return context.controller.performStructuralEdit(
      'paint-ring-fill',
      {
        overlayPolicy,
        reactionPreviewPayload,
        reactionEdit,
        resonancePolicy: ResonancePolicy.preserve,
        snapshotPolicy: skipSnapshot ? SnapshotPolicy.skip : SnapshotPolicy.take,
        snapshotOptions: { clearReactionPreview: false },
        viewportPolicy: ViewportPolicy.restoreEdit,
        zoomSnapshot,
        preflight: ({ mol }) => {
          if (!moleculeHasRingAtomSet(mol, normalizedAtomIds)) {
            return false;
          }
          const currentEntry = findRingFillEntry(mol, normalizedAtomIds);
          return clearFill ? !!currentEntry : !ringFillMatches(currentEntry, normalizedEntry);
        }
      },
      ({ mol, mode }) => {
        if ((mode !== '2d' && mode !== 'force') || !moleculeHasRingAtomSet(mol, normalizedAtomIds)) {
          return { cancelled: true };
        }

        const currentEntry = findRingFillEntry(mol, normalizedAtomIds);
        if (clearFill ? !currentEntry : ringFillMatches(currentEntry, normalizedEntry)) {
          return { cancelled: true };
        }

        if (clearFill) {
          mol.clearRingFill?.(normalizedAtomIds);
        } else {
          mol.setRingFill(normalizedEntry.atomIds, normalizedEntry);
        }
        context.overlays?.paintReactionPreviewReactantSource?.({
          ringAtomIds: clearFill ? normalizedAtomIds : normalizedEntry.atomIds,
          ringFillStyle: normalizedEntry
        });

        return {
          syncInput: false,
          updateAnalysis: false,
          clearPrimitiveHover: true,
          suppressPrimitiveHover: true,
          force:
            mode === 'force'
              ? {
                  options: { preservePositions: true, preserveView: true }
                }
              : null
        };
      }
    );
  }

  function replaceForceHydrogenWithDrawElement(atomId, mol = context.molecule.getCurrentForceMol()) {
    if (!mol) {
      return;
    }

    return context.controller.performStructuralEdit(
      'replace-force-hydrogen-with-draw-element',
      {
        overlayPolicy: ReactionPreviewPolicy.prepareEditTargets,
        reactionPreviewPayload: { atomId },
        resonancePolicy: ResonancePolicy.normalizeForEdit,
        snapshotPolicy: SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.none
      },
      ({ mol, reactionEdit }) => {
        const targetAtomId = reactionEdit?.atomId ?? atomId;
        const targetAtom = mol.atoms.get(targetAtomId);
        if (!targetAtom) {
          return { cancelled: true };
        }

        mol.changeAtomElement(targetAtomId, context.getDrawBondElement());
        const affected = new Set([targetAtomId]);
        mol.clearStereoAnnotations(affected);
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        mol.repairImplicitHydrogens(affected);

        return {
          force: {
            options: { preservePositions: true, preserveView: true },
            beforeRender: () => {
              const simulation = context.force.getSimulation();
              const preHNode = simulation.nodes().find(node => node.id === targetAtomId);
              const preHX = preHNode?.x;
              const preHY = preHNode?.y;
              let parentNode = null;

              if (preHNode) {
                const allLinks = simulation.force('link').links();
                for (const link of allLinks) {
                  const source = link.source;
                  const target = link.target;
                  if (source?.id === targetAtomId && !context.force.isHydrogenNode(target)) {
                    parentNode = target;
                    break;
                  }
                  if (target?.id === targetAtomId && !context.force.isHydrogenNode(source)) {
                    parentNode = source;
                    break;
                  }
                }
              }

              return { parentNode, preHX, preHY };
            },
            afterRender: (_editContext, aux) => {
              if (!aux?.parentNode || aux.preHX == null || aux.preHY == null) {
                return;
              }
              const angle = Math.atan2(aux.preHY - aux.parentNode.y, aux.preHX - aux.parentNode.x);
              const position = {
                x: aux.parentNode.x + Math.cos(angle) * context.constants.forceBondLength,
                y: aux.parentNode.y + Math.sin(angle) * context.constants.forceBondLength
              };
              const patchPos = new Map([[targetAtomId, position]]);
              context.force.patchNodePositions(patchPos);
              context.force.reseatHydrogensAroundPatched(patchPos);
            }
          }
        };
      }
    );
  }

  return {
    restore2dEditViewport,
    prepareResonanceStructuralEdit,
    promoteBondOrder,
    changeAtomElements,
    changeAtomCharge,
    paintStyleTargets,
    paintRingFill,
    placeRingTemplate,
    replaceForceHydrogenWithDrawElement
  };
}
