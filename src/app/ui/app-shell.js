/** @module app/ui/app-shell */

function bindGlobal(win, name, handler) {
  win[name] = handler;
  return handler;
}

function serializeCurrentMol(getMol, serialize) {
  const mol = getMol();
  if (!mol) {
    return null;
  }
  try {
    return serialize(mol);
  } catch {
    return null;
  }
}

/**
 * Binds all global window action handlers required by the application shell.
 * @param {object} context - Flat app context providing DOM, history, export, options, and navigation accessors.
 * @returns {void}
 */
export function initAppShell(context) {
  const { win = window } = context;

  bindGlobal(win, 'undoAction', () => context.history.undo());
  bindGlobal(win, 'redoAction', () => context.history.redo());

  bindGlobal(win, 'copyForcePng', () => context.exportActions.copyForcePng());
  bindGlobal(win, 'copyForceSvg', () => context.exportActions.copyForceSvg());
  bindGlobal(win, 'copySvg2d', () => context.exportActions.copySvg2d());
  bindGlobal(win, 'savePng2d', () => context.exportActions.savePng2d());

  bindGlobal(win, 'openOptionsModal', () => context.options.open());

  bindGlobal(win, 'toggleLabels', () => {
    const svgEl = context.dom.getPlotElement();
    svgEl.classList.toggle('labels-hidden');
    const btn = context.dom.getLabelToggleElement();
    btn.classList.toggle('active', !svgEl.classList.contains('labels-hidden'));
  });

  bindGlobal(win, 'cleanLayout2d', () => context.navigation.cleanLayout2d());
  bindGlobal(win, 'cleanLayoutForce', () => context.navigation.cleanLayoutForce());
  bindGlobal(win, 'togglePanMode', () => context.selection.togglePanMode());
  bindGlobal(win, 'toggleSelectMode', () => context.selection.toggleSelectMode());
  bindGlobal(win, 'toggleDrawBondMode', () => context.selection.toggleDrawBondMode());
  bindGlobal(win, 'handleDrawBondButtonClick', () => context.selection.handleDrawBondButtonClick());
  bindGlobal(win, 'openDrawBondDrawer', () => context.selection.openDrawBondDrawer());
  bindGlobal(win, 'closeDrawBondDrawer', () => context.selection.closeDrawBondDrawer());
  bindGlobal(win, 'toggleEraseMode', () => context.selection.toggleEraseMode());
  bindGlobal(win, 'setChargeTool', tool => context.selection.setChargeTool(tool));
  bindGlobal(win, 'setDrawElement', el => context.selection.setDrawElement(el));
  bindGlobal(win, 'setDrawBondType', type => context.selection.setDrawBondType(type));
  bindGlobal(win, 'toggleMode', () => context.navigation.toggleMode());

  bindGlobal(win, '_parseSmiles', smiles => context.input.parseSmiles(smiles));
  bindGlobal(win, '_parseInchi', inchi => context.input.parseInchi(inchi));
  bindGlobal(win, '_parseInput', value => context.input.parseInput(value));
  bindGlobal(win, '_setInputFormat', (fmt, options = {}) => context.input.setInputFormat(fmt, options));
  bindGlobal(win, '_renderExamples', () => context.input.renderExamples());
  bindGlobal(win, '_pickRandomMolecule', () => context.input.pickRandomMolecule());
  bindGlobal(win, '_pickBugVerificationMolecule', () => context.input.pickBugVerificationMolecule());
  bindGlobal(win, '_pickDebugMolecule', () => context.input.pickDebugMolecule());
  bindGlobal(win, '_getMolSmiles', () => serializeCurrentMol(context.input.getCanonicalMol, context.input.toSmiles));
  bindGlobal(win, '_getMolInchi', () => serializeCurrentMol(context.input.getCanonicalMol, context.input.toInchi));
  bindGlobal(win, '_takeInputFormatSnapshot', payload => context.input.takeInputFormatSnapshot(payload));
  bindGlobal(win, 'deleteSelection', () => context.editing.deleteSelection());

  const handleResize = () => {
    if (!context.state.hasLoadedInput()) {
      return;
    }
    if (context.state.getMode() === 'force') {
      context.view.handleForceResize();
      return;
    }
    context.view.handle2DResize();
  };

  win.addEventListener('resize', handleResize);

  function bootstrap() {
    context.input.renderExamples();
    const initialSmiles = context.initialState.getInitialSmiles();
    context.initialState.setInputValue(initialSmiles);
    context.initialState.syncCollectionPicker(initialSmiles);
    context.input.parseSmiles(initialSmiles);
  }

  return {
    bootstrap,
    handleResize
  };
}
