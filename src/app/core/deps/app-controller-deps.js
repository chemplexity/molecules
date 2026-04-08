/** @module app/core/app-controller-deps */

/**
 * Builds the structured dependency object for the AppController factory,
 * mapping flat dependency properties into named sub-objects (state, renderers, history, panels, analysis, dom, overlays, snapshot, navigation).
 * @param {object} deps - Flat app context providing AppController-related methods and values.
 * @returns {object} Dependency object consumed by `createAppController`.
 */
export function createAppControllerDeps(deps) {
  return {
    state: deps.state,
    renderers: deps.renderers,
    history: {
      takeSnapshot: deps.history.takeSnapshot,
      captureSnapshot: deps.history.captureSnapshot
    },
    panels: deps.panels ?? {},
    analysis: {
      syncInputField: deps.analysis.syncInputField,
      updateFormula: deps.analysis.updateFormula,
      updateDescriptors: deps.analysis.updateDescriptors,
      updatePanels: deps.analysis.updatePanels
    },
    dom: deps.dom,
    overlays: {
      hasReactionPreview: deps.overlays.hasReactionPreview,
      prepareReactionPreviewBondEditTarget: deps.overlays.prepareReactionPreviewBondEditTarget,
      prepareReactionPreviewEditTargets: deps.overlays.prepareReactionPreviewEditTargets,
      prepareResonanceStructuralEdit: deps.overlays.prepareResonanceStructuralEdit
    },
    snapshot: {
      capture: deps.snapshot.capture,
      restore: deps.snapshot.restore
    },
    navigation: deps.navigation
  };
}
