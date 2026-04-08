/** @module app/interactions/input-controls */

function escapeForInlineJs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Creates the input controls that manage the molecule catalog picker, example links, random molecule selection, and SMILES/InChI input field bindings.
 * @param {object} deps - Dependency object providing data, state, dom, and actions.
 * @returns {object} Object with `bind`, `renderExamples`, `pickRandomMolecule`, `getCollectionInputValue`, and `syncCollectionPickerForInputValue`.
 */
export function createInputControls(deps) {
  const collectionEntries = deps.data.moleculeCatalog.flatMap(collection =>
    collection.molecules.map(molecule => ({
      collectionId: collection.id,
      collectionName: collection.name,
      ...molecule
    }))
  );
  const collectionEntriesById = new Map(collectionEntries.map(entry => [entry.id, entry]));

  function selectedCollectionEntry() {
    return collectionEntriesById.get(deps.dom.getCollectionSelectElement().value) ?? null;
  }

  function collectionValueForMode(entry, fmt = deps.state.getInputMode()) {
    if (!entry) {
      return '';
    }
    return fmt === 'inchi' ? entry.inchi : entry.smiles;
  }

  function populateCollectionPicker() {
    const options = ['<option value="">Molecule Catalog...</option>'];
    for (const collection of deps.data.moleculeCatalog) {
      options.push(`<optgroup label="${collection.name}">`);
      for (const molecule of collection.molecules) {
        options.push(`<option value="${molecule.id}">${molecule.name}</option>`);
      }
      options.push('</optgroup>');
    }
    deps.dom.getCollectionSelectElement().innerHTML = options.join('');
  }

  function syncCollectionPickerForInputValue(value) {
    const entry = selectedCollectionEntry();
    if (!entry) {
      return;
    }
    if (String(value ?? '') !== collectionValueForMode(entry)) {
      deps.dom.getCollectionSelectElement().value = '';
    }
  }

  function getCollectionInputValue(fmt) {
    return collectionValueForMode(selectedCollectionEntry(), fmt);
  }

  function renderExamples() {
    const isInchi = deps.state.getInputMode() === 'inchi';
    const links = deps.data.exampleMolecules
      .map(molecule => {
        const value = isInchi ? molecule.inchi : molecule.smiles;
        return `<a href="#" onclick="parseInput('${escapeForInlineJs(value)}'); return false">${molecule.name}</a>`;
      })
      .join(', ');
    deps.dom.getExamplesElement().innerHTML = `<i>examples:&nbsp;</i>${links}, <a href="#" onclick="pickRandomMolecule(); return false">random</a>`;
  }

  function pickRandomMolecule() {
    const inputMode = deps.state.getInputMode();
    const pool = inputMode === 'inchi'
      ? deps.data.randomMolecule.filter(molecule => molecule.inchi)
      : deps.data.randomMolecule;
    if (pool.length === 0) {
      return;
    }
    const molecule = pool[Math.floor(Math.random() * pool.length)];
    deps.actions.parseInput(inputMode === 'inchi' ? molecule.inchi : molecule.smiles);
  }

  function handleCollectionChange() {
    const entry = selectedCollectionEntry();
    if (!entry) {
      return;
    }
    const value = collectionValueForMode(entry);
    const inputEl = deps.dom.getInputElement();
    inputEl.value = value;
    deps.actions.parseInputWithAutoFormat(value);
  }

  function handleInput(event) {
    syncCollectionPickerForInputValue(event.target.value);
  }

  function handleKeyup(event) {
    if (event.key === 'Enter') {
      deps.actions.parseInputWithAutoFormat(event.target.value);
    }
  }

  function handlePaste(event) {
    const pastedText = event.clipboardData?.getData('text/plain') ?? event.clipboardData?.getData('text');
    if (typeof pastedText === 'string' && pastedText.length > 0) {
      const target = event.target;
      const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : target.value.length;
      const nextValue = `${target.value.slice(0, start)}${pastedText}${target.value.slice(end)}`;
      target.value = nextValue;
      syncCollectionPickerForInputValue(nextValue);
      deps.actions.parseInputWithAutoFormat(nextValue);
      event.preventDefault();
      return;
    }
    setTimeout(() => {
      deps.actions.parseInputWithAutoFormat(event.target.value);
    }, 0);
  }

  function bind() {
    populateCollectionPicker();
    deps.dom.getCollectionSelectElement().addEventListener('change', handleCollectionChange);
    deps.dom.getInputElement().addEventListener('input', handleInput);
    deps.dom.getInputElement().addEventListener('keyup', handleKeyup);
    deps.dom.getInputElement().addEventListener('paste', handlePaste);
  }

  return {
    bind,
    renderExamples,
    pickRandomMolecule,
    getCollectionInputValue,
    syncCollectionPickerForInputValue
  };
}
