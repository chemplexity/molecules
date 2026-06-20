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

  function render2d(mol, options = {}) {
    return deps.scene.render2d(mol, options);
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
   * @param {boolean} [options.forcePreservePositions] - When true for force renders, reuses current simulation positions where possible.
   * @param {boolean} [options.forceKeepInView] - When true for force renders, preserves the current viewport first but refits if the graph settles outside it.
   * @param {Map<string, {x: number, y: number}>|null} [options.forceAnchorLayout] - Optional force-anchor layout override keyed by atom id.
   * @param {Map<string, {x: number, y: number}>|null} [options.forceInitialPatchPos] - Optional force-pixel positions applied before the first force tick.
   * @param {number} [options.fitPad] - Optional 2D viewport fit padding.
   * @param {number} [options.fitMaxScale] - Optional 2D viewport fit zoom cap.
   * @param {boolean} [options.ignoreOverlayPadding] - When true, fits 2D viewport against molecule bounds without reserving overlay gutters.
   * @param {number} [options.forceFitPad] - Optional force viewport fit padding.
   * @param {number} [options.forceFitScaleMultiplier] - Optional force viewport fit scale multiplier.
   * @param {boolean} [options.forceIgnoreOverlayPadding] - When true, fits force viewport against molecule bounds without reserving overlay gutters.
   */
  function renderMol(mol, options = {}) {
    const {
      recomputeResonance = true,
      refreshResonancePanel = true,
      preserveHistory = false,
      preserveGeometry = false,
      preserveView = false,
      preserveAnalysis = false,
      forcePreservePositions = false,
      forceKeepInView = false,
      forceAnchorLayout = null,
      forceInitialPatchPos = null,
      fitPad,
      fitMaxScale,
      ignoreOverlayPadding,
      forceFitPad,
      forceFitScaleMultiplier,
      forceIgnoreOverlayPadding
    } = options;

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
      const forceOptions = { preserveView, anchorLayout: forceAnchorLayout };
      if (forcePreservePositions) {
        forceOptions.preservePositions = true;
      }
      if (forceInitialPatchPos) {
        forceOptions.initialPatchPos = forceInitialPatchPos;
      }
      if (forceKeepInView) {
        forceOptions.keepInView = true;
      }
      if (forceFitPad !== undefined) {
        forceOptions.fitPad = forceFitPad;
      }
      if (forceFitScaleMultiplier !== undefined) {
        forceOptions.fitScaleMultiplier = forceFitScaleMultiplier;
      }
      if (forceIgnoreOverlayPadding !== undefined) {
        forceOptions.ignoreOverlayPadding = forceIgnoreOverlayPadding;
      }
      updateForce(mol, forceOptions);
      if (!preserveAnalysis) {
        deps.analysis.updateFormula(mol);
        deps.analysis.updateDescriptors(mol);
        deps.analysis.updatePanels(mol, { recomputeResonance, refreshResonancePanel });
      }
      return;
    }

    deps.simulation.stop();
    const render2dOptions = {
      recomputeResonance,
      refreshResonancePanel,
      preserveGeometry,
      preserveAnalysis
    };
    if (fitPad !== undefined) {
      render2dOptions.fitPad = fitPad;
    }
    if (fitMaxScale !== undefined) {
      render2dOptions.fitMaxScale = fitMaxScale;
    }
    if (ignoreOverlayPadding !== undefined) {
      render2dOptions.ignoreOverlayPadding = ignoreOverlayPadding;
    }
    deps.scene.render2d(mol, render2dOptions);
    if (previous2dZoom) {
      deps.view.restoreZoomTransform?.(previous2dZoom);
    }
  }

  return {
    draw2d,
    render2d,
    updateForce,
    renderMol
  };
}
