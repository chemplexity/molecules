/** @module app/core/session-snapshot */

/**
 * Creates the session snapshot manager that handles capturing and restoring full application state snapshots for undo/redo.
 * @param {object} deps - Dependency object providing Molecule constructor, mode getters/setters, view state helpers, overlay helpers, history, and analysis updaters.
 * @returns {{capture: (options?: object) => object, restore: (snapshot: object) => void}} Object with `capture` and `restore` snapshot functions.
 */
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
        ringTemplateSize: snapshot.interactionState?.ringTemplateSize ?? 6,
        drawBondElement: snapshot.interactionState?.drawBondElement ?? 'C',
        drawBondType: snapshot.interactionState?.drawBondType ?? 'single',
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
      ringTemplateSize: snapshot.interactionState?.ringTemplateSize ?? 6,
      drawBondElement: snapshot.interactionState?.drawBondElement ?? 'C',
      drawBondType: snapshot.interactionState?.drawBondType ?? 'single',
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
      Object.assign(atom.properties, atomData.properties);
    }
    for (const bondData of data.bonds ?? []) {
      built.addBond(bondData.id, bondData.atoms[0], bondData.atoms[1], { ...bondData.properties }, false);
      Object.assign(built.bonds.get(bondData.id).properties, bondData.properties);
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

  function hasCompleteReactionPreviewDisplay(displayMol, reactionPreview) {
    if (!reactionPreview) {
      return false;
    }
    const productAtomIds = reactionPreview.productAtomIds ?? [];
    return productAtomIds.length > 0 && productAtomIds.every(atomId => displayMol?.atoms?.has(atomId));
  }

  function isActiveResonancePairDisplay(mol) {
    return mol?.__reactionPreview?.resonancePair === true;
  }

  function attachResonancePairMetadata(targetMol, sourceMol) {
    if (!targetMol || !sourceMol?.__reactionPreview?.resonancePair) {
      return;
    }
    targetMol.__reactionPreview = sourceMol.__reactionPreview;
    if (targetMol.__reactionPreview.reactantAtomIds?.size) {
      targetMol.__reactionPreview.reactantReferenceCoords = new Map(
        [...targetMol.__reactionPreview.reactantAtomIds]
          .map(atomId => {
            const atom = targetMol.atoms.get(atomId);
            return atom && Number.isFinite(atom.x) && Number.isFinite(atom.y) ? [atomId, { x: atom.x, y: atom.y }] : null;
          })
          .filter(Boolean)
      );
    }
  }

  function cloneBaseResonanceAnalysisMol(mol) {
    if (!mol?.properties?.resonance || typeof mol.clone !== 'function') {
      return mol;
    }
    const analysisMol = mol.clone();
    try {
      analysisMol.setResonanceState?.(1);
    } catch {
      return mol;
    }
    return analysisMol;
  }

  function capture(options = {}) {
    const documentOverrides = options.documentState ?? {};
    const activeMol = deps.getActiveMolecule();
    const reactionPreview = deps.captureReactionPreviewSnapshot();
    const resonanceUndo = reactionPreview ? { mol: activeMol, resonanceView: null } : deps.prepareResonanceUndoSnapshot(activeMol);
    const snapshotMol = reactionPreview?.sourceMol ? reactionPreview.sourceMol : deps.serializeSnapshotMol(resonanceUndo.mol);
    const resonanceDisplayMol = deps.getMode() === '2d' && isActiveResonancePairDisplay(activeMol) ? deps.serializeSnapshotMol(activeMol) : null;
    const resonanceView = resonanceUndo.resonanceView
      ? {
          ...resonanceUndo.resonanceView,
          ...(resonanceDisplayMol ? { displayMol: resonanceDisplayMol } : {})
        }
      : null;
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
        resonanceView
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
      deps.restorePanelState(snap.panelState ?? null, { preserveSmartsTab: true });
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
    const resonanceDisplayMolData = snap.resonanceView?.displayMol ?? null;

    const mol = buildSnapshotMol(snapshotMolData);
    const displayMol = buildSnapshotMol(previewDisplayMolData) ?? mol;
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

    const restoredResonanceView = deps.restoreResonanceViewSnapshot(mol, snap.resonanceView ?? null);
    if (restoredResonanceView) {
      const resonanceDisplayMol = buildSnapshotMol(resonanceDisplayMolData);
      if (snap.mode === '2d' && resonanceDisplayMol) {
        attachResonancePairMetadata(resonanceDisplayMol, deps.getMol2d?.());
        deps.restore2dState(resonanceDisplayMol, snap);
      } else {
        deps.redrawRestoredResonanceView(mol, snap);
      }
    }
    const functionalGroupAnalysisMol = cloneBaseResonanceAnalysisMol(mol);

    deps.restorePanelState(snap.panelState ?? null, { preserveSmartsTab: true });
    const restoredPhyschemHighlight = deps.restorePhyschemHighlightSnapshot(snap.highlightState?.physchem ?? null);
    const restoredFunctionalGroupHighlight = restoredPhyschemHighlight ? false : deps.restoreFunctionalGroupHighlightSnapshot(snap.highlightState?.functionalGroup ?? null, functionalGroupAnalysisMol);
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
        inputValue: snap.inputValue ?? (snap.inputMode === 'inchi' ? (deps.getCurrentInchi() ?? '') : (deps.getCurrentSmiles() ?? ''))
      });
    } else {
      deps.syncInputField(syncMol);
    }

    if (snap.reactionPreview) {
      deps.updateReactionTemplatesPanel();
      deps.restorePersistentHighlight();
      const hasCompletePreviewDisplay = previewDisplayMolData && hasCompleteReactionPreviewDisplay(displayMol, snap.reactionPreview);
      const reapplied = hasCompletePreviewDisplay ? false : deps.reapplyActiveReactionPreview();
      if (hasCompletePreviewDisplay || reapplied) {
        if (hasCompletePreviewDisplay) {
          if (snap.mode === '2d') {
            deps.restore2dState(displayMol, snap);
          } else if (snap.mode === 'force') {
            deps.restoreForceState(displayMol, snap);
          }
        }
        deps.restoreZoomTransform(snap.zoomTransform);
      }
    }
  }

  return {
    capture,
    restore
  };
}
