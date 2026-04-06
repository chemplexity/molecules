/** @module app/ui/options-modal-deps */

export function createOptionsModalDeps(deps) {
  return {
    doc: deps.doc,
    dom: {
      getOverlayElement: deps.dom.getOverlayElement,
      getShowValenceWarningsElement: deps.dom.getShowValenceWarningsElement,
      getShowAtomTooltipsElement: deps.dom.getShowAtomTooltipsElement,
      getShowLonePairsElement: deps.dom.getShowLonePairsElement,
      get2DAtomColoringElement: deps.dom.get2DAtomColoringElement,
      get2DAtomFontSizeElement: deps.dom.get2DAtomFontSizeElement,
      get2DBondThicknessElement: deps.dom.get2DBondThicknessElement,
      getForceAtomSizeElement: deps.dom.getForceAtomSizeElement,
      getForceBondThicknessElement: deps.dom.getForceBondThicknessElement,
      getResetButtonElement: deps.dom.getResetButtonElement,
      getCancelButtonElement: deps.dom.getCancelButtonElement,
      getApplyButtonElement: deps.dom.getApplyButtonElement
    },
    options: {
      limits: deps.options.limits,
      getRenderOptions: deps.options.getRenderOptions,
      getDefaultRenderOptions: deps.options.getDefaultRenderOptions,
      updateRenderOptions: deps.options.updateRenderOptions
    },
    state: {
      getMode: deps.state.getMode,
      getCurrentMol: deps.state.getCurrentMol,
      getMol2d: deps.state.getMol2d
    },
    view: {
      setFontSize: deps.view.setFontSize,
      hideTooltip: deps.view.hideTooltip
    },
    renderers: {
      draw2d: deps.renderers.draw2d,
      updateForce: deps.renderers.updateForce
    }
  };
}
