/** @module app/core/session-runtime-bridge */

export function createSessionRuntimeBridge(deps) {
  function syncInputField(mol) {
    try {
      const smiles = deps.io.toSMILES(mol);
      deps.state.setCurrentSmiles(smiles);
      if (deps.state.getInputMode() !== 'inchi') {
        deps.state.setCurrentInchi(null);
        deps.dom.setInputValue(smiles);
      }
    } catch {
      /* leave as-is */
    }

    if (deps.state.getInputMode() === 'inchi') {
      try {
        const inchi = deps.io.toInChI(mol);
        deps.state.setCurrentInchi(inchi);
        deps.dom.setInputValue(inchi);
      } catch {
        /* leave as-is */
      }
    }
  }

  function captureViewState() {
    const viewState = {
      mode: deps.view.getMode(),
      zoomTransform: deps.view.captureZoomTransform(),
      rotationDeg: deps.view.getRotationDeg(),
      flipH: deps.view.getFlipH(),
      flipV: deps.view.getFlipV()
    };

    if (deps.view.getMode() === '2d') {
      viewState.cx2d = deps.view.getCx2d();
      viewState.cy2d = deps.view.getCy2d();
      viewState.hCounts2d = deps.view.getHCounts2d() ? [...deps.view.getHCounts2d()] : [];
      viewState.stereoMap2d = deps.view.getStereoMap2d() ? [...deps.view.getStereoMap2d()] : null;
    } else {
      viewState.nodePositions = deps.force.getNodePositions();
    }

    return viewState;
  }

  function clearForceState() {
    deps.force.clearGraph();
    deps.force.stop();
    deps.force.setAutoFitEnabled(false);
    deps.force.disableKeepInView();
    deps.scene.clear();
    deps.cache.reset();
    deps.selection.clearValenceWarnings();
  }

  function clear2dState() {
    deps.view.setHCounts2d(null);
    deps.view.setStereoMap2d(null);
    deps.selection.clearValenceWarnings();
    if (deps.view.getMode() === '2d') {
      deps.scene.clear();
    }
  }

  function clearAnalysisState() {
    deps.analysis.clearFormula();
    deps.analysis.clearWeight();
    deps.analysis.clearDescriptors();
    deps.analysis.clearFunctionalGroups();
  }

  function restore2dState(displayMol, snapshot) {
    deps.document.setMol2d(displayMol);
    deps.view.setCx2d(snapshot.cx2d ?? 0);
    deps.view.setCy2d(snapshot.cy2d ?? 0);
    deps.view.setHCounts2d(snapshot.hCounts2d ? new Map(snapshot.hCounts2d) : new Map());
    deps.view.setStereoMap2d(snapshot.stereoMap2d ? new Map(snapshot.stereoMap2d) : new Map());
    if (deps.view.getMode() === '2d') {
      deps.scene.draw2d();
      deps.view.restoreZoomTransform(snapshot.zoomTransform);
    }
  }

  function restoreForceState(displayMol, snapshot) {
    deps.document.setCurrentMol(displayMol);
    if (deps.view.getMode() !== 'force') {
      return;
    }

    deps.scene.updateForce(displayMol, { preservePositions: true, preserveView: true });
    if (snapshot.nodePositions) {
      const positionMap = new Map(snapshot.nodePositions.map(position => [position.id, position]));
      deps.force.restoreNodePositions(positionMap);
      deps.force.restart();
    }
    deps.view.restoreZoomTransform(snapshot.zoomTransform);
  }

  function redrawRestoredResonanceView(mol, snapshot) {
    if (snapshot.mode === '2d' && deps.view.getMode() === '2d') {
      deps.scene.draw2d();
      deps.view.restoreZoomTransform(snapshot.zoomTransform);
    } else if (snapshot.mode === 'force' && deps.view.getMode() === 'force') {
      deps.scene.updateForce(mol, { preservePositions: true, preserveView: true });
      deps.view.restoreZoomTransform(snapshot.zoomTransform);
    }
  }

  return {
    syncInputField,
    captureViewState,
    clearForceState,
    clear2dState,
    clearAnalysisState,
    restore2dState,
    restoreForceState,
    redrawRestoredResonanceView
  };
}
