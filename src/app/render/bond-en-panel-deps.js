/** @module app/render/bond-en-panel-deps */

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
