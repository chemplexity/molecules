import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initAppShell, initMainSidebarResizer } from '../../../src/app/ui/app-shell.js';

function makeResizableElement({ width = 0, right = width } = {}) {
  const listeners = new Map();
  const attributes = new Map();
  const styleValues = new Map();
  return {
    listeners,
    attributes,
    styleValues,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
    getBoundingClientRect: () => ({ width, right }),
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    style: {
      setProperty(name, value) {
        styleValues.set(name, value);
      },
      getPropertyValue(name) {
        return styleValues.get(name) ?? '';
      }
    }
  };
}

describe('initAppShell', () => {
  it('registers global bridges, handles resize, and bootstraps the initial molecule', () => {
    const records = [];
    const listeners = new Map();
    const win = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      }
    };
    const plotEl = {
      classes: new Set(),
      classList: {
        toggle: className => {
          if (plotEl.classes.has(className)) {
            plotEl.classes.delete(className);
            return false;
          }
          plotEl.classes.add(className);
          return true;
        },
        contains: className => plotEl.classes.has(className)
      }
    };
    const labelToggleEl = {
      classes: new Set(),
      classList: {
        toggle: (className, force) => {
          if (force) {
            labelToggleEl.classes.add(className);
            return true;
          }
          labelToggleEl.classes.delete(className);
          return false;
        }
      }
    };

    const shell = initAppShell({
      win,
      dom: {
        getPlotElement: () => plotEl,
        getLabelToggleElement: () => labelToggleEl
      },
      history: {
        undo: () => {
          records.push(['undo']);
        },
        redo: () => {
          records.push(['redo']);
        }
      },
      exportActions: {
        copyForcePng: () => {
          records.push(['copyForcePng']);
        },
        copyForceSvg: () => {
          records.push(['copyForceSvg']);
        },
        copySvg2d: () => {
          records.push(['copySvg2d']);
        },
        savePng2d: () => {
          records.push(['savePng2d']);
        }
      },
      options: {
        open: () => {
          records.push(['openOptionsModal']);
        }
      },
      navigation: {
        autoZoom: () => {
          records.push(['autoZoom']);
        },
        cleanLayout2d: () => {
          records.push(['cleanLayout2d']);
        },
        cleanLayoutForce: () => {
          records.push(['cleanLayoutForce']);
        },
        toggleMode: () => {
          records.push(['toggleMode']);
        }
      },
      selection: {
        togglePanMode: () => {
          records.push(['togglePanMode']);
        },
        toggleSelectMode: () => {
          records.push(['toggleSelectMode']);
        },
        togglePaintMode: () => {
          records.push(['togglePaintMode']);
        },
        setPaintTool: tool => {
          records.push(['setPaintTool', tool]);
        },
        setPaintColor: color => {
          records.push(['setPaintColor', color]);
        },
        setPaintBrushSize: size => {
          records.push(['setPaintBrushSize', size]);
        },
        setPaintOpacity: opacity => {
          records.push(['setPaintOpacity', opacity]);
        },
        toggleDrawBondMode: () => {
          records.push(['toggleDrawBondMode']);
        },
        handleDrawBondButtonClick: () => {
          records.push(['handleDrawBondButtonClick']);
        },
        openDrawBondDrawer: () => {
          records.push(['openDrawBondDrawer']);
        },
        closeDrawBondDrawer: () => {
          records.push(['closeDrawBondDrawer']);
        },
        toggleEraseMode: () => {
          records.push(['toggleEraseMode']);
        },
        setChargeTool: tool => {
          records.push(['setChargeTool', tool]);
        },
        setDrawElement: el => {
          records.push(['setDrawElement', el]);
        },
        togglePeriodicTablePicker: () => {
          records.push(['togglePeriodicTablePicker']);
        },
        selectPeriodicElement: el => {
          records.push(['selectPeriodicElement', el]);
        },
        setDrawBondType: type => {
          records.push(['setDrawBondType', type]);
        }
      },
      editing: {
        deleteSelection: () => {
          records.push(['deleteSelection']);
        }
      },
      state: {
        hasLoadedInput: () => true,
        getMode: () => 'force'
      },
      view: {
        handleForceResize: () => {
          records.push(['handleForceResize']);
        },
        handle2DResize: () => {
          records.push(['handle2DResize']);
        }
      },
      input: {
        parseSmiles: value => {
          records.push(['parseSmiles', value]);
        },
        parseInchi: value => {
          records.push(['parseInchi', value]);
        },
        parseInput: value => {
          records.push(['parseInput', value]);
        },
        setInputFormat: (fmt, options = {}) => {
          records.push(['setInputFormat', fmt, options]);
        },
        renderExamples: () => {
          records.push(['renderExamples']);
        },
        pickRandomMolecule: () => {
          records.push(['pickRandomMolecule']);
        },
        getCanonicalMol: () => ({ id: 'mol' }),
        toSmiles: mol => `smiles:${mol.id}`,
        toInchi: mol => `inchi:${mol.id}`,
        takeInputFormatSnapshot: payload => {
          records.push(['takeInputFormatSnapshot', payload]);
        }
      },
      initialState: {
        getInitialSmiles: () => 'CCO',
        setInputValue: value => {
          records.push(['setInputValue', value]);
        },
        syncCollectionPicker: value => {
          records.push(['syncCollectionPicker', value]);
        }
      }
    });

    shell.bootstrap();
    listeners.get('resize')();
    win.undoAction();
    win.redoAction();
    win.copyForcePng();
    win.copyForceSvg();
    win.copySvg2d();
    win.savePng2d();
    win.openOptionsModal();
    win.toggleLabels();
    win.autoZoomView();
    win.cleanLayout2d();
    win.cleanLayoutForce();
    win.togglePanMode();
    win.toggleSelectMode();
    win.togglePaintMode();
    win.setPaintTool('bucket');
    win.setPaintColor('#ff6633');
    win.setPaintBrushSize(18);
    win.setPaintOpacity(0.45);
    win.toggleDrawBondMode();
    win.handleDrawBondButtonClick();
    win.openDrawBondDrawer();
    win.closeDrawBondDrawer();
    win.toggleEraseMode();
    win.setChargeTool('positive');
    win.setDrawElement('N');
    win.togglePeriodicTablePicker();
    win.selectPeriodicElement('Fe');
    win.setDrawBondType('dash');
    win.toggleMode();
    win._parseSmiles('CCN');
    win._parseInchi('InChI=1S/CH4/h1H4');
    win._parseInput('CCO');
    win._setInputFormat('inchi', { preserveSelection: true });
    win._renderExamples();
    win._pickRandomMolecule();
    win._takeInputFormatSnapshot({ foo: 'bar' });
    win.deleteSelection();

    assert.equal(win._getMolSmiles(), 'smiles:mol');
    assert.equal(win._getMolInchi(), 'inchi:mol');
    assert.equal(plotEl.classes.has('labels-hidden'), true);
    assert.equal(labelToggleEl.classes.has('active'), false);
    assert.deepEqual(records, [
      ['renderExamples'],
      ['setInputValue', 'CCO'],
      ['syncCollectionPicker', 'CCO'],
      ['parseSmiles', 'CCO'],
      ['handleForceResize'],
      ['undo'],
      ['redo'],
      ['copyForcePng'],
      ['copyForceSvg'],
      ['copySvg2d'],
      ['savePng2d'],
      ['openOptionsModal'],
      ['autoZoom'],
      ['cleanLayout2d'],
      ['cleanLayoutForce'],
      ['togglePanMode'],
      ['toggleSelectMode'],
      ['togglePaintMode'],
      ['setPaintTool', 'bucket'],
      ['setPaintColor', '#ff6633'],
      ['setPaintBrushSize', 18],
      ['setPaintOpacity', 0.45],
      ['toggleDrawBondMode'],
      ['handleDrawBondButtonClick'],
      ['openDrawBondDrawer'],
      ['closeDrawBondDrawer'],
      ['toggleEraseMode'],
      ['setChargeTool', 'positive'],
      ['setDrawElement', 'N'],
      ['togglePeriodicTablePicker'],
      ['selectPeriodicElement', 'Fe'],
      ['setDrawBondType', 'dash'],
      ['toggleMode'],
      ['parseSmiles', 'CCN'],
      ['parseInchi', 'InChI=1S/CH4/h1H4'],
      ['parseInput', 'CCO'],
      ['setInputFormat', 'inchi', { preserveSelection: true }],
      ['renderExamples'],
      ['pickRandomMolecule'],
      ['takeInputFormatSnapshot', { foo: 'bar' }],
      ['deleteSelection']
    ]);
  });

  it('skips resize work without an active molecule and routes 2D resize to the 2D handler', () => {
    const listeners = new Map();
    const records = [];
    const win = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      }
    };
    const shell = initAppShell({
      win,
      dom: {
        getPlotElement: () => ({
          classList: {
            toggle() {},
            contains() {
              return false;
            }
          }
        }),
        getLabelToggleElement: () => ({ classList: { toggle() {} } })
      },
      history: { undo() {}, redo() {} },
      exportActions: { copyForcePng() {}, copyForceSvg() {}, copySvg2d() {}, savePng2d() {} },
      options: { open() {} },
      navigation: { autoZoom() {}, cleanLayout2d() {}, cleanLayoutForce() {}, toggleMode() {} },
      selection: {
        togglePanMode() {},
        toggleSelectMode() {},
        togglePaintMode() {},
        setPaintTool() {},
        setPaintColor() {},
        setPaintBrushSize() {},
        setPaintOpacity() {},
        toggleDrawBondMode() {},
        handleDrawBondButtonClick() {},
        openDrawBondDrawer() {},
        closeDrawBondDrawer() {},
        toggleEraseMode() {},
        setDrawElement() {},
        setDrawBondType() {}
      },
      editing: { deleteSelection() {} },
      state: {
        hasLoadedInput: () => false,
        getMode: () => '2d'
      },
      view: {
        handleForceResize: () => {
          records.push('force');
        },
        handle2DResize: () => {
          records.push('2d');
        }
      },
      input: {
        parseSmiles() {},
        parseInchi() {},
        parseInput() {},
        setInputFormat() {},
        renderExamples() {},
        pickRandomMolecule() {},
        getCanonicalMol: () => null,
        toSmiles: () => '',
        toInchi: () => '',
        takeInputFormatSnapshot() {}
      },
      initialState: {
        getInitialSmiles: () => 'CCO',
        setInputValue() {},
        syncCollectionPicker() {}
      }
    });

    listeners.get('resize')();
    assert.deepEqual(records, []);

    shell.handleResize = listeners.get('resize');
    const shell2 = initAppShell({
      win: {
        addEventListener(type, handler) {
          listeners.set(`second:${type}`, handler);
        }
      },
      dom: {
        getPlotElement: () => ({
          classList: {
            toggle() {},
            contains() {
              return false;
            }
          }
        }),
        getLabelToggleElement: () => ({ classList: { toggle() {} } })
      },
      history: { undo() {}, redo() {} },
      exportActions: { copyForcePng() {}, copyForceSvg() {}, copySvg2d() {}, savePng2d() {} },
      options: { open() {} },
      navigation: { autoZoom() {}, cleanLayout2d() {}, cleanLayoutForce() {}, toggleMode() {} },
      selection: {
        togglePanMode() {},
        toggleSelectMode() {},
        togglePaintMode() {},
        setPaintTool() {},
        setPaintColor() {},
        setPaintBrushSize() {},
        setPaintOpacity() {},
        toggleDrawBondMode() {},
        handleDrawBondButtonClick() {},
        openDrawBondDrawer() {},
        closeDrawBondDrawer() {},
        toggleEraseMode() {},
        setDrawElement() {},
        setDrawBondType() {}
      },
      editing: { deleteSelection() {} },
      state: {
        hasLoadedInput: () => true,
        getMode: () => '2d'
      },
      view: {
        handleForceResize: () => {
          records.push('force');
        },
        handle2DResize: () => {
          records.push('2d');
        }
      },
      input: {
        parseSmiles() {},
        parseInchi() {},
        parseInput() {},
        setInputFormat() {},
        renderExamples() {},
        pickRandomMolecule() {},
        getCanonicalMol: () => null,
        toSmiles: () => '',
        toInchi: () => '',
        takeInputFormatSnapshot() {}
      },
      initialState: {
        getInitialSmiles: () => 'CCO',
        setInputValue() {},
        syncCollectionPicker() {}
      }
    });

    listeners.get('second:resize')();
    assert.deepEqual(records, ['2d']);
    assert.equal(typeof shell2.bootstrap, 'function');
  });

  it('drags and persists the main sidebar splitter width', () => {
    const contentMain = makeResizableElement({ width: 1000, right: 1000 });
    const sidebar = makeResizableElement({ width: 290, right: 1000 });
    const splitter = makeResizableElement();
    const docListeners = new Map();
    const bodyClasses = new Set();
    const storage = new Map();
    const resizeRecords = [];
    const doc = {
      addEventListener(type, handler) {
        docListeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (docListeners.get(type) === handler) {
          docListeners.delete(type);
        }
      },
      body: {
        classList: {
          add: name => bodyClasses.add(name),
          remove: name => bodyClasses.delete(name)
        }
      }
    };
    const win = {
      document: doc,
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
      }
    };
    let prevented = 0;
    const preventDefault = () => {
      prevented += 1;
    };

    initMainSidebarResizer(
      {
        win,
        dom: {
          getDocument: () => doc,
          getContentMainElement: () => contentMain,
          getSidebarElement: () => sidebar,
          getMainSidebarSplitterElement: () => splitter
        }
      },
      {
        onResize: () => resizeRecords.push(contentMain.style.getPropertyValue('--sidebar-width'))
      }
    );

    splitter.dispatch('pointerdown', { button: 0, pointerId: 12, clientX: 700, preventDefault });
    assert.equal(bodyClasses.has('resizing-main-sidebar'), true);
    assert.equal(typeof docListeners.get('pointermove'), 'function');

    docListeners.get('pointermove')({ clientX: 620, preventDefault });
    assert.equal(contentMain.style.getPropertyValue('--sidebar-width'), '380px');
    assert.deepEqual(resizeRecords, ['380px']);

    docListeners.get('pointerup')({ clientX: 610, preventDefault });
    assert.equal(contentMain.style.getPropertyValue('--sidebar-width'), '390px');
    assert.equal(storage.get('molecules.mainSidebarWidthPx'), '390');
    assert.equal(splitter.attributes.get('aria-valuenow'), '390');
    assert.equal(bodyClasses.has('resizing-main-sidebar'), false);
    assert.equal(docListeners.has('pointermove'), false);
    assert.ok(prevented >= 3);

    splitter.dispatch('keydown', { key: 'ArrowRight', preventDefault });
    assert.equal(contentMain.style.getPropertyValue('--sidebar-width'), '366px');
    assert.equal(storage.get('molecules.mainSidebarWidthPx'), '366');

    splitter.dispatch('keydown', { key: 'Home', preventDefault });
    assert.equal(contentMain.style.getPropertyValue('--sidebar-width'), '220px');

    splitter.dispatch('keydown', { key: 'End', preventDefault });
    assert.equal(contentMain.style.getPropertyValue('--sidebar-width'), '640px');
  });
});
