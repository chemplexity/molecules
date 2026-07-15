/** @module app/core/input-flow */

const INVALID_INPUT_CLASS = 'invalid-chemical-input';

/**
 * Creates the input flow manager that handles parsing, rendering, format switching, and clearing of molecules from user input.
 * @param {object} deps - Dependency object providing state, dom, history, snapshot, molecule, collection, examples, parsers, overlays, renderers, highlights, force, and analysis.
 * @returns {object} Object with `setInputFormat`, `clearMolecule`, `parseAndRenderSmiles`, `parseAndRenderInchi`, `parseInputWithAutoFormat`, `parseInput`, and `takeInputFormatSnapshot`.
 */
export function createInputFlowManager(deps) {
  function setInputInvalid(message = 'Invalid chemical input') {
    const inputEl = deps.dom.getInputElement?.();
    inputEl?.classList?.toggle?.(INVALID_INPUT_CLASS, true);
    inputEl?.setAttribute?.('aria-invalid', 'true');
    if (inputEl) {
      inputEl.title = message;
    }
  }

  function clearInputInvalid() {
    const inputEl = deps.dom.getInputElement?.();
    inputEl?.classList?.toggle?.(INVALID_INPUT_CLASS, false);
    inputEl?.removeAttribute?.('aria-invalid');
    if (inputEl?.title) {
      inputEl.title = '';
    }
  }

  function takeInputFormatSnapshot({ prevInputMode, visibleInputValue } = {}) {
    const currentMolSmiles = deps.molecule.getMolSmiles?.() ?? '';
    const currentMolInchi = deps.molecule.getMolInchi?.() ?? '';
    deps.history.takeSnapshot({
      clearReactionPreview: false,
      documentState: {
        currentSmiles: (prevInputMode === 'smiles' ? visibleInputValue : (deps.state.getCurrentSmiles() ?? currentMolSmiles)) || null,
        currentInchi: (prevInputMode === 'inchi' ? visibleInputValue : (deps.state.getCurrentInchi() ?? currentMolInchi)) || null,
        inputMode: prevInputMode ?? deps.state.getInputMode(),
        inputValue: visibleInputValue ?? ''
      }
    });
  }

  function setInputFormat(fmt, options = {}) {
    const { preserveInput = false, inputValue = null, recordHistory = !preserveInput } = options;
    const prev = deps.state.getInputMode();
    const inputEl = deps.dom.getInputElement();

    if (fmt === prev && !preserveInput && inputValue === null) {
      return;
    }

    if (fmt !== prev && recordHistory) {
      takeInputFormatSnapshot({
        prevInputMode: prev,
        visibleInputValue: inputEl.value ?? ''
      });
    }

    deps.state.setInputMode(fmt);
    deps.dom.setInputFormatButtons(fmt);
    deps.dom.setInputLabel(fmt === 'inchi' ? 'Input InChI notation...' : 'Input SMILES notation...');
    clearInputInvalid();

    let nextValue = preserveInput ? (inputValue ?? inputEl.value) : '';
    if (!preserveInput && fmt === 'smiles' && prev === 'inchi') {
      nextValue = deps.molecule.getMolSmiles?.() || '';
    }
    if (!preserveInput && fmt === 'inchi' && prev === 'smiles') {
      nextValue = deps.molecule.getMolInchi?.() || '';
    }
    if (!preserveInput) {
      nextValue = deps.collection.getInputValue?.(fmt) || nextValue;
    }

    inputEl.value = nextValue;
    if (fmt === 'inchi') {
      deps.state.setCurrentInchi(nextValue || null);
    } else {
      deps.state.setCurrentSmiles(nextValue || null);
    }
    deps.collection.syncPickerForInputValue?.(nextValue);
    deps.examples.render();
  }

  function clearMolecule() {
    clearInputInvalid();
    if (deps.state.getCurrentMol() || deps.state.getMol2d()) {
      deps.history.takeSnapshot({ clearReactionPreview: false });
    }
    deps.overlays.clearReactionPreviewState();
    deps.state.setCurrentMol(null);
    deps.state.setCurrentSmiles(null);
    deps.state.setCurrentInchi(null);
    deps.state.setMol2d(null);
    deps.state.clear2dDerivedState();
    deps.state.clearSelection();
    deps.state.clearHovered();
    deps.highlights.clear();
    deps.renderers.clearScene();
    deps.state.clearForceRenderCaches();
    deps.state.resetValenceWarnings();
    deps.force.clearIfActive();
    deps.analysis.clearSummary();
    deps.analysis.updatePanels(null);
  }

  function buildPreviousDocumentState() {
    if (!(deps.state.getCurrentMol() || deps.state.getMol2d())) {
      return null;
    }
    const previousInputSmiles = deps.state.getCurrentSmiles() ?? deps.molecule.getMolSmiles?.() ?? '';
    const previousInputInchi = deps.state.getCurrentInchi() ?? deps.molecule.getMolInchi?.() ?? '';
    const inputMode = deps.state.getInputMode();
    return {
      currentSmiles: previousInputSmiles || null,
      currentInchi: previousInputInchi || null,
      inputMode,
      inputValue: inputMode === 'inchi' ? previousInputInchi : previousInputSmiles
    };
  }

  function capturePreviousSnapshot() {
    const previousDocumentState = buildPreviousDocumentState();
    return previousDocumentState ? deps.snapshot.capture({ documentState: previousDocumentState }) : null;
  }

  function parseAndRenderSmiles(smiles, options = {}) {
    const { previousSnapshot = null } = options;
    if (typeof smiles !== 'string' || smiles.length === 0 || smiles.length > 2000) {
      setInputInvalid('Invalid SMILES input');
      return false;
    }
    if (smiles === deps.state.getCurrentSmiles() && deps.state.getMode() === 'force' && !deps.overlays.hasReactionPreview()) {
      clearInputInvalid();
      deps.analysis.updatePanels(deps.state.getCurrentMol(), { recomputeResonance: false });
      return true;
    }

    let mol;
    try {
      mol = deps.parsers.parseSMILES(smiles);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('SMILES parse error:', error.message);
      setInputInvalid('Invalid SMILES input');
      return false;
    }

    if (!mol || mol.atoms.size === 0) {
      setInputInvalid('Invalid SMILES input');
      return false;
    }

    clearInputInvalid();
    const snapshotToUse = previousSnapshot ?? capturePreviousSnapshot();
    deps.overlays.clearReactionPreviewState();
    if (deps.state.getCurrentMol() || deps.state.getMol2d()) {
      deps.history.takeSnapshot({
        clearReactionPreview: false,
        snapshot: snapshotToUse
      });
    }
    deps.state.setCurrentSmiles(smiles);
    deps.state.setCurrentInchi(null);
    deps.renderers.renderMol(mol, { preserveHistory: true });
    return true;
  }

  function parseAndRenderInchi(inchi, options = {}) {
    const { previousSnapshot = null } = options;
    if (typeof inchi !== 'string' || inchi.length === 0 || inchi.length > 2000) {
      setInputInvalid('Invalid InChI input');
      return false;
    }

    let mol;
    try {
      mol = deps.parsers.parseINCHI(inchi);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('InChI parse error:', error.message);
      setInputInvalid('Invalid InChI input');
      return false;
    }

    if (!mol || mol.atoms.size === 0) {
      setInputInvalid('Invalid InChI input');
      return false;
    }

    clearInputInvalid();
    const snapshotToUse = previousSnapshot ?? capturePreviousSnapshot();
    deps.overlays.clearReactionPreviewState();
    if (deps.state.getCurrentMol() || deps.state.getMol2d()) {
      deps.history.takeSnapshot({
        clearReactionPreview: false,
        snapshot: snapshotToUse
      });
    }
    deps.state.setCurrentSmiles(null);
    deps.state.setCurrentInchi(inchi);
    deps.renderers.renderMol(mol, { preserveHistory: true });
    return true;
  }

  function parseInputWithAutoFormat(rawValue) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (value.length === 0) {
      clearMolecule();
      return false;
    }

    const detectedFormat = deps.parsers.detectChemicalStringFormat(value);
    const parseFormat = detectedFormat ?? deps.state.getInputMode();
    const previousSnapshot = detectedFormat && detectedFormat !== deps.state.getInputMode() ? capturePreviousSnapshot() : null;

    if (detectedFormat && detectedFormat !== deps.state.getInputMode()) {
      setInputFormat(detectedFormat, {
        preserveInput: true,
        inputValue: value
      });
    }

    if (parseFormat === 'inchi') {
      return parseAndRenderInchi(value, { previousSnapshot });
    } else {
      return parseAndRenderSmiles(value, { previousSnapshot });
    }
  }

  function parseInput(value) {
    if (!value) {
      clearInputInvalid();
      return false;
    }
    const inputEl = deps.dom.getInputElement();
    inputEl.value = value;
    deps.collection.syncPickerForInputValue?.(value);
    if (deps.state.getInputMode() === 'inchi') {
      return parseAndRenderInchi(value);
    } else {
      return parseAndRenderSmiles(value);
    }
  }

  return {
    setInputFormat,
    clearMolecule,
    parseAndRenderSmiles,
    parseAndRenderInchi,
    parseInputWithAutoFormat,
    parseInput,
    takeInputFormatSnapshot
  };
}
