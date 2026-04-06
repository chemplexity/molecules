/** @module app/render/resonance-panel-deps */

export function createResonancePanelDeps(deps) {
  return {
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
    updateForce: deps.renderers.updateForce,
    hasReactionPreview: deps.overlays.hasReactionPreview,
    restoreReactionPreviewSource: deps.overlays.restoreReactionPreviewSource,
    takeSnapshot: deps.history.takeSnapshot
  };
}
