/** @module app/render/render-runtime */

export function createRenderRuntime(deps) {
  function draw2d() {
    return deps.scene.draw2d();
  }

  function updateForce(mol, options = {}) {
    return deps.scene.updateForce(mol, options);
  }

  /**
   * Renders the provided molecule in the active layout mode.
   *
   * @param {object} mol
   * @param {object} [options={}]
   * @param {boolean} [options.recomputeResonance=true]
   * @param {boolean} [options.refreshResonancePanel=true]
   * @param {boolean} [options.preserveHistory=false]
   * @param {boolean} [options.preserveGeometry=false]
   * @param {boolean} [options.preserveView=false]
   * @param {boolean} [options.preserveAnalysis=false]
   */
  function renderMol(mol, options = {}) {
    const { recomputeResonance = true, refreshResonancePanel = true, preserveHistory = false, preserveGeometry = false, preserveView = false, preserveAnalysis = false } = options;

    if (!preserveAnalysis) {
      deps.highlights.clear();
    }

    const previous2dZoom = deps.state.getMode() === '2d' && preserveView ? (deps.view.captureZoomTransform?.() ?? null) : null;

    deps.state.setCurrentMol(mol);
    deps.view.resetOrientation();

    if (!preserveHistory) {
      deps.history.clear();
    }

    deps.chemistry.kekulize(mol);

    if (deps.state.getMode() === 'force') {
      updateForce(mol, { preserveView });
      if (!preserveAnalysis) {
        deps.analysis.updateFormula(mol);
        deps.analysis.updateDescriptors(mol);
        deps.analysis.updatePanels(mol, { recomputeResonance, refreshResonancePanel });
      }
      return;
    }

    deps.simulation.stop();
    deps.scene.render2d(mol, {
      recomputeResonance,
      refreshResonancePanel,
      preserveGeometry,
      preserveAnalysis
    });
    if (previous2dZoom) {
      deps.view.restoreZoomTransform?.(previous2dZoom);
    }
  }

  return {
    draw2d,
    updateForce,
    renderMol
  };
}
