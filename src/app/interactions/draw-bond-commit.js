/** @module app/interactions/draw-bond-commit */

import { ReactionPreviewPolicy } from '../core/editor-actions.js';

export function createDrawBondCommitActions(context) {
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
        srcAtom.x = context.twoD.getCenterX() + (ox - plotWidth / 2) / context.constants.scale;
        srcAtom.y = context.twoD.getCenterY() - (oy - plotHeight / 2) / context.constants.scale;
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
    mol.addBond(null, resolvedId, newAtom.id, { order: 1 }, true);
    const affected = new Set([resolvedId, newAtom.id]);

    if (mode === 'force') {
      const bondLengthPx = 1.5 * forceScale;
      const destGX = srcRX + Math.cos(bestAngle) * bondLengthPx;
      const destGY = srcRY + Math.sin(bestAngle) * bondLengthPx;
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
      context.chemistry.kekulize(mol);
      context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
      mol.repairImplicitHydrogens(affected);
      context.analysis.syncInputField(mol);
      context.analysis.updateFormula(mol);
      context.analysis.updateDescriptors(mol);
      context.analysis.updatePanels(mol);
      context.renderers.updateForce(mol, { preservePositions: true });
      context.force.enableKeepInView();

      const patchPos = new Map([[newAtom.id, { x: destGX, y: destGY }]]);
      patchPos.set(resolvedId, { x: srcRX, y: srcRY });
      context.force.patchNodePositions(patchPos);
      context.force.reseatHydrogensAroundPatched(patchPos);
      return;
    }

    newAtom.x = srcRX + Math.cos(bestAngle) * 1.5;
    newAtom.y = srcRY + Math.sin(bestAngle) * 1.5;

    mol.clearStereoAnnotations(affected);
    context.chemistry.kekulize(mol);
    context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
    mol.repairImplicitHydrogens(affected);
    context.twoD.syncDerivedState(mol);
    context.analysis.syncInputField(mol);
    context.analysis.updateFormula(mol);
    context.analysis.updateDescriptors(mol);
    context.analysis.updatePanels(mol);
    context.renderers.draw2d();
    context.view.restore2dEditViewport(zoomSnapshot, {
      reactionRestored: reactionEdit?.restored,
      resonanceReset: structuralEdit.resonanceReset,
      zoomToFit: true
    });
  }

  function commit() {
    const drawBondState = context.state.getDrawBondState();
    if (!drawBondState) {
      context.preview.cancel();
      return;
    }

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
            zoomSnapshot,
            skipReactionPreviewPrep: true,
            skipResonancePrep: true,
            skipSnapshot: true,
            reactionRestored: reactionEdit?.restored,
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
        mol.addBond(null, resolvedAtomId, snapAtomId, { order: 1 }, true);
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
        mol.addBond(null, resolvedAtomId, newAtom.id, { order: 1 }, true);
        affected = new Set([resolvedAtomId, newAtom.id]);
        patchPos.set(newAtom.id, { x: ex, y: ey });
      }

      mol.clearStereoAnnotations(affected);
      context.chemistry.kekulize(mol);
      context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
      mol.repairImplicitHydrogens(affected);
      context.analysis.syncInputField(mol);
      context.analysis.updateFormula(mol);
      context.analysis.updateDescriptors(mol);
      context.analysis.updatePanels(mol);
      context.renderers.updateForce(mol, { preservePositions: true });
      context.force.enableKeepInView();
      context.force.patchNodePositions(patchPos);
      context.force.reseatHydrogensAroundPatched(patchPos);
      return;
    }

    const mol = structuralEdit.mol ?? context.molecule.ensureActive();
    const { width: plotWidth, height: plotHeight } = context.plot.getSize();
    let affected;

    let resolvedAtomId = atomId;
    if (atomId === null) {
      const newSrc = mol.addAtom(null, context.getDrawBondElement(), {});
      newSrc.x = context.twoD.getCenterX() + (ox - plotWidth / 2) / context.constants.scale;
      newSrc.y = context.twoD.getCenterY() - (oy - plotHeight / 2) / context.constants.scale;
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
          zoomSnapshot,
          skipReactionPreviewPrep: true,
          skipResonancePrep: true,
          skipSnapshot: true,
          reactionRestored: reactionEdit?.restored,
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
      mol.addBond(null, resolvedAtomId, snapAtomId, { order: 1 }, true);
      affected = new Set([resolvedAtomId, snapAtomId]);
    } else {
      const rawAngle = Math.atan2(ey - oy, ex - ox);
      const snapStep = Math.PI / 6;
      const snapped = Math.round(rawAngle / snapStep) * snapStep;
      const bondLength = 1.5;
      const newMolX = srcAtom.x + Math.cos(snapped) * bondLength;
      const newMolY = srcAtom.y - Math.sin(snapped) * bondLength;

      const srcHydrogen = srcAtom.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
      if (srcHydrogen) {
        mol.removeAtom(srcHydrogen.id);
      }

      const newAtom = mol.addAtom(null, context.getDrawBondElement(), {});
      newAtom.x = newMolX;
      newAtom.y = newMolY;
      mol.addBond(null, resolvedAtomId, newAtom.id, { order: 1 }, true);
      affected = new Set([resolvedAtomId, newAtom.id]);
    }

    mol.clearStereoAnnotations(affected);
    context.chemistry.kekulize(mol);
    context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
    mol.repairImplicitHydrogens(affected);
    context.twoD.syncDerivedState(mol);
    context.analysis.syncInputField(mol);
    context.analysis.updateFormula(mol);
    context.analysis.updateDescriptors(mol);
    context.analysis.updatePanels(mol);
    context.renderers.draw2d();
    context.view.restore2dEditViewport(zoomSnapshot, {
      reactionRestored: reactionEdit?.restored,
      resonanceReset: structuralEdit.resonanceReset,
      zoomToFit: true
    });
  }

  return {
    autoPlaceBond,
    commit
  };
}
