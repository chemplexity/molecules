/** @module app/render/reaction-2d-deps */

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
    captureAppSnapshot: deps.history.captureAppSnapshot,
    takeSnapshot: deps.history.takeSnapshot
  };
}
