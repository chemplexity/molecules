/** @module app/core/app-delegates */

import { Molecule } from '../../core/Molecule.js';

export function createAppDelegates(deps) {
  function ensureMol() {
    if (deps.state.getMode() === 'force') {
      if (!deps.state.getCurrentMol()) {
        deps.state.setCurrentMol(new Molecule());
      }
      return deps.state.getCurrentMol();
    }

    if (!deps.state.getMol2d()) {
      deps.state.setMol2d(new Molecule());
      deps.state.clear2dDerivedState();
    }
    return deps.state.getMol2d();
  }

  return {
    handle2dPrimitiveClick(event, atomIds = [], bondIds = []) {
      deps.primitiveSelection.handle2dPrimitiveClick(event, atomIds, bondIds);
    },
    handle2dComponentDblClick(event, seedAtomIds) {
      deps.primitiveSelection.handle2dComponentDblClick(event, seedAtomIds);
    },
    handleForcePrimitiveClick(event, atomIds = [], bondIds = []) {
      deps.primitiveSelection.handleForcePrimitiveClick(event, atomIds, bondIds);
    },
    handleForceComponentDblClick(event, seedAtomIds) {
      deps.primitiveSelection.handleForceComponentDblClick(event, seedAtomIds);
    },
    drawBond(container, bond, a1, a2, mol, toSVGPt, stereoType = null) {
      return deps.render2DHelpers.drawBond(container, bond, a1, a2, mol, toSVGPt, stereoType);
    },
    redraw2dHighlights() {
      return deps.highlight2DRenderer.redraw2dHighlights();
    },
    restore2dEditViewport(zoomSnapshot, options = {}) {
      return deps.structuralEditActions.restore2dEditViewport(zoomSnapshot, options);
    },
    prepareResonanceStructuralEdit(mol) {
      return deps.structuralEditActions.prepareResonanceStructuralEdit(mol);
    },
    promoteBondOrder(bondId, options = {}) {
      return deps.structuralEditActions.promoteBondOrder(bondId, options);
    },
    changeAtomElements(atomIds, newEl, options = {}) {
      return deps.structuralEditActions.changeAtomElements(atomIds, newEl, options);
    },
    replaceForceHydrogenWithDrawElement(atomId, mol = deps.state.getCurrentMol()) {
      return deps.structuralEditActions.replaceForceHydrogenWithDrawElement(atomId, mol);
    },
    startDrawBond(atomId, gX, gY) {
      return deps.drawBondPreviewActions.start(atomId, gX, gY);
    },
    updateDrawBondPreview(point) {
      return deps.drawBondPreviewActions.update(point);
    },
    resetDrawBondHover() {
      return deps.drawBondPreviewActions.resetHover();
    },
    cancelDrawBond() {
      return deps.drawBondPreviewActions.cancel();
    },
    ensureMol,
    autoPlaceBond(atomId, ox, oy) {
      return deps.drawBondCommitActions.autoPlaceBond(atomId, ox, oy);
    },
    commitDrawBond() {
      return deps.drawBondCommitActions.commit();
    },
    draw2d() {
      return deps.scene2DRenderer.draw2d();
    },
    render2d(mol, options = {}) {
      return deps.scene2DRenderer.render2d(mol, options);
    },
    fitCurrent2dView() {
      return deps.scene2DRenderer.fitCurrent2dView();
    },
    eraseItem(atomIds, bondIds) {
      return deps.editingActions.eraseItem(atomIds, bondIds);
    },
    captureZoomTransformSnapshot() {
      return deps.zoomTransformHelpers.captureZoomTransformSnapshot();
    },
    restoreZoomTransformSnapshot(snapshot) {
      return deps.zoomTransformHelpers.restoreZoomTransformSnapshot(snapshot);
    },
    pickStereoWedgesPreserving2dChoice(mol) {
      return deps.stereo.syncDisplayStereo(mol, deps.state.getStereoMap2d());
    },
    renderMol(mol, options = {}) {
      return deps.renderRuntime.renderMol(mol, options);
    },
    clearMolecule() {
      return deps.inputFlowManager.clearMolecule();
    },
    parseAndRender(smiles) {
      return deps.inputFlowManager.parseAndRenderSmiles(smiles);
    },
    parseAndRenderInchi(inchi) {
      return deps.inputFlowManager.parseAndRenderInchi(inchi);
    }
  };
}
