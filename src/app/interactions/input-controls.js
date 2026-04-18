/** @module app/interactions/input-controls */

function escapeForInlineJs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Creates the input controls that manage the molecule catalog picker, example links, random molecule selection, bug-verification selection, debug stress selection, and SMILES/InChI input field bindings.
 * @param {object} deps - Dependency object providing data, state, dom, and actions.
 * @returns {object} Object with `bind`, `renderExamples`, `pickRandomMolecule`, `pickBugVerificationMolecule`, `pickDebugMolecule`, `getCollectionInputValue`, and `syncCollectionPickerForInputValue`.
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
  const randomMoleculePools = {
    smiles: deps.data.randomMolecule,
    inchi: deps.data.randomMolecule.filter(molecule => molecule.inchi)
  };
  const randomSelectionStateByMode = new Map([
    ['smiles', { bag: [], recentKeys: [] }],
    ['inchi', { bag: [], recentKeys: [] }]
  ]);
  const debugStressPool = Array.isArray(deps.data.randomMoleculeComplex) ? deps.data.randomMoleculeComplex : [];
  const debugSelectionState = { bag: [], recentKeys: [] };
  const bugVerificationPool = Array.isArray(deps.data.bugMolecules) ? deps.data.bugMolecules : [];
  const bugVerificationSelectionState = { bag: [], recentKeys: [] };

  function selectedCollectionEntry() {
    return collectionEntriesById.get(deps.dom.getCollectionSelectElement().value) ?? null;
  }

  function currentRandomPoolMode() {
    return deps.state.getInputMode() === 'inchi' ? 'inchi' : 'smiles';
  }

  function collectionValueForMode(entry, fmt = deps.state.getInputMode()) {
    if (!entry) {
      return '';
    }
    return fmt === 'inchi' ? entry.inchi : entry.smiles;
  }

  function randomPoolForMode(inputMode) {
    return randomMoleculePools[inputMode];
  }

  function randomKeyForMolecule(molecule, inputMode) {
    return inputMode === 'inchi' ? (molecule.inchi ?? molecule.smiles ?? '') : (molecule.smiles ?? molecule.inchi ?? '');
  }

  function recentRandomLimit(poolLength) {
    if (poolLength <= 1) {
      return 0;
    }
    return Math.min(poolLength - 1, 24, Math.max(3, Math.ceil(Math.sqrt(poolLength))));
  }

  function createShuffledIndexBag(poolLength) {
    const indices = Array.from({ length: poolLength }, (_, index) => index);
    for (let index = indices.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
    }
    return indices;
  }

  function nextRandomItem(pool, state, itemKey) {
    if (pool.length === 0) {
      return null;
    }
    if (state.bag.length === 0) {
      state.bag = createShuffledIndexBag(pool.length);
    }
    const recentKeys = new Set(state.recentKeys);
    const preferredBagIndex = state.bag.findIndex(index => !recentKeys.has(itemKey(pool[index])));
    const bagIndex = preferredBagIndex === -1 ? 0 : preferredBagIndex;
    const [poolIndex] = state.bag.splice(bagIndex, 1);
    const item = pool[poolIndex];
    state.recentKeys.push(itemKey(item));
    const recentLimit = recentRandomLimit(pool.length);
    if (recentLimit === 0) {
      state.recentKeys.length = 0;
    } else if (state.recentKeys.length > recentLimit) {
      state.recentKeys.splice(0, state.recentKeys.length - recentLimit);
    }
    return item;
  }

  function nextRandomMolecule(inputMode) {
    const pool = randomPoolForMode(inputMode);
    const state = randomSelectionStateByMode.get(inputMode);
    return nextRandomItem(pool, state, molecule => randomKeyForMolecule(molecule, inputMode));
  }

  function nextDebugMolecule() {
    return nextRandomItem(debugStressPool, debugSelectionState, smiles => String(smiles ?? ''));
  }

  function nextBugVerificationMolecule() {
    return nextRandomItem(bugVerificationPool, bugVerificationSelectionState, smiles => String(smiles ?? ''));
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
    deps.dom.getExamplesElement().innerHTML = `<i>examples:&nbsp;</i>${links}, <a href="#" onclick="pickRandomMolecule(); return false">random (simple)</a>, <a href="#" onclick="pickDebugMolecule(); return false">random (complex)</a>, <a href="#" onclick="pickBugVerificationMolecule(); return false">bug verification</a>`;
  }

  function pickRandomMolecule() {
    const inputMode = currentRandomPoolMode();
    const molecule = nextRandomMolecule(inputMode);
    if (!molecule) {
      return;
    }
    deps.actions.parseInput(inputMode === 'inchi' ? molecule.inchi : molecule.smiles);
  }

  function pickDebugMolecule() {
    const smiles = nextDebugMolecule();
    if (!smiles) {
      return;
    }
    deps.dom.getInputElement().value = smiles;
    syncCollectionPickerForInputValue(smiles);
    deps.actions.parseInputWithAutoFormat(smiles);
  }

  function pickBugVerificationMolecule() {
    const smiles = nextBugVerificationMolecule();
    if (!smiles) {
      return;
    }
    deps.dom.getInputElement().value = smiles;
    syncCollectionPickerForInputValue(smiles);
    deps.actions.parseInputWithAutoFormat(smiles);
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
    pickBugVerificationMolecule,
    pickDebugMolecule,
    getCollectionInputValue,
    syncCollectionPickerForInputValue
  };
}
