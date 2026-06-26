/** @module app/render/panel-deps */

/**
 * Builds the structured dependency object for the BondEnPanel factory,
 * mapping flat dependency properties into a panel dependency object (mode, currentMol, _mol2d, draw2d, updateForce).
 * @param {object} deps - Flat app context providing BondEnPanel-related methods and values.
 * @returns {object} Dependency object consumed by `createBondEnPanel`.
 */
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

/**
 * Builds the structured dependency object for the ResonancePanel factory,
 * mapping flat dependency properties into a panel dependency object (mode, currentMol, _mol2d, molecule setters, renderers, view helpers, overlays, and history hooks).
 * @param {object} deps - Flat app context providing ResonancePanel-related methods and values.
 * @returns {object} Dependency object consumed by `createResonancePanel`.
 */
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
    setCurrentMol: deps.state.setCurrentMol,
    setMol2d: deps.state.setMol2d,
    draw2d: deps.renderers.draw2d,
    render2d: deps.renderers.render2d,
    updateForce: deps.renderers.updateForce,
    resetOrientation: deps.view?.resetOrientation,
    getForceNodes: deps.force?.getNodes,
    plotEl: deps.dom?.plotEl,
    hasReactionPreview: deps.overlays.hasReactionPreview,
    restoreReactionPreviewSource: deps.overlays.restoreReactionPreviewSource,
    takeSnapshot: deps.history.takeSnapshot
  };
}

/**
 * Builds the structured dependency object for the BondLengthsPanel factory,
 * mapping flat dependency properties into a panel dependency object (mode, currentMol, _mol2d, draw2d, updateForce).
 * @param {object} deps - Flat app context providing BondLengthsPanel-related methods and values.
 * @returns {object} Dependency object consumed by `initBondLengthsPanel`.
 */
export function createBondLengthsPanelDeps(deps) {
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

/**
 * Builds the structured dependency object for the AtomNumberingPanel factory,
 * mapping flat dependency properties into a panel dependency object (mode, currentMol, _mol2d, draw2d, updateForce, getRenderOptions, updateRenderOptions, reaction preview accessors).
 * @param {object} deps - Flat app context providing AtomNumberingPanel-related methods and values.
 * @returns {object} Dependency object consumed by `createAtomNumberingPanel`.
 */
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
