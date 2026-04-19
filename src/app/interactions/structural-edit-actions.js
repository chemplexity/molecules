/** @module app/interactions/structural-edit-actions */

import { ReactionPreviewPolicy, ResonancePolicy, SnapshotPolicy, ViewportPolicy } from '../core/editor-actions.js';
import { applyDisplayedStereoToCenter, getPreferredBondDisplayCenterId } from '../../layout/mol2d-helpers.js';
import { repairImplicitHydrogensWhenValenceImproves } from './implicit-hydrogen-repair.js';
import {
  DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE,
  synthesizeHydrogenPosition
} from '../../layout/engine/stereo/wedge-geometry.js';

const FORCE_RESEAT_HYDROGEN_DISTANCE = 25;
const DEFAULT_2D_BOND_LENGTH = 1.5;

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
    replaceForceHydrogenWithDrawElement
  };
}
