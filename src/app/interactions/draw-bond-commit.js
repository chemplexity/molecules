/** @module app/interactions/draw-bond-commit */

import { ReactionPreviewPolicy } from '../core/editor-actions.js';
import { applyDisplayedStereoToCenter, getPreferredBondDisplayCenterId } from '../../layout/mol2d-helpers.js';
import { repairImplicitHydrogensWhenValenceImproves } from './implicit-hydrogen-repair.js';
import {
  angularDifference as _angularDifference,
  chooseAutoPlacedBondAngle as _chooseAutoPlacedBondAngle,
  normalizeAngle as _normalizeAngle
} from './draw-bond-placement.js';

const DEFAULT_LAYOUT_BOND_LENGTH = 1.5;

function _currentLayoutBondLength(context) {
  const parsed = Number(context.options?.getRenderOptions?.().layoutBondLength);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LAYOUT_BOND_LENGTH;
}

/**
 * Removes all display-stereo properties (as, centerId, manual) from a bond,
 * deleting the `display` object entirely if it becomes empty.
 * @param {import('../../core/Bond.js').Bond} bond - Bond to clear stereo display on.
 */
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

/**
 * Sets display-stereo type on a bond. Clears stereo if `type` is not
 * `'wedge'` or `'dash'`.
 * @param {import('../../core/Bond.js').Bond} bond - Bond to update.
 * @param {string|null} type - `'wedge'`, `'dash'`, or any other value to clear.
 * @param {object} [options] - Optional stereo placement options.
 * @param {string|null} [options.centerId] - Atom id the wedge/dash originates from.
 * @param {boolean} [options.manual] - Whether the assignment was made manually by the user.
 */
function _setBondDisplayStereo(bond, type, { centerId = null, manual = false } = {}) {
  if (!bond || (type !== 'wedge' && type !== 'dash')) {
    _clearBondDisplayStereo(bond);
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
 * Attempts to resolve and apply an explicit stereo assignment for a wedge/dash
 * bond at the preferred center atom. Returns the resolved stereo result, or
 * `null` if chirality could not be resolved or the bond type is not stereo.
 * @param {import('../../core/Molecule.js').Molecule} mol - Molecule containing the bond.
 * @param {import('../../core/Bond.js').Bond} bond - Newly added bond to assign stereo to.
 * @param {string} drawBondType - Bond draw type (`'wedge'` or `'dash'`).
 * @param {string|null} [preferredCenterId] - Preferred origin atom id for the wedge/dash.
 * @returns {object|null} Resolved stereo result, or `null` if not applicable.
 */
function _tryApplyExplicitStereoAssignment(mol, bond, drawBondType, preferredCenterId = null) {
  if (!mol || !bond || (drawBondType !== 'wedge' && drawBondType !== 'dash')) {
    return null;
  }
  const resolvedPreferredCenterId = getPreferredBondDisplayCenterId(mol, bond.id, preferredCenterId);
  // Only attempt chirality resolution at the origin atom (resolvedPreferredCenterId) to ensure
  // the wedge/dash always originates from the atom the user started dragging from.
  const center = mol.atoms.get(resolvedPreferredCenterId);
  if (typeof center?.getChirality === 'function' && typeof center?.setChirality === 'function') {
    const resolved = applyDisplayedStereoToCenter(mol, resolvedPreferredCenterId, bond.id, drawBondType);
    if (resolved?.type === drawBondType) {
      _setBondDisplayStereo(bond, drawBondType, { centerId: resolvedPreferredCenterId, manual: true });
      return resolved;
    }
  }

  _setBondDisplayStereo(bond, drawBondType, { centerId: resolvedPreferredCenterId, manual: true });
  return null;
}

/**
 * Applies the selected draw type to a bond, setting its order and display-stereo
 * properties accordingly. Clears any prior stereo annotation before applying.
 * @param {import('../../core/Molecule.js').Molecule} mol - Molecule containing the bond.
 * @param {import('../../core/Bond.js').Bond} bond - Bond to update.
 * @param {string} drawBondType - One of `'single'`, `'double'`, `'triple'`, `'aromatic'`, `'wedge'`, `'dash'`.
 * @param {string|null} [preferredCenterId] - Preferred origin atom id for wedge/dash bonds.
 */
function _applyBondDrawType(mol, bond, drawBondType, preferredCenterId = null) {
  if (!bond) {
    return;
  }
  const type = drawBondType ?? 'single';
  _clearBondDisplayStereo(bond);
  bond.setStereo?.(null);
  if (type === 'aromatic') {
    bond.setAromatic(true);
    return;
  }
  if (type === 'double') {
    bond.setOrder(2);
    return;
  }
  if (type === 'triple') {
    bond.setOrder(3);
    return;
  }
  bond.setOrder(1);
  if (type === 'wedge' || type === 'dash') {
    _setBondDisplayStereo(bond, type, {
      centerId: getPreferredBondDisplayCenterId(mol, bond.id, preferredCenterId) ?? preferredCenterId,
      manual: true
    });
  }
}

/**
 * Removes the source hydrogen closest to the new bond direction. This lets
 * explicit hydrogens behave like replaceable valence slots during no-drag bond
 * placement instead of forcing the new bond around a hydrogen that will be
 * deleted.
 * @param {import('../../core/Molecule.js').Molecule} mol - Molecule being edited.
 * @param {object} srcAtom - Source atom object.
 * @param {{x: number, y: number}} sourcePoint - Source atom point in the same coordinate space as `pointForAtom`.
 * @param {number} targetAngle - Chosen new bond angle.
 * @param {(atom: object) => ({x: number, y: number}|null)} pointForAtom - Returns an atom point for angle comparison.
 */
function _removeSourceHydrogenNearestAngle(mol, srcAtom, sourcePoint, targetAngle, pointForAtom) {
  const sourceHydrogens = srcAtom?.getNeighbors?.(mol).filter(neighbor => neighbor.name === 'H') ?? [];
  if (sourceHydrogens.length === 0) {
    return;
  }
  let bestHydrogen = sourceHydrogens[0];
  let bestDeviation = Number.POSITIVE_INFINITY;
  for (const hydrogen of sourceHydrogens) {
    const hydrogenPoint = pointForAtom(hydrogen);
    if (!Number.isFinite(hydrogenPoint?.x) || !Number.isFinite(hydrogenPoint?.y)) {
      continue;
    }
    const hydrogenAngle = Math.atan2(hydrogenPoint.y - sourcePoint.y, hydrogenPoint.x - sourcePoint.x);
    const deviation = _angularDifference(hydrogenAngle, targetAngle);
    if (deviation < bestDeviation) {
      bestDeviation = deviation;
      bestHydrogen = hydrogen;
    }
  }
  mol.removeAtom(bestHydrogen.id);
}

/**
 * Creates draw-bond commit action handlers wired to the provided context.
 * @param {object} context - App context providing state, molecule, view, history,
 *   overlay, snapshot, chemistry, analysis, renderer, and force sub-objects.
 * @returns {{ autoPlaceBond: (atomId: string|null, ox: number, oy: number) => void, commit: () => void }} The result object.
 *   Action handlers for auto-placing a bond and committing a drag-drawn bond.
 */
export function createDrawBondCommitActions(context) {
  function clearSelectionBeforeStructuralDraw() {
    context.selection?.clearSelection?.();
  }

  function clearPreviewState() {
    context.preview.clearArtifacts();
    context.state.setDrawBondState(null);
    context.view.clearPrimitiveHover();
    context.view.setDrawBondHoverSuppressed(true);
  }

  function restoreReactionPreviewNoOp(reactionEdit) {
    if (!reactionEdit?.restored || !reactionEdit.previousSnapshot) {
      return;
    }
    context.snapshot.restore(reactionEdit.previousSnapshot);
  }

  function restoreEditNoOp(reactionEdit, structuralEdit, previousSnapshot) {
    if ((reactionEdit?.restored || structuralEdit?.resonanceReset) && previousSnapshot) {
      context.snapshot.restore(previousSnapshot);
      return;
    }
    restoreReactionPreviewNoOp(reactionEdit);
  }

  function isEditablePreviewAtomId(atomId) {
    return atomId === null || context.overlays.isReactionPreviewEditableAtomId?.(atomId) !== false;
  }

  function sourceForceInitialPatch(mol) {
    if (context.getMode() !== 'force' || !mol?.atoms?.size) {
      return null;
    }
    const patch = new Map();
    for (const node of context.force.getNodes?.() ?? []) {
      const atom = mol.atoms.get(node?.id);
      if (!atom || atom.name === 'H' || atom.visible === false || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        continue;
      }
      patch.set(node.id, { x: node.x, y: node.y });
    }
    return patch.size > 0 ? patch : null;
  }

  function forceDrawRenderOptions(structuralEdit, options = {}) {
    const reactionRestored = options.reactionRestored === true;
    if (structuralEdit?.resonanceReset || reactionRestored) {
      const sourcePatch = sourceForceInitialPatch(structuralEdit.mol);
      const initialPatchPos = sourcePatch || options.initialPatchPos ? new Map([...(sourcePatch ?? []), ...(options.initialPatchPos ?? [])]) : undefined;
      const { reactionRestored: _reactionRestored, ...renderOptions } = options;
      return {
        preservePositions: structuralEdit?.resonanceReset ? false : !reactionRestored,
        preserveView: false,
        ...renderOptions,
        ...(initialPatchPos ? { initialPatchPos } : {})
      };
    }
    return {
      preservePositions: true,
      ...options
    };
  }

  function findExistingBond(mol, atomIdA, atomIdB) {
    return [...mol.bonds.values()].find(bond => {
      const [a1, a2] = bond.getAtomObjects(mol);
      return (a1?.id === atomIdA && a2?.id === atomIdB) || (a1?.id === atomIdB && a2?.id === atomIdA);
    });
  }

  function moleculePointFromViewportPoint(mol, mode, x, y) {
    const { width: plotWidth, height: plotHeight } = context.plot.getSize();
    if (mode === 'force') {
      const forceScale = context.constants.forceScale;
      let cx2d = 0;
      let cy2d = 0;
      let count = 0;
      for (const [, atom] of mol.atoms) {
        if (atom.x != null) {
          cx2d += atom.x;
          cy2d += atom.y;
          count++;
        }
      }
      if (count > 0) {
        cx2d /= count;
        cy2d /= count;
      }
      return {
        x: cx2d + (x - plotWidth / 2) / forceScale,
        y: cy2d - (y - plotHeight / 2) / forceScale
      };
    }
    return {
      x: context.view2D.getCenterX() + (x - plotWidth / 2) / context.constants.scale,
      y: context.view2D.getCenterY() - (y - plotHeight / 2) / context.constants.scale
    };
  }

  function dragged2dEndpointForEdit(srcAtom, { ox, oy, ex, ey, resonanceReset = false, atomId = null } = {}) {
    const endPoint = moleculePointFromViewportPoint(null, '2d', ex, ey);
    if (!resonanceReset || atomId === null || !Number.isFinite(srcAtom?.x) || !Number.isFinite(srcAtom?.y)) {
      return endPoint;
    }
    const startPoint = moleculePointFromViewportPoint(null, '2d', ox, oy);
    return {
      x: srcAtom.x + (endPoint.x - startPoint.x),
      y: srcAtom.y + (endPoint.y - startPoint.y)
    };
  }

  function placeStandaloneAtom(ox, oy) {
    const mode = context.getMode();
    const zoomSnapshot = mode === '2d' ? context.view.captureZoomTransform() : null;
    const reactionEdit = context.overlays.prepareReactionPreviewEditTargets({ atomId: null });
    if (reactionEdit === null) {
      return;
    }
    const previousSnapshot = reactionEdit?.previousSnapshot ?? context.snapshot.capture();
    const structuralEdit = context.overlays.prepareResonanceStructuralEdit(context.molecule.getActive());
    context.history.takeSnapshot(
      previousSnapshot
        ? {
            clearReactionPreview: false,
            snapshot: previousSnapshot
          }
        : undefined
    );
    const mol = structuralEdit.mol ?? context.molecule.ensureActive();
    const newAtom = mol.addAtom(null, context.getDrawBondElement(), {});
    const point = moleculePointFromViewportPoint(mol, mode, ox, oy);
    newAtom.x = point.x;
    newAtom.y = point.y;
    mol.repairImplicitHydrogens?.([newAtom.id]);

    context.analysis.syncInputField(mol);
    context.analysis.updateFormula(mol);
    context.analysis.updateDescriptors(mol);
    context.analysis.updatePanels(mol);
    clearSelectionBeforeStructuralDraw();

    if (mode === 'force') {
      context.renderers.updateForce(mol, {
        ...forceDrawRenderOptions(structuralEdit, {
          reactionRestored: reactionEdit?.restored,
          initialPatchPos: new Map([[newAtom.id, { x: ox, y: oy }]])
        })
      });
      context.force.enableKeepInView();
      return;
    }

    context.view2D.syncDerivedState(mol);
    context.renderers.draw2d();
    context.view.restore2dEditViewport(zoomSnapshot, {
      reactionRestored: reactionEdit?.restored,
      reactionEntryZoomSnapshot: reactionEdit?.entryZoomTransform ?? null,
      resonanceReset: structuralEdit.resonanceReset
    });
  }

  function autoPlaceBond(atomId, ox, oy) {
    const drawBondType = context.getDrawBondType?.() ?? 'single';
    const mode = context.getMode();
    const zoomSnapshot = mode === '2d' ? context.view.captureZoomTransform() : null;
    const reactionEdit = context.overlays.prepareReactionPreviewEditTargets({ atomId });
    if (reactionEdit === null) {
      return;
    }
    atomId = reactionEdit?.atomId ?? atomId;
    const previousSnapshot = reactionEdit?.previousSnapshot ?? context.snapshot.capture();
    const structuralEdit = context.overlays.prepareResonanceStructuralEdit(context.molecule.getActive());
    context.history.takeSnapshot(
      previousSnapshot
        ? {
            clearReactionPreview: false,
            snapshot: previousSnapshot
          }
        : undefined
    );
    const mol = structuralEdit.mol ?? context.molecule.ensureActive();

    const forceScale = context.constants.forceScale;
    const layoutBondLength = _currentLayoutBondLength(context);
    const steps = 12;
    const { width: plotWidth, height: plotHeight } = context.plot.getSize();

    let srcAtom;
    let resolvedId;
    if (atomId === null) {
      srcAtom = mol.addAtom(null, context.getDrawBondElement(), {});
      if (mode === 'force') {
        let cx2d = 0;
        let cy2d = 0;
        let count = 0;
        for (const [, atom] of mol.atoms) {
          if (atom.x != null) {
            cx2d += atom.x;
            cy2d += atom.y;
            count++;
          }
        }
        if (count > 0) {
          cx2d /= count;
          cy2d /= count;
        }
        srcAtom.x = cx2d + (ox - plotWidth / 2) / forceScale;
        srcAtom.y = cy2d - (oy - plotHeight / 2) / forceScale;
      } else {
        srcAtom.x = context.view2D.getCenterX() + (ox - plotWidth / 2) / context.constants.scale;
        srcAtom.y = context.view2D.getCenterY() - (oy - plotHeight / 2) / context.constants.scale;
      }
      resolvedId = srcAtom.id;
    } else {
      srcAtom = mol.atoms.get(atomId);
      if (!srcAtom) {
        return;
      }
      resolvedId = atomId;
    }

    let srcRX;
    let srcRY;
    if (mode === 'force') {
      const srcNode = context.force.getNodeById(resolvedId);
      srcRX = srcNode ? srcNode.x : ox;
      srcRY = srcNode ? srcNode.y : oy;
    } else {
      srcRX = srcAtom.x;
      srcRY = srcAtom.y;
    }

    // When atomId is an existing atom and ox,oy is meaningfully distant from it (e.g.
    // redirected from an H-click in wedge/dash mode), treat ox,oy as the preferred
    // direction rather than picking the most-open angle from existing bonds.
    let forcedAngle = null;
    if (mode === 'force' && atomId !== null && Number.isFinite(srcRX) && Number.isFinite(srcRY)) {
      const ddx = ox - srcRX;
      const ddy = oy - srcRY;
      if (Math.hypot(ddx, ddy) > 5) {
        forcedAngle = Math.atan2(ddy, ddx);
      }
    }

    const existingAngles = [];
    for (const bondId of srcAtom.bonds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherId = bond.getOtherAtom(resolvedId);
      const otherAtom = mol.atoms.get(otherId);
      if (!otherAtom || otherAtom.name === 'H') {
        continue;
      }
      if (mode === 'force') {
        const otherNode = context.force.getNodeById(otherId);
        if (!otherNode) {
          continue;
        }
        existingAngles.push(Math.atan2(otherNode.y - srcRY, otherNode.x - srcRX));
      } else {
        if (!otherAtom || otherAtom.x == null || otherAtom.visible === false) {
          continue;
        }
        existingAngles.push(Math.atan2(otherAtom.y - srcRY, otherAtom.x - srcRX));
      }
    }

    let bestAngle = _chooseAutoPlacedBondAngle(existingAngles, steps);

    {
      const bondLength = mode === 'force' ? layoutBondLength * forceScale : layoutBondLength;
      const thresholdSq = (bondLength * 0.7) ** 2;
      const sourceHydrogenIds = new Set(srcAtom.getNeighbors(mol).filter(neighbor => neighbor.name === 'H').map(neighbor => neighbor.id));
      const overlaps = angle => {
        const px = srcRX + Math.cos(angle) * bondLength;
        const py = srcRY + Math.sin(angle) * bondLength;
        if (mode === 'force') {
          for (const node of context.force.getNodes()) {
            if (node.id === resolvedId || sourceHydrogenIds.has(node.id)) {
              continue;
            }
            const dx = node.x - px;
            const dy = node.y - py;
            if (dx * dx + dy * dy < thresholdSq) {
              return true;
            }
          }
        } else {
          for (const [id, atom] of mol.atoms) {
            if (id === resolvedId || sourceHydrogenIds.has(id) || atom.x == null || atom.visible === false) {
              continue;
            }
            const dx = atom.x - px;
            const dy = atom.y - py;
            if (dx * dx + dy * dy < thresholdSq) {
              return true;
            }
          }
        }
        return false;
      };
      if (overlaps(bestAngle)) {
        let fallback = bestAngle;
        let bestSep = -1;
        for (let i = 0; i < steps; i++) {
          const candidate = (i / steps) * 2 * Math.PI;
          if (overlaps(candidate)) {
            continue;
          }
          let minSep = Math.PI;
          for (const angle of existingAngles) {
            minSep = Math.min(minSep, _angularDifference(candidate, angle));
          }
          if (minSep > bestSep) {
            bestSep = minSep;
            fallback = candidate;
          }
        }
        bestAngle = fallback;
      }
    }

    const newAtom = mol.addAtom(null, context.getDrawBondElement(), {});
    const newBond = mol.addBond(null, resolvedId, newAtom.id, { order: 1 }, false);
    _applyBondDrawType(mol, newBond, drawBondType, resolvedId);
    const affected = new Set([resolvedId, newAtom.id]);

    if (mode === 'force') {
      const bondLengthPx = layoutBondLength * forceScale;
      const angle = forcedAngle !== null ? forcedAngle : bestAngle;
      _removeSourceHydrogenNearestAngle(
        mol,
        srcAtom,
        { x: srcRX, y: srcRY },
        angle,
        atom => context.force.getNodeById(atom.id) ?? (Number.isFinite(atom.x) && Number.isFinite(atom.y) ? { x: atom.x, y: atom.y } : null)
      );
      const destGX = srcRX + Math.cos(angle) * bondLengthPx;
      const destGY = srcRY + Math.sin(angle) * bondLengthPx;
      const patchPos = new Map([[newAtom.id, { x: destGX, y: destGY }]]);
      patchPos.set(resolvedId, { x: srcRX, y: srcRY });
      let cx2d = 0;
      let cy2d = 0;
      let count = 0;
      for (const [, atom] of mol.atoms) {
        if (atom.x != null) {
          cx2d += atom.x;
          cy2d += atom.y;
          count++;
        }
      }
      if (count > 0) {
        cx2d /= count;
        cy2d /= count;
      }
      newAtom.x = cx2d + (destGX - plotWidth / 2) / forceScale;
      newAtom.y = cy2d - (destGY - plotHeight / 2) / forceScale;

      mol.clearStereoAnnotations(affected);
      if (drawBondType !== 'aromatic') {
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
      }
      repairImplicitHydrogensWhenValenceImproves(mol, affected);
      _tryApplyExplicitStereoAssignment(mol, newBond, drawBondType, resolvedId);
      context.analysis.syncInputField(mol);
      context.analysis.updateFormula(mol);
      context.analysis.updateDescriptors(mol);
      context.analysis.updatePanels(mol);
      context.renderers.updateForce(mol, forceDrawRenderOptions(structuralEdit, { reactionRestored: reactionEdit?.restored, initialPatchPos: patchPos }));
      context.force.enableKeepInView();
      return;
    }

    _removeSourceHydrogenNearestAngle(mol, srcAtom, { x: srcRX, y: srcRY }, bestAngle, atom =>
      Number.isFinite(atom.x) && Number.isFinite(atom.y) ? { x: atom.x, y: atom.y } : null
    );
    newAtom.x = srcRX + Math.cos(bestAngle) * layoutBondLength;
    newAtom.y = srcRY + Math.sin(bestAngle) * layoutBondLength;

    mol.clearStereoAnnotations(affected);
    if (drawBondType !== 'aromatic') {
      context.chemistry.kekulize(mol);
      context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
    }
    repairImplicitHydrogensWhenValenceImproves(mol, affected);
    _tryApplyExplicitStereoAssignment(mol, newBond, drawBondType, resolvedId);
    context.view2D.syncDerivedState(mol);
    context.analysis.syncInputField(mol);
    context.analysis.updateFormula(mol);
    context.analysis.updateDescriptors(mol);
    context.analysis.updatePanels(mol);
    clearSelectionBeforeStructuralDraw();
    context.renderers.draw2d();
    context.view.restore2dEditViewport(zoomSnapshot, {
      reactionRestored: reactionEdit?.restored,
      reactionEntryZoomSnapshot: reactionEdit?.entryZoomTransform ?? null,
      resonanceReset: structuralEdit.resonanceReset
    });
  }

  function commit() {
    const drawBondState = context.state.getDrawBondState();
    if (!drawBondState) {
      context.preview.cancel();
      return;
    }
    const drawBondType = context.getDrawBondType?.() ?? 'single';

    const mode = context.getMode();
    const zoomSnapshot = mode === '2d' ? context.view.captureZoomTransform() : null;
    let { atomId, snapAtomId } = drawBondState;
    const { ox, oy, ex, ey, dragged } = drawBondState;
    const dragDistance = Math.hypot(ex - ox, ey - oy);

    if (!dragged || (snapAtomId === null && dragDistance < 30)) {
      clearPreviewState();

      if (atomId !== null) {
        const reactionEdit = context.overlays.prepareReactionPreviewEditTargets({ atomId });
        if (reactionEdit === null) {
          return;
        }
        atomId = reactionEdit.atomId;
        const mol = context.molecule.getActive();
        const clickedAtom = mol?.atoms.get(atomId);
        if (clickedAtom && clickedAtom.name !== context.getDrawBondElement()) {
          context.actions.changeAtomElements([atomId], context.getDrawBondElement(), {
            zoomSnapshot,
            overlayPolicy: ReactionPreviewPolicy.preserve,
            reactionEdit
          });
          return;
        }
      }

      if (atomId === null) {
        placeStandaloneAtom(ox, oy);
        return;
      }

      autoPlaceBond(atomId, ox, oy);
      return;
    }

    clearPreviewState();

    const reactionEdit = context.overlays.prepareReactionPreviewEditTargets({
      atomId,
      snapAtomId
    });
    if (reactionEdit === null) {
      return;
    }
    atomId = reactionEdit.atomId;
    snapAtomId = reactionEdit.snapAtomId;
    if (!isEditablePreviewAtomId(atomId) || !isEditablePreviewAtomId(snapAtomId)) {
      restoreReactionPreviewNoOp(reactionEdit);
      return;
    }
    const previousSnapshot = reactionEdit?.previousSnapshot ?? context.snapshot.capture();
    const structuralEdit = context.overlays.prepareResonanceStructuralEdit(context.molecule.getActive());
    if (snapAtomId !== null) {
      const checkMol = structuralEdit.mol;
      const snapAtom = checkMol?.atoms.get(snapAtomId);
      if (!snapAtom || snapAtom.name === 'H') {
        restoreEditNoOp(reactionEdit, structuralEdit, previousSnapshot);
        return;
      }
    }

    context.history.takeSnapshot(
      previousSnapshot
        ? {
            clearReactionPreview: false,
            snapshot: previousSnapshot
          }
        : undefined
    );

    if (mode === 'force') {
      const mol = structuralEdit.mol ?? context.molecule.ensureActive();
      const { width: plotWidth, height: plotHeight } = context.plot.getSize();
      const forceScale = context.constants.forceScale;

      let cx2d = 0;
      let cy2d = 0;
      let count = 0;
      for (const [, atom] of mol.atoms) {
        if (atom.x != null) {
          cx2d += atom.x;
          cy2d += atom.y;
          count++;
        }
      }
      if (count > 0) {
        cx2d /= count;
        cy2d /= count;
      }

      let resolvedAtomId = atomId;
      if (atomId === null) {
        const newSrc = mol.addAtom(null, context.getDrawBondElement(), {});
        newSrc.x = cx2d + (ox - plotWidth / 2) / forceScale;
        newSrc.y = cy2d - (oy - plotHeight / 2) / forceScale;
        resolvedAtomId = newSrc.id;
      }
      const srcAtom = mol.atoms.get(resolvedAtomId);
      if (!srcAtom) {
        restoreEditNoOp(reactionEdit, structuralEdit, previousSnapshot);
        return;
      }
      let affected;
      let newBond = null;

      const patchPos = new Map();
      if (atomId === null) {
        patchPos.set(resolvedAtomId, { x: ox, y: oy });
      } else {
        const srcNode = context.force.getNodeById(resolvedAtomId);
        if (srcNode) {
          patchPos.set(resolvedAtomId, { x: srcNode.x, y: srcNode.y });
        }
      }

      if (snapAtomId !== null) {
        const destAtom = mol.atoms.get(snapAtomId);
        if (!destAtom) {
          restoreEditNoOp(reactionEdit, structuralEdit, previousSnapshot);
          return;
        }
        const existingBond = findExistingBond(mol, resolvedAtomId, snapAtomId);
        if (existingBond) {
          context.actions.promoteBondOrder(existingBond.id, {
            drawBondType,
            preferredCenterId: resolvedAtomId,
            zoomSnapshot,
            skipReactionPreviewPrep: true,
            skipResonancePrep: true,
            skipSnapshot: true,
            reactionRestored: reactionEdit?.restored,
            reactionEntryZoomSnapshot: reactionEdit?.entryZoomTransform ?? null,
            resonanceReset: structuralEdit.resonanceReset
          });
          return;
        }
        const srcHydrogen = srcAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
        if (srcHydrogen) {
          mol.removeAtom(srcHydrogen.id);
        }
        const destHydrogen = destAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
        if (destHydrogen) {
          mol.removeAtom(destHydrogen.id);
        }
        newBond = mol.addBond(null, resolvedAtomId, snapAtomId, { order: 1 }, false);
        _applyBondDrawType(mol, newBond, drawBondType, resolvedAtomId);
        affected = new Set([resolvedAtomId, snapAtomId]);
        const snapNode = context.force.getNodeById(snapAtomId);
        if (snapNode) {
          patchPos.set(snapAtomId, { x: snapNode.x, y: snapNode.y });
        }
      } else {
        const srcHydrogen = srcAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
        if (srcHydrogen) {
          mol.removeAtom(srcHydrogen.id);
        }
        const newAtom = mol.addAtom(null, context.getDrawBondElement(), {});
        newAtom.x = cx2d + (ex - plotWidth / 2) / forceScale;
        newAtom.y = cy2d - (ey - plotHeight / 2) / forceScale;
        newBond = mol.addBond(null, resolvedAtomId, newAtom.id, { order: 1 }, false);
        _applyBondDrawType(mol, newBond, drawBondType, resolvedAtomId);
        affected = new Set([resolvedAtomId, newAtom.id]);
        patchPos.set(newAtom.id, { x: ex, y: ey });
      }

      mol.clearStereoAnnotations(affected);
      if (drawBondType !== 'aromatic') {
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
      }
      repairImplicitHydrogensWhenValenceImproves(mol, affected);
      if (newBond) {
        _tryApplyExplicitStereoAssignment(mol, newBond, drawBondType, resolvedAtomId);
      }
      context.analysis.syncInputField(mol);
      context.analysis.updateFormula(mol);
      context.analysis.updateDescriptors(mol);
      context.analysis.updatePanels(mol);
      context.renderers.updateForce(mol, forceDrawRenderOptions(structuralEdit, { reactionRestored: reactionEdit?.restored, initialPatchPos: patchPos }));
      context.force.enableKeepInView();
      return;
    }

    const mol = structuralEdit.mol ?? context.molecule.ensureActive();
    const { width: plotWidth, height: plotHeight } = context.plot.getSize();
    let affected;
    let newBond = null;

    let resolvedAtomId = atomId;
    if (atomId === null) {
      const newSrc = mol.addAtom(null, context.getDrawBondElement(), {});
      newSrc.x = context.view2D.getCenterX() + (ox - plotWidth / 2) / context.constants.scale;
      newSrc.y = context.view2D.getCenterY() - (oy - plotHeight / 2) / context.constants.scale;
      resolvedAtomId = newSrc.id;
    }
    const srcAtom = mol.atoms.get(resolvedAtomId);
    if (!srcAtom) {
      restoreEditNoOp(reactionEdit, structuralEdit, previousSnapshot);
      return;
    }

    if (snapAtomId !== null) {
      const destAtom = mol.atoms.get(snapAtomId);
      if (!destAtom) {
        restoreEditNoOp(reactionEdit, structuralEdit, previousSnapshot);
        return;
      }
      const existingBond = findExistingBond(mol, resolvedAtomId, snapAtomId);
      if (existingBond) {
        context.actions.promoteBondOrder(existingBond.id, {
          drawBondType,
          preferredCenterId: resolvedAtomId,
          zoomSnapshot,
          skipReactionPreviewPrep: true,
          skipResonancePrep: true,
          skipSnapshot: true,
          reactionRestored: reactionEdit?.restored,
          reactionEntryZoomSnapshot: reactionEdit?.entryZoomTransform ?? null,
          resonanceReset: structuralEdit.resonanceReset
        });
        return;
      }

      const srcHydrogen = srcAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
      if (srcHydrogen) {
        mol.removeAtom(srcHydrogen.id);
      }
      const destHydrogen = destAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
      if (destHydrogen) {
        mol.removeAtom(destHydrogen.id);
      }
      newBond = mol.addBond(null, resolvedAtomId, snapAtomId, { order: 1 }, false);
      _applyBondDrawType(mol, newBond, drawBondType, resolvedAtomId);
      affected = new Set([resolvedAtomId, snapAtomId]);
    } else {
      const endpoint = dragged2dEndpointForEdit(srcAtom, {
        ox,
        oy,
        ex,
        ey,
        resonanceReset: structuralEdit.resonanceReset,
        atomId
      });

      const srcHydrogen = srcAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
      if (srcHydrogen) {
        mol.removeAtom(srcHydrogen.id);
      }

      const newAtom = mol.addAtom(null, context.getDrawBondElement(), {});
      newAtom.x = endpoint.x;
      newAtom.y = endpoint.y;
      newBond = mol.addBond(null, resolvedAtomId, newAtom.id, { order: 1 }, false);
      _applyBondDrawType(mol, newBond, drawBondType, resolvedAtomId);
      affected = new Set([resolvedAtomId, newAtom.id]);
    }

    mol.clearStereoAnnotations(affected);
    if (drawBondType !== 'aromatic') {
      context.chemistry.kekulize(mol);
      context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
    }
    repairImplicitHydrogensWhenValenceImproves(mol, affected);
    if (newBond) {
      _tryApplyExplicitStereoAssignment(mol, newBond, drawBondType, resolvedAtomId);
    }
    context.view2D.syncDerivedState(mol);
    context.analysis.syncInputField(mol);
    context.analysis.updateFormula(mol);
    context.analysis.updateDescriptors(mol);
    context.analysis.updatePanels(mol);
    clearSelectionBeforeStructuralDraw();
    context.renderers.draw2d();
    context.view.restore2dEditViewport(zoomSnapshot, {
      reactionRestored: reactionEdit?.restored,
      reactionEntryZoomSnapshot: reactionEdit?.entryZoomTransform ?? null,
      resonanceReset: structuralEdit.resonanceReset
    });
  }

  return {
    autoPlaceBond,
    commit
  };
}
