/** @module app/render/reaction-2d-deps */

/**
 * Builds the structured dependency object for the Reaction2d factory,
 * mapping flat dependency properties into a flat dependency object (g, plotEl, mode, currentMol, _mol2d, draw2d, render helpers, zoom/force/history accessors).
 * @param {object} deps - Flat app context providing Reaction2d-related methods and values.
 * @returns {object} Dependency object consumed by `createReaction2d`.
 */
export function createReaction2dDeps(deps) {
  return {
    g: deps.g,
    plotEl: deps.plotEl,
    get mode() {
      return deps.state.getMode();
    },
    get currentMol() {
      return deps.state.getCurrentMol();
    },
    get _mol2d() {
      return deps.state.getMol2d();
    },
    draw2d: deps.renderers.draw2d,
    applyForceHighlights: deps.renderers.applyForceHighlights,
    renderMol: deps.renderers.renderMol,
    captureZoomTransform: deps.view.captureZoomTransform,
    restoreZoomTransform: deps.view.restoreZoomTransform,
    captureForceNodePositions: deps.force?.captureNodePositions,
    restoreForceNodePositions: deps.force?.restoreNodePositions,
    restartForceSimulation: deps.force?.restart,
    captureAppSnapshot: deps.history.captureAppSnapshot,
    takeSnapshot: deps.history.takeSnapshot
  };
}
