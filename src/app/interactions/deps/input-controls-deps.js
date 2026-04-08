/** @module app/interactions/input-controls-deps */

/**
 * Builds the structured dependency object for the InputControls factory,
 * mapping flat dependency properties into named sub-objects (data, state, dom, actions).
 * @param {object} deps - Flat app context providing InputControls-related methods and values.
 * @returns {object} Dependency object consumed by `createInputControls`.
 */
export function createInputControlsDeps(deps) {
  return {
    data: {
      exampleMolecules: deps.data.exampleMolecules,
      randomMolecule: deps.data.randomMolecule,
      moleculeCatalog: deps.data.moleculeCatalog
    },
    state: {
      getInputMode: deps.state.getInputMode
    },
    dom: {
      getInputElement: deps.dom.getInputElement,
      getCollectionSelectElement: deps.dom.getCollectionSelectElement,
      getExamplesElement: deps.dom.getExamplesElement
    },
    actions: {
      parseInput: deps.actions.parseInput,
      parseInputWithAutoFormat: deps.actions.parseInputWithAutoFormat
    }
  };
}
