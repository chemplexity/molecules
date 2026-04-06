/** @module app/core/app-state-bridge */

export function createAppStateBridge(deps) {
  return {
    documentState: {
      getCurrentMol: deps.documentState.getCurrentMol,
      setCurrentMol: deps.documentState.setCurrentMol,
      getMol2d: deps.documentState.getMol2d,
      setMol2d: deps.documentState.setMol2d,
      getCurrentSmiles: deps.documentState.getCurrentSmiles,
      getCurrentInchi: deps.documentState.getCurrentInchi,
      getActiveMolecule: deps.documentState.getActiveMolecule,
      setActiveMolecule: deps.documentState.setActiveMolecule
    },
    viewState: {
      getMode: deps.viewState.getMode,
      setMode: deps.viewState.setMode,
      getRotationDeg: deps.viewState.getRotationDeg,
      setRotationDeg: deps.viewState.setRotationDeg,
      getFlipH: deps.viewState.getFlipH,
      setFlipH: deps.viewState.setFlipH,
      getFlipV: deps.viewState.getFlipV,
      setFlipV: deps.viewState.setFlipV,
      setCx2d: deps.viewState.setCx2d,
      setCy2d: deps.viewState.setCy2d,
      captureZoomTransform: deps.viewState.captureZoomTransform,
      restore2dEditViewport: deps.viewState.restore2dEditViewport,
      sync2dDerivedState: deps.viewState.sync2dDerivedState,
      syncStereoMap2d: deps.viewState.syncStereoMap2d,
      clearPrimitiveHover: deps.viewState.clearPrimitiveHover,
      suppressDrawBondHover: deps.viewState.suppressDrawBondHover,
      setPrimitiveHoverSuppressed: deps.viewState.setPrimitiveHoverSuppressed,
      setDrawBondHoverSuppressed: deps.viewState.setDrawBondHoverSuppressed,
      restorePersistentHighlight: deps.viewState.restorePersistentHighlight,
      fitCurrent2dView: deps.viewState.fitCurrent2dView,
      enableForceKeepInView: deps.viewState.enableForceKeepInView,
      getZoomTransform: deps.viewState.getZoomTransform,
      setZoomTransform: deps.viewState.setZoomTransform,
      makeZoomIdentity: deps.viewState.makeZoomIdentity,
      setPreserveSelectionOnNextRender: deps.viewState.setPreserveSelectionOnNextRender,
      scale: deps.viewState.scale
    },
    overlayState: {
      getSelectedAtomIds: deps.overlayState.getSelectedAtomIds,
      getSelectedBondIds: deps.overlayState.getSelectedBondIds,
      getHoveredAtomIds: deps.overlayState.getHoveredAtomIds,
      getHoveredBondIds: deps.overlayState.getHoveredBondIds,
      getSelectionModifierActive: deps.overlayState.getSelectionModifierActive,
      setSelectionModifierActive: deps.overlayState.setSelectionModifierActive,
      getSelectMode: deps.overlayState.getSelectMode,
      setSelectMode: deps.overlayState.setSelectMode,
      getDrawBondMode: deps.overlayState.getDrawBondMode,
      setDrawBondMode: deps.overlayState.setDrawBondMode,
      getEraseMode: deps.overlayState.getEraseMode,
      setEraseMode: deps.overlayState.setEraseMode,
      getErasePainting: deps.overlayState.getErasePainting,
      getDrawBondElement: deps.overlayState.getDrawBondElement,
      setDrawBondElement: deps.overlayState.setDrawBondElement,
      setErasePainting: deps.overlayState.setErasePainting
    }
  };
}
