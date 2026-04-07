/** @module app/render/panel-deps */

export function createBondEnPanelDeps(deps) {
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
    updateForce: deps.renderers.updateForce
  };
}

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

export function createAtomNumberingPanelDeps(deps) {
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
    getRenderOptions: deps.options.getRenderOptions,
    updateRenderOptions: deps.options.updateRenderOptions,
    hasReactionPreview: deps.overlays.hasReactionPreview,
    getReactionPreviewReactantAtomIds: deps.overlays.getReactionPreviewReactantAtomIds,
    getReactionPreviewMappedAtomPairs: deps.overlays.getReactionPreviewMappedAtomPairs
  };
}
