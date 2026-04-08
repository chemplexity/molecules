/** @module app/bootstrap/deps/app-state-deps */

/**
 * Builds the structured dependency object for the AppStateBridge factory,
 * mapping flat context properties into named sub-objects (documentState, viewState, overlayState).
 * @param {object} ctx - Flat app context providing AppStateBridge-related methods and values.
 * @returns {object} Dependency object consumed by `createAppStateBridge`.
 */
export function createAppStateBridgeDeps(ctx) {
  return {
    documentState: {
      getCurrentMol: () => ctx.runtimeState.currentMol,
      setCurrentMol: mol => {
        ctx.runtimeState.currentMol = mol;
      },
      getMol2d: () => ctx.runtimeState.mol2d,
      setMol2d: mol => {
        ctx.runtimeState.mol2d = mol;
      },
      getCurrentSmiles: () => ctx.runtimeState.currentSmiles,
      getCurrentInchi: () => ctx.runtimeState.currentInchi,
      getActiveMolecule: () => (ctx.runtimeState.mode === 'force' ? ctx.runtimeState.currentMol : ctx.runtimeState.mol2d),
      setActiveMolecule: mol => {
        if (ctx.runtimeState.mode === 'force') {
          ctx.runtimeState.currentMol = mol;
        } else {
          ctx.runtimeState.mol2d = mol;
        }
      }
    },
    viewState: {
      getMode: () => ctx.runtimeState.mode,
      setMode: nextMode => {
        ctx.runtimeState.mode = nextMode;
      },
      getRotationDeg: () => ctx.runtimeState.rotationDeg,
      setRotationDeg: value => {
        ctx.runtimeState.rotationDeg = value;
      },
      getFlipH: () => ctx.runtimeState.flipH,
      setFlipH: value => {
        ctx.runtimeState.flipH = value;
      },
      getFlipV: () => ctx.runtimeState.flipV,
      setFlipV: value => {
        ctx.runtimeState.flipV = value;
      },
      setCx2d: value => {
        ctx.runtimeState.cx2d = value;
      },
      setCy2d: value => {
        ctx.runtimeState.cy2d = value;
      },
      captureZoomTransform: () => (ctx.runtimeState.mode === '2d' ? ctx.captureZoomTransformSnapshot() : null),
      restore2dEditViewport: (zoomSnapshot, options) => ctx.restore2dEditViewport(zoomSnapshot, options),
      sync2dDerivedState: mol => ctx.render2DHelpers.sync2dDerivedState(mol),
      syncStereoMap2d: mol => {
        ctx.runtimeState.stereoMap2d = ctx.pickStereoWedgesPreserving2dChoice(mol);
      },
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      setPrimitiveHover: (atomIds = [], bondIds = []) => ctx.setPrimitiveHover(atomIds, bondIds),
      suppressDrawBondHover: () => {
        ctx.setDrawBondHoverSuppressed(true);
      },
      setPrimitiveHoverSuppressed: value => {
        ctx.setPrimitiveHoverSuppressed(value);
      },
      setDrawBondHoverSuppressed: value => {
        ctx.setDrawBondHoverSuppressed(value);
      },
      restorePersistentHighlight: () => ctx.restorePersistentHighlight(),
      fitCurrent2dView: () => ctx.fitCurrent2dView(),
      enableForceKeepInView: () => ctx.enableForceKeepInView(),
      getZoomTransform: () => ctx.getZoomTransform(),
      setZoomTransform: transform => ctx.setZoomTransform(transform),
      makeZoomIdentity: (x, y, k) => ctx.makeZoomIdentity(x, y, k),
      setPreserveSelectionOnNextRender: value => {
        ctx.setPreserveSelectionOnNextRender(value);
      },
      scale: ctx.scale
    },
    overlayState: {
      getSelectedAtomIds: () => ctx.getSelectedAtomIds(),
      getSelectedBondIds: () => ctx.getSelectedBondIds(),
      getHoveredAtomIds: () => ctx.getHoveredAtomIds(),
      getHoveredBondIds: () => ctx.getHoveredBondIds(),
      getSelectionModifierActive: () => ctx.getSelectionModifierActive(),
      setSelectionModifierActive: value => {
        ctx.setSelectionModifierActive(value);
      },
      getSelectMode: () => ctx.getSelectMode(),
      setSelectMode: value => {
        ctx.setSelectMode(value);
      },
      getDrawBondMode: () => ctx.getDrawBondMode(),
      setDrawBondMode: value => {
        ctx.setDrawBondMode(value);
      },
      getEraseMode: () => ctx.getEraseMode(),
      setEraseMode: value => {
        ctx.setEraseMode(value);
      },
      getErasePainting: () => ctx.getErasePainting(),
      getDrawBondElement: () => ctx.getDrawBondElement(),
      setDrawBondElement: value => {
        ctx.setDrawBondElement(value);
      },
      getDrawBondType: () => ctx.getDrawBondType(),
      setDrawBondType: value => {
        ctx.setDrawBondType(value);
      },
      setErasePainting: value => {
        ctx.setErasePainting(value);
      }
    }
  };
}
