/** @module app/core/input-flow-deps */

/**
 * Builds the structured dependency object for the InputFlow factory,
 * mapping flat dependency properties into named sub-objects (state, dom, history, snapshot, molecule, collection, examples, parsers, overlays, renderers, highlights, force, analysis).
 * @param {object} deps - Flat app context providing InputFlow-related methods and values.
 * @returns {object} Dependency object consumed by `createInputFlow`.
 */
export function createInputFlowDeps(deps) {
  return {
    state: {
      getInputMode: deps.state.getInputMode,
      setInputMode: deps.state.setInputMode,
      getCurrentSmiles: deps.state.getCurrentSmiles,
      setCurrentSmiles: deps.state.setCurrentSmiles,
      getCurrentInchi: deps.state.getCurrentInchi,
      setCurrentInchi: deps.state.setCurrentInchi,
      getCurrentMol: deps.state.getCurrentMol,
      setCurrentMol: deps.state.setCurrentMol,
      getMol2d: deps.state.getMol2d,
      setMol2d: deps.state.setMol2d,
      getMode: deps.state.getMode,
      clear2dDerivedState: deps.state.clear2dDerivedState,
      clearSelection: deps.state.clearSelection,
      clearHovered: deps.state.clearHovered,
      clearForceRenderCaches: deps.state.clearForceRenderCaches,
      resetValenceWarnings: deps.state.resetValenceWarnings
    },
    dom: {
      getInputElement: deps.dom.getInputElement,
      setInputFormatButtons: deps.dom.setInputFormatButtons,
      setInputLabel: deps.dom.setInputLabel
    },
    history: {
      takeSnapshot: deps.history.takeSnapshot
    },
    snapshot: {
      capture: deps.snapshot.capture
    },
    molecule: {
      getMolSmiles: deps.molecule.getMolSmiles,
      getMolInchi: deps.molecule.getMolInchi
    },
    collection: {
      getInputValue: deps.collection.getInputValue,
      syncPickerForInputValue: deps.collection.syncPickerForInputValue
    },
    examples: {
      render: deps.examples.render
    },
    parsers: {
      parseSMILES: deps.parsers.parseSMILES,
      parseINCHI: deps.parsers.parseINCHI,
      detectChemicalStringFormat: deps.parsers.detectChemicalStringFormat
    },
    overlays: {
      hasReactionPreview: deps.overlays.hasReactionPreview,
      clearReactionPreviewState: deps.overlays.clearReactionPreviewState
    },
    renderers: deps.renderers,
    highlights: {
      clear: deps.highlights.clear
    },
    force: {
      clearIfActive: deps.force.clearIfActive
    },
    analysis: {
      updatePanels: deps.analysis.updatePanels,
      clearSummary: deps.analysis.clearSummary
    }
  };
}
