/** @module app/interactions/input-controls-deps */

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
