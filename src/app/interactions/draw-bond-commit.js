/** @module app/interactions/draw-bond-commit */

import { ReactionPreviewPolicy } from '../core/editor-actions.js';
import { applyDisplayedStereoToCenter, getPreferredBondDisplayCenterId } from '../../layout/mol2d-helpers.js';
import { repairImplicitHydrogensWhenValenceImproves } from './implicit-hydrogen-repair.js';

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

  function findExistingBond(mol, atomIdA, atomIdB) {
    return [...mol.bonds.values()].find(bond => {
      const [a1, a2] = bond.getAtomObjects(mol);
      return (a1?.id === atomIdA && a2?.id === atomIdB) || (a1?.id === atomIdB && a2?.id === atomIdA);
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
      if (mode === 'force') {
        const otherNode = context.force.getNodeById(otherId);
        if (!otherNode) {
          continue;
        }
        existingAngles.push(Math.atan2(otherNode.y - srcRY, otherNode.x - srcRX));
      } else {
        const otherAtom = mol.atoms.get(otherId);
        if (!otherAtom || otherAtom.x == null || otherAtom.visible === false) {
          continue;
        }
        existingAngles.push(Math.atan2(otherAtom.y - srcRY, otherAtom.x - srcRX));
      }
    }

    let bestAngle;
    if (existingAngles.length === 0) {
      bestAngle = (11 / 12) * 2 * Math.PI;
    } else if (existingAngles.length === 1) {
      const back = existingAngles[0];
      const opt1 = back + (2 * Math.PI) / 3;
      const opt2 = back - (2 * Math.PI) / 3;
      const sBack = Math.sin(back);
      const s1 = Math.sin(opt1);
      const s2 = Math.sin(opt2);
      if (Math.abs(sBack) > 1e-6) {
        const ok1 = s1 * sBack > 0;
        const ok2 = s2 * sBack > 0;
        if (ok1 && !ok2) {
          bestAngle = opt1;
        } else if (ok2 && !ok1) {
          bestAngle = opt2;
        } else {
          bestAngle = Math.cos(opt1) >= Math.cos(opt2) ? opt1 : opt2;
        }
      } else {
        bestAngle = s1 <= s2 ? opt1 : opt2;
      }
      bestAngle = ((bestAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    } else {
      bestAngle = 0;
      let bestMinSep = -1;
      for (let i = 0; i < steps; i++) {
        const candidate = (i / steps) * 2 * Math.PI;
        let minSep = Math.PI;
        for (const angle of existingAngles) {
          let diff = Math.abs(candidate - angle);
          if (diff > Math.PI) {
            diff = 2 * Math.PI - diff;
          }
          if (diff < minSep) {
            minSep = diff;
          }
        }
        if (minSep > bestMinSep) {
          bestMinSep = minSep;
          bestAngle = candidate;
        }
      }
    }

    {
      const bondLength = mode === 'force' ? 1.5 * forceScale : 1.5;
      const thresholdSq = (bondLength * 0.7) ** 2;
      const overlaps = angle => {
        const px = srcRX + Math.cos(angle) * bondLength;
        const py = srcRY + Math.sin(angle) * bondLength;
        if (mode === 'force') {
          for (const node of context.force.getNodes()) {
            if (node.id === resolvedId) {
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
            if (id === resolvedId || atom.x == null || atom.visible === false) {
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
            let diff = Math.abs(candidate - angle);
            if (diff > Math.PI) {
              diff = 2 * Math.PI - diff;
            }
            if (diff < minSep) {
              minSep = diff;
            }
          }
          if (minSep > bestSep) {
            bestSep = minSep;
            fallback = candidate;
          }
        }
        bestAngle = fallback;
      }
    }

    const srcHydrogen = srcAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
    if (srcHydrogen) {
      mol.removeAtom(srcHydrogen.id);
    }
    const newAtom = mol.addAtom(null, context.getDrawBondElement(), {});
    const newBond = mol.addBond(null, resolvedId, newAtom.id, { order: 1 }, false);
    _applyBondDrawType(mol, newBond, drawBondType, resolvedId);
    const affected = new Set([resolvedId, newAtom.id]);

    if (mode === 'force') {
      const bondLengthPx = 1.5 * forceScale;
      const angle = forcedAngle !== null ? forcedAngle : bestAngle;
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
      context.renderers.updateForce(mol, {
        preservePositions: true,
        initialPatchPos: patchPos
      });
      context.force.enableKeepInView();
      return;
    }

    newAtom.x = srcRX + Math.cos(bestAngle) * 1.5;
    newAtom.y = srcRY + Math.sin(bestAngle) * 1.5;

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

    if (!dragged || Math.hypot(ex - ox, ey - oy) < 30) {
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
    const previousSnapshot = reactionEdit?.previousSnapshot ?? context.snapshot.capture();
    const structuralEdit = context.overlays.prepareResonanceStructuralEdit(context.molecule.getActive());
    if (snapAtomId !== null) {
      const checkMol = structuralEdit.mol;
      if (checkMol?.atoms.get(snapAtomId)?.name === 'H') {
        restoreReactionPreviewNoOp(reactionEdit);
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
      context.renderers.updateForce(mol, {
        preservePositions: true,
        initialPatchPos: patchPos
      });
      if (reactionEdit?.restored && reactionEdit?.entryZoomTransform) {
        context.view.restoreZoomTransformSnapshot(reactionEdit.entryZoomTransform);
      }
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
      return;
    }

    if (snapAtomId !== null) {
      const destAtom = mol.atoms.get(snapAtomId);
      if (!destAtom) {
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
      const newMolX = context.view2D.getCenterX() + (ex - plotWidth / 2) / context.constants.scale;
      const newMolY = context.view2D.getCenterY() - (ey - plotHeight / 2) / context.constants.scale;

      const srcHydrogen = srcAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
      if (srcHydrogen) {
        mol.removeAtom(srcHydrogen.id);
      }

      const newAtom = mol.addAtom(null, context.getDrawBondElement(), {});
      newAtom.x = newMolX;
      newAtom.y = newMolY;
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
