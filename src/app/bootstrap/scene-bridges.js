/** @module app/bootstrap/scene-bridges */

export function createSceneBridges(deps) {
  return {
    applyForceHighlights() {
      return deps.forceHighlightRenderer.applyForceHighlights();
    },
    applyForceSelection() {
      return deps.forceSelectionRenderer.applyForceSelection();
    },
    clearPrimitiveHover() {
      return deps.selectionOverlayManager.clearPrimitiveHover();
    },
    refreshSelectionOverlay() {
      return deps.selectionOverlayManager.refreshSelectionOverlay();
    },
    getRenderableSelectionIds() {
      return deps.selectionOverlayManager.getRenderableSelectionIds();
    },
    showPrimitiveHover(atomIds = [], bondIds = []) {
      return deps.selectionOverlayManager.showPrimitiveHover(atomIds, bondIds);
    },
    setPrimitiveHover(atomIds = [], bondIds = []) {
      return deps.selectionOverlayManager.setPrimitiveHover(atomIds, bondIds);
    },
    getSelectedDragAtomIds(mol, atomIds = [], bondIds = []) {
      return deps.selectionStateHelpers.getSelectedDragAtomIds(mol, atomIds, bondIds);
    },
    toSVGPt2d(atom) {
      return deps.render2DHelpers.toSVGPt2d(atom);
    },
    zoomToFitIf2d() {
      return deps.render2DHelpers.zoomToFitIf2d();
    }
  };
}
