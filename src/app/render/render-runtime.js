/** @module app/render/render-runtime */

/**
 * Creates the render runtime, wiring the shared scene renderer into `draw2d`, `updateForce`, and `renderMol` delegates.
 * @param {object} deps - Dependency object providing `scene` with `draw2d`, `updateForce`, and `renderMol` methods.
 * @returns {object} Object with `draw2d`, `updateForce`, and `renderMol` functions.
 */
export function createRenderRuntime(deps) {
  function draw2d() {
    return deps.scene.draw2d();
  }

  function updateForce(mol, options = {}) {
    return deps.scene.updateForce(mol, options);
  }

  /**
   * Renders the provided molecule in the active layout mode.
   * @param {object} mol - The molecule to render.
   * @param {object} [options] - Optional rendering flags.
   * @param {boolean} [options.recomputeResonance] - When true, regenerates resonance contributors before rendering.
   * @param {boolean} [options.refreshResonancePanel] - When true, updates the resonance panel UI after rendering.
   * @param {boolean} [options.preserveHistory] - When true, skips pushing a new undo snapshot.
   * @param {boolean} [options.preserveGeometry] - When true, retains the existing 2D coordinates.
   * @param {boolean} [options.preserveView] - When true, does not reset the viewport transform.
   * @param {boolean} [options.preserveAnalysis] - When true, keeps existing analysis highlights.
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
