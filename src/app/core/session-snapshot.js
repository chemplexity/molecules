/** @module app/core/session-snapshot */

export function createSessionSnapshotManager(deps) {
  function legacySnapshotFromAppSnapshot(snapshot) {
    if (!snapshot?.documentState && !snapshot?.viewState && !snapshot?.overlayState) {
      return snapshot;
    }
    if (snapshot.empty || snapshot.documentState?.empty) {
      return {
        empty: true,
        mode: snapshot.mode ?? snapshot.documentState?.mode ?? snapshot.viewState?.mode ?? deps.getMode(),
        currentSmiles: snapshot.documentState?.currentSmiles ?? null,
        currentInchi: snapshot.documentState?.currentInchi ?? null,
        inputMode: snapshot.documentState?.inputMode ?? null,
        inputValue: snapshot.documentState?.inputValue ?? null,
        zoomTransform: snapshot.viewState?.zoomTransform ?? null,
        rotationDeg: snapshot.viewState?.rotationDeg ?? 0,
        flipH: snapshot.viewState?.flipH ?? false,
        flipV: snapshot.viewState?.flipV ?? false,
        selectedAtomIds: snapshot.interactionState?.selectedAtomIds ?? [],
        selectedBondIds: snapshot.interactionState?.selectedBondIds ?? [],
        toolMode: snapshot.interactionState?.toolMode ?? 'pan',
        drawBondElement: snapshot.interactionState?.drawBondElement ?? 'C',
        forceAutoFitEnabled: snapshot.interactionState?.forceAutoFitEnabled ?? true,
        forceKeepInView: snapshot.interactionState?.forceKeepInView ?? false,
        forceKeepInViewTicks: snapshot.interactionState?.forceKeepInViewTicks ?? 0,
        highlightState: snapshot.highlightState ?? null,
        panelState: snapshot.panelState ?? null,
        reactionPreview: snapshot.overlayState?.reactionPreview ?? null,
        resonanceView: snapshot.overlayState?.resonanceView ?? null
      };
    }
    const molecule = snapshot.documentState?.molecule ?? {};
    return {
      mode: snapshot.mode ?? snapshot.documentState?.mode ?? snapshot.viewState?.mode ?? deps.getMode(),
      atoms: molecule.atoms ?? [],
      bonds: molecule.bonds ?? [],
      moleculeProperties: molecule.moleculeProperties ?? {},
      currentSmiles: snapshot.documentState?.currentSmiles ?? null,
      currentInchi: snapshot.documentState?.currentInchi ?? null,
      inputMode: snapshot.documentState?.inputMode ?? null,
      inputValue: snapshot.documentState?.inputValue ?? null,
      cx2d: snapshot.viewState?.cx2d ?? 0,
      cy2d: snapshot.viewState?.cy2d ?? 0,
      hCounts2d: snapshot.viewState?.hCounts2d ?? [],
      stereoMap2d: snapshot.viewState?.stereoMap2d ?? null,
      nodePositions: snapshot.viewState?.nodePositions ?? null,
      zoomTransform: snapshot.viewState?.zoomTransform ?? null,
      rotationDeg: snapshot.viewState?.rotationDeg ?? 0,
      flipH: snapshot.viewState?.flipH ?? false,
      flipV: snapshot.viewState?.flipV ?? false,
      selectedAtomIds: snapshot.interactionState?.selectedAtomIds ?? [],
      selectedBondIds: snapshot.interactionState?.selectedBondIds ?? [],
      toolMode: snapshot.interactionState?.toolMode ?? 'pan',
      drawBondElement: snapshot.interactionState?.drawBondElement ?? 'C',
      forceAutoFitEnabled: snapshot.interactionState?.forceAutoFitEnabled ?? true,
      forceKeepInView: snapshot.interactionState?.forceKeepInView ?? false,
      forceKeepInViewTicks: snapshot.interactionState?.forceKeepInViewTicks ?? 0,
      highlightState: snapshot.highlightState ?? null,
      panelState: snapshot.panelState ?? null,
      reactionPreview: snapshot.overlayState?.reactionPreview ?? null,
      resonanceView: snapshot.overlayState?.resonanceView ?? null
    };
  }

  function buildSnapshotMol(data) {
    if (!data) {
      return null;
    }
    const built = new deps.Molecule();
    for (const atomData of data.atoms ?? []) {
      const atom = built.addAtom(atomData.id, atomData.name, { ...atomData.properties });
      atom.x = atomData.x;
      atom.y = atomData.y;
      if (atomData.visible !== undefined) {
        atom.visible = atomData.visible;
      }
    }
    for (const bondData of data.bonds ?? []) {
      built.addBond(bondData.id, bondData.atoms[0], bondData.atoms[1], { ...bondData.properties }, false);
    }
    if (data.moleculeProperties) {
      built.properties = {
        ...built.properties,
        ...data.moleculeProperties
      };
    }
    return built;
  }

  function cloneSnapshotSourceMol(snapshotMol) {
    if (!snapshotMol) {
      return null;
    }
    return buildSnapshotMol(snapshotMol);
  }

  function capture(options = {}) {
    const documentOverrides = options.documentState ?? {};
    const activeMol = deps.getActiveMolecule();
    const reactionPreview = deps.captureReactionPreviewSnapshot();
    const resonanceUndo = reactionPreview ? { mol: activeMol, resonanceView: null } : deps.prepareResonanceUndoSnapshot(activeMol);
    const snapshotMol = reactionPreview?.sourceMol ? reactionPreview.sourceMol : deps.serializeSnapshotMol(resonanceUndo.mol);
    const documentState = activeMol
      ? {
          mode: deps.getMode(),
          molecule: snapshotMol,
          currentSmiles: documentOverrides.currentSmiles ?? deps.getCurrentSmiles(),
          currentInchi: documentOverrides.currentInchi ?? deps.getCurrentInchi(),
          inputMode: documentOverrides.inputMode ?? deps.getInputMode(),
          inputValue: documentOverrides.inputValue ?? deps.getInputValue()
        }
      : {
          empty: true,
          mode: deps.getMode(),
          currentSmiles: documentOverrides.currentSmiles ?? deps.getCurrentSmiles(),
          currentInchi: documentOverrides.currentInchi ?? deps.getCurrentInchi(),
          inputMode: documentOverrides.inputMode ?? deps.getInputMode(),
          inputValue: documentOverrides.inputValue ?? deps.getInputValue()
        };

    return {
      empty: !!documentState.empty,
      mode: deps.getMode(),
      documentState,
      viewState: deps.captureViewState(),
      interactionState: deps.captureInteractionState(),
      highlightState: deps.captureHighlightState(),
      panelState: deps.capturePanelState(),
      overlayState: {
        reactionPreview,
        resonanceView: null
      }
    };
  }

  function restore(snapshot) {
    const snap = legacySnapshotFromAppSnapshot(snapshot);
    if (snap.mode && deps.getMode() !== snap.mode) {
      deps.setMode(snap.mode);
      deps.updateModeChrome(snap.mode);
    }
    deps.setRotationDeg(snap.rotationDeg ?? 0);
    deps.setFlipH(!!snap.flipH);
    deps.setFlipV(!!snap.flipV);
    deps.clearReactionPreviewState();

    if (snap.empty) {
      deps.clearForceState();
      deps.clear2dState();
      deps.setCurrentSmiles(snap.currentSmiles ?? null);
      deps.setCurrentInchi(snap.currentInchi ?? null);
      if (snap.inputMode) {
        deps.setInputFormat(snap.inputMode, {
          preserveInput: true,
          inputValue: snap.inputValue ?? ''
        });
      }
      deps.setCurrentMol(null);
      deps.setMol2d(null);
      deps.clearAnalysisState();
      deps.clearHighlightState();
      deps.restorePanelState(snap.panelState ?? null);
      deps.restoreInteractionState(snap);
      deps.restoreZoomTransform(snap.zoomTransform);
      return;
    }

    if (snap.mode === '2d') {
      deps.clearForceState();
    } else if (snap.mode === 'force') {
      deps.clear2dState();
    }

    const snapshotMolData = snap.reactionPreview?.sourceMol ?? {
      atoms: snap.atoms,
      bonds: snap.bonds,
      moleculeProperties: snap.moleculeProperties
    };
    const previewDisplayMolData = snap.reactionPreview?.displayMol ?? null;

    const mol = buildSnapshotMol(snapshotMolData);
    const displayMol = buildSnapshotMol(previewDisplayMolData) ?? mol.clone();
    const inputSyncMol = mol.clone();

    if (snap.mode === '2d') {
      deps.restoreReactionPreviewSnapshot(snap.reactionPreview ?? null);
      deps.restore2dState(displayMol, snap);
    } else {
      deps.restoreReactionPreviewSnapshot(snap.reactionPreview ?? null);
      deps.restoreForceState(displayMol, snap);
    }

    deps.updateFormula(mol);
    deps.updateDescriptors(mol);
    deps.updateAnalysisPanels(mol, { recomputeResonance: true });

    if (snap.reactionPreview) {
      if (previewDisplayMolData) {
        deps.updateReactionTemplatesPanel();
        deps.restorePersistentHighlight();
        deps.restoreZoomTransform(snap.zoomTransform);
      } else {
        const reapplied = deps.reapplyActiveReactionPreview();
        if (reapplied) {
          deps.restoreZoomTransform(snap.zoomTransform);
        }
      }
    }

    const restoredResonanceView = deps.restoreResonanceViewSnapshot(mol, snap.resonanceView ?? null);
    if (restoredResonanceView) {
      deps.redrawRestoredResonanceView(mol, snap);
    }

    deps.restorePanelState(snap.panelState ?? null);
    const restoredPhyschemHighlight = deps.restorePhyschemHighlightSnapshot(snap.highlightState?.physchem ?? null);
    const restoredFunctionalGroupHighlight = restoredPhyschemHighlight ? false : deps.restoreFunctionalGroupHighlightSnapshot(snap.highlightState?.functionalGroup ?? null, mol);
    if (!restoredPhyschemHighlight && !restoredFunctionalGroupHighlight) {
      deps.restorePersistentHighlight();
    }
    deps.restoreInteractionState(snap);

    const syncMol = snap.reactionPreview?.sourceMol ? cloneSnapshotSourceMol(snap.reactionPreview.sourceMol) : inputSyncMol;
    if (snap.inputMode) {
      deps.setCurrentSmiles(snap.currentSmiles ?? null);
      deps.setCurrentInchi(snap.currentInchi ?? null);
      deps.setInputFormat(snap.inputMode, {
        preserveInput: true,
        inputValue: snap.inputValue ?? (snap.inputMode === 'inchi' ? deps.getCurrentInchi() ?? '' : deps.getCurrentSmiles() ?? '')
      });
    } else {
      deps.syncInputField(syncMol);
    }
  }

  return {
    capture,
    restore
  };
}
