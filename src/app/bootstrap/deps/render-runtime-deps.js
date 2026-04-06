/** @module app/bootstrap/deps/render-runtime-deps */

export function createRenderRuntimeDeps(ctx) {
  return {
    state: {
      getMode: () => ctx.runtimeState.mode,
      setCurrentMol: mol => {
        ctx.runtimeState.currentMol = mol;
      }
    },
    view: {
      resetOrientation: () => {
        ctx.runtimeState.rotationDeg = 0;
        ctx.runtimeState.flipH = false;
        ctx.runtimeState.flipV = false;
      },
      captureZoomTransform: () => ctx.captureZoomTransform(),
      restoreZoomTransform: snapshot => ctx.restoreZoomTransform(snapshot)
    },
    history: {
      clear: () => ctx.clearUndoHistory()
    },
    highlights: {
      clear: () => ctx.clearHighlightState()
    },
    chemistry: {
      kekulize: ctx.kekulize
    },
    simulation: {
      stop: () => ctx.stopSimulation()
    },
    scene: {
      draw2d: () => ctx.getDraw2D()(),
      updateForce: (mol, options = {}) => ctx.forceSceneRenderer.updateForce(mol, options),
      render2d: (mol, options = {}) => ctx.getRender2D()(mol, options)
    },
    analysis: {
      updateFormula: mol => ctx.updateFormula(mol),
      updateDescriptors: mol => ctx.updateDescriptors(mol),
      updatePanels: (mol, options = {}) => ctx.updateAnalysisPanels(mol, options)
    }
  };
}
