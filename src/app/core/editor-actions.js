/** @module app/core/editor-actions */

export const ReactionPreviewPolicy = Object.freeze({
  preserve: 'preserve',
  block: 'block',
  prepareBondTarget: 'prepare-bond-target',
  prepareEditTargets: 'prepare-edit-targets'
});

export const ResonancePolicy = Object.freeze({
  preserve: 'preserve',
  normalizeForEdit: 'normalize-for-edit'
});

export const SnapshotPolicy = Object.freeze({
  take: 'take',
  skip: 'skip'
});

export const ViewportPolicy = Object.freeze({
  none: 'none',
  restoreEdit: 'restore-edit'
});

export function createEditorActions(deps) {
  function performStructuralEdit(kind, options = {}, mutateFn) {
    const {
      overlayPolicy = ReactionPreviewPolicy.preserve,
      resonancePolicy = ResonancePolicy.normalizeForEdit,
      snapshotPolicy = SnapshotPolicy.take,
      zoomSnapshot = deps.state.viewState.captureZoomTransform?.(),
      reactionPreviewPayload = null,
      reactionEdit: presetReactionEdit = null,
      snapshotOptions = undefined,
      preflight = null
    } = options;

    const mode = deps.state.viewState.getMode();
    let reactionEdit = presetReactionEdit ?? { restored: false };
    let previousSnapshot = reactionEdit?.previousSnapshot ?? null;

    if (overlayPolicy === ReactionPreviewPolicy.block && deps.overlays.hasReactionPreview()) {
      return { performed: false, blockedByOverlay: true, kind, mode };
    }
    if (overlayPolicy === ReactionPreviewPolicy.prepareBondTarget) {
      reactionEdit = deps.overlays.prepareReactionPreviewBondEditTarget(reactionPreviewPayload);
      if (reactionEdit === null) {
        return { performed: false, blockedByOverlay: true, kind, mode };
      }
      previousSnapshot = reactionEdit?.previousSnapshot ?? previousSnapshot;
    } else if (overlayPolicy === ReactionPreviewPolicy.prepareEditTargets) {
      reactionEdit = deps.overlays.prepareReactionPreviewEditTargets(reactionPreviewPayload ?? {});
      if (reactionEdit === null) {
        return { performed: false, blockedByOverlay: true, kind, mode };
      }
      previousSnapshot = reactionEdit?.previousSnapshot ?? previousSnapshot;
    }

    if (!previousSnapshot && resonancePolicy === ResonancePolicy.normalizeForEdit && snapshotPolicy === SnapshotPolicy.take) {
      previousSnapshot = deps.history.captureSnapshot?.() ?? null;
      if (previousSnapshot) {
        reactionEdit = { ...(reactionEdit ?? {}), previousSnapshot };
      }
    }

    let mol = deps.state.documentState.getActiveMolecule();
    let resonanceReset = false;
    if (resonancePolicy === ResonancePolicy.normalizeForEdit) {
      const structuralEdit = deps.overlays.prepareResonanceStructuralEdit(mol);
      mol = structuralEdit.mol ?? deps.state.documentState.getActiveMolecule();
      resonanceReset = !!structuralEdit.resonanceReset;
    }

    if (!mol) {
      return { performed: false, missingMolecule: true, kind, mode };
    }

    const context = {
      kind,
      mode,
      mol,
      zoomSnapshot,
      reactionEdit,
      resonanceReset
    };
    const preflightResult = preflight?.(context);
    if (preflightResult === false || preflightResult?.cancelled) {
      return { performed: false, cancelled: true, kind, mode, reactionEdit, resonanceReset };
    }

    let snapshotTaken = false;
    if (snapshotPolicy === SnapshotPolicy.take) {
      deps.history.takeSnapshot(
        previousSnapshot
          ? {
              clearReactionPreview: false,
              ...snapshotOptions,
              snapshot: previousSnapshot
            }
          : snapshotOptions
      );
      snapshotTaken = true;
    }

    const result = mutateFn(context) ?? {};
    if (result.cancelled) {
      if (snapshotTaken) {
        deps.history.discardLastSnapshot?.();
      }
      return { performed: false, cancelled: true, kind, mode, reactionEdit, resonanceReset };
    }

    deps.state.documentState.setActiveMolecule(mol);

    if (result.clearPrimitiveHover) {
      deps.view.clearPrimitiveHover();
    }
    if (result.suppressDrawBondHover) {
      deps.view.suppressDrawBondHover();
    }

    if (result.syncInput !== false) {
      deps.analysis.syncInputField(mol);
    }
    if (result.updateAnalysis !== false) {
      deps.analysis.updateFormula(mol);
      deps.analysis.updateDescriptors(mol);
      deps.analysis.updatePanels(mol);
    }

    if (mode === 'force') {
      const forceResult = result.force ?? {};
      const aux = forceResult.beforeRender?.(context);
      deps.renderers.updateForce(mol, forceResult.options ?? { preservePositions: true, preserveView: true });
      forceResult.afterRender?.(context, aux);
      if (forceResult.enableKeepInView) {
        deps.view.enableForceKeepInView();
      }
    } else {
      const twoDResult = result.twoD ?? {};
      if (result.sync2dDerived !== false) {
        deps.view.sync2dDerivedState(mol);
      }
      twoDResult.preRender?.(context);
      deps.renderers.draw2d();
      if (options.viewportPolicy === ViewportPolicy.restoreEdit) {
        deps.view.restore2dEditViewport(zoomSnapshot, {
          reactionRestored: reactionEdit?.restored,
          resonanceReset,
          zoomToFit: !!twoDResult.zoomToFit
        });
      }
      twoDResult.postRender?.(context);
    }

    return {
      performed: true,
      kind,
      mode,
      mol,
      reactionEdit,
      resonanceReset,
      result
    };
  }

  return {
    performStructuralEdit
  };
}
