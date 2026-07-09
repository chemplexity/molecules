import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initKeyboardInteractions } from '../../../src/app/interactions/keyboard.js';

function makeKeyboardContext({
  activeTagName = 'BODY',
  activeMolecule = null,
  mode = '2d',
  selectMode = false,
  ringTemplateMode = false,
  hoveredAtomIds = new Set(),
  hoveredBondIds = new Set(),
  placementRedirectedHoverAtomIds = new Set(),
  placementRedirectedHoverBondIds = new Set(),
  selectedAtomIds = new Set(),
  selectedBondIds = new Set(),
  clipboard = null
} = {}) {
  const handlers = new Map();
  const records = [];
  let selectionModifierActive = false;
  const doc = {
    activeElement: { tagName: activeTagName },
    addEventListener(type, handler) {
      handlers.set(type, handler);
    }
  };
  const win = {
    addEventListener(type, handler) {
      handlers.set(`win:${type}`, handler);
    }
  };

  initKeyboardInteractions({
    doc,
    win,
    state: {
      documentState: {
        getActiveMolecule: () => activeMolecule
      },
      viewState: {
        getMode: () => mode
      },
      overlayState: {
        getSelectionModifierActive: () => selectionModifierActive,
        setSelectionModifierActive(value) {
          selectionModifierActive = value;
          records.push(['setSelectionModifierActive', value]);
        },
        getSelectMode: () => selectMode,
        getDrawBondMode: () => false,
        getRingTemplateMode: () => ringTemplateMode,
        getEraseMode: () => false,
        getSelectedAtomIds: () => selectedAtomIds,
        getSelectedBondIds: () => selectedBondIds,
        getHoveredAtomIds: () => hoveredAtomIds,
        getHoveredBondIds: () => hoveredBondIds,
        getPlacementRedirectedHoverAtomIds: () => placementRedirectedHoverAtomIds,
        getPlacementRedirectedHoverBondIds: () => placementRedirectedHoverBondIds
      }
    },
    selection: {
      toggleSelectMode() {},
      toggleDrawBondMode() {},
      setChargeTool(tool) {
        records.push(['setChargeTool', tool]);
      }
    },
    drawBond: {
      hasDrawBondState: () => false,
      cancelDrawBond() {}
    },
    overlays: {
      isReactionPreviewEditableAtomId: () => true
    },
    actions: {
      changeAtomElements(atomIds, element) {
        records.push(['changeAtomElements', atomIds, element]);
      },
      deleteSelection() {},
      deleteTargets(atomIds, bondIds, options) {
        records.push(['deleteTargets', atomIds, bondIds, options]);
      }
    },
    clipboard,
    history: {
      undo() {
        records.push('undo');
      },
      redo() {
        records.push('redo');
      }
    },
    view: {
      refreshSelectionOverlay() {
        records.push(['refreshSelectionOverlay']);
      },
      applySelectionOverlay() {},
      getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      setZoomTransform() {},
      makeZoomIdentity: (x, y, k) => ({ x, y, k }),
      clearPrimitiveHover() {
        records.push(['clearPrimitiveHover']);
        hoveredAtomIds.clear();
        hoveredBondIds.clear();
        placementRedirectedHoverAtomIds.clear();
        placementRedirectedHoverBondIds.clear();
      }
    }
  });

  return {
    handlers,
    records,
    hoveredAtomIds,
    hoveredBondIds,
    getSelectionModifierActive: () => selectionModifierActive
  };
}

describe('initKeyboardInteractions', () => {
  it('uses Shift as a live selection modifier like Command or Control', () => {
    const { handlers, records, getSelectionModifierActive } = makeKeyboardContext();

    handlers.get('keydown')({
      key: 'Shift',
      metaKey: false,
      ctrlKey: false,
      shiftKey: true
    });

    assert.equal(getSelectionModifierActive(), true);
    assert.deepEqual(records, [['setSelectionModifierActive', true], ['refreshSelectionOverlay']]);

    handlers.get('keyup')({
      key: 'Shift',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false
    });

    assert.equal(getSelectionModifierActive(), false);
    assert.deepEqual(records, [['setSelectionModifierActive', true], ['refreshSelectionOverlay'], ['setSelectionModifierActive', false], ['refreshSelectionOverlay']]);
  });

  it('routes cmd-z to app undo even when an input is focused', () => {
    const { handlers, records } = makeKeyboardContext({ activeTagName: 'INPUT' });
    let prevented = false;

    handlers.get('keydown')({
      key: 'z',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, ['undo']);
    assert.equal(prevented, true);
  });

  it('routes copy and paste shortcuts to clipboard actions outside text inputs', () => {
    const records = [];
    const { handlers } = makeKeyboardContext({
      clipboard: {
        copySelection() {
          records.push(['copySelection']);
          return true;
        },
        beginPastePreview() {
          records.push(['beginPastePreview']);
          return true;
        }
      }
    });
    let preventCount = 0;

    handlers.get('keydown')({
      key: 'c',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      preventDefault() {
        preventCount += 1;
      }
    });
    handlers.get('keydown')({
      key: 'v',
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      preventDefault() {
        preventCount += 1;
      }
    });

    assert.deepEqual(records, [['copySelection'], ['beginPastePreview']]);
    assert.equal(preventCount, 2);
  });

  it('lets native copy and paste run in text inputs', () => {
    const records = [];
    const { handlers } = makeKeyboardContext({
      activeTagName: 'INPUT',
      clipboard: {
        copySelection() {
          records.push(['copySelection']);
          return true;
        },
        beginPastePreview() {
          records.push(['beginPastePreview']);
          return true;
        }
      }
    });
    let prevented = false;

    handlers.get('keydown')({
      key: 'c',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      preventDefault() {
        prevented = true;
      }
    });
    handlers.get('keydown')({
      key: 'v',
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, []);
    assert.equal(prevented, false);
  });

  it('cancels paste preview with Escape before other escape behavior', () => {
    const records = [];
    const { handlers } = makeKeyboardContext({
      clipboard: {
        cancelPastePreview() {
          records.push(['cancelPastePreview']);
          return true;
        }
      }
    });
    let prevented = false;

    handlers.get('keydown')({
      key: 'Escape',
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, [['cancelPastePreview']]);
    assert.equal(prevented, true);
  });

  it('routes cmd-shift-z with uppercase key values to app redo', () => {
    const { handlers, records } = makeKeyboardContext();
    let prevented = false;

    handlers.get('keydown')({
      key: 'Z',
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, ['redo']);
    assert.equal(prevented, true);
  });

  it('routes the main keyboard plus shortcut to positive charge mode', () => {
    const { handlers, records } = makeKeyboardContext();
    let prevented = false;

    handlers.get('keydown')({
      key: '+',
      code: 'Equal',
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      repeat: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, [['setChargeTool', 'positive']]);
    assert.equal(prevented, true);
  });

  it('routes the main keyboard minus shortcut to negative charge mode', () => {
    const { handlers, records } = makeKeyboardContext();
    let prevented = false;

    handlers.get('keydown')({
      key: '-',
      code: 'Minus',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, [['setChargeTool', 'negative']]);
    assert.equal(prevented, true);
  });

  it('routes numpad charge shortcuts to the matching charge tools', () => {
    const { handlers, records } = makeKeyboardContext();

    handlers.get('keydown')({
      key: '+',
      code: 'NumpadAdd',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
      preventDefault() {}
    });

    handlers.get('keydown')({
      key: '-',
      code: 'NumpadSubtract',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
      preventDefault() {}
    });

    assert.deepEqual(records, [
      ['setChargeTool', 'positive'],
      ['setChargeTool', 'negative']
    ]);
  });

  it('deletes a hovered atom while ring-template mode is active', () => {
    const mol = {
      atoms: new Map([['a1', { id: 'a1', name: 'C' }]]),
      bonds: new Map()
    };
    const { handlers, records, hoveredAtomIds } = makeKeyboardContext({
      activeMolecule: mol,
      ringTemplateMode: true,
      hoveredAtomIds: new Set(['a1'])
    });
    let prevented = false;

    handlers.get('keydown')({
      key: 'Backspace',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, [['clearPrimitiveHover'], ['deleteTargets', ['a1'], [], { transient: true }]]);
    assert.equal(hoveredAtomIds.size, 0);
    assert.equal(prevented, true);
  });

  it('changes a hovered atom element while ring-template mode is active', () => {
    const mol = {
      atoms: new Map([['a1', { id: 'a1', name: 'C' }]]),
      bonds: new Map()
    };
    const { handlers, records } = makeKeyboardContext({
      activeMolecule: mol,
      ringTemplateMode: true,
      hoveredAtomIds: new Set(['a1'])
    });
    let prevented = false;

    handlers.get('keydown')({
      key: 'O',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, [['changeAtomElements', ['a1'], 'O']]);
    assert.equal(prevented, true);
  });

  it('ignores ring-template element shortcuts when the hovered atom already matches', () => {
    const mol = {
      atoms: new Map([['a1', { id: 'a1', name: 'O' }]]),
      bonds: new Map()
    };
    const { handlers, records } = makeKeyboardContext({
      activeMolecule: mol,
      ringTemplateMode: true,
      hoveredAtomIds: new Set(['a1'])
    });
    let prevented = false;

    handlers.get('keydown')({
      key: 'o',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, []);
    assert.equal(prevented, true);
  });

  it('deletes a hovered bond while ring-template mode is active', () => {
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1', name: 'C' }],
        ['a2', { id: 'a2', name: 'C' }]
      ]),
      bonds: new Map([['b1', { id: 'b1', atoms: ['a1', 'a2'] }]])
    };
    const { handlers, records, hoveredBondIds } = makeKeyboardContext({
      activeMolecule: mol,
      ringTemplateMode: true,
      hoveredBondIds: new Set(['b1'])
    });
    let prevented = false;

    handlers.get('keydown')({
      key: 'Delete',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {
        prevented = true;
      }
    });

    assert.deepEqual(records, [['clearPrimitiveHover'], ['deleteTargets', [], ['b1'], { transient: true }]]);
    assert.equal(hoveredBondIds.size, 0);
    assert.equal(prevented, true);
  });

  it('does not delete hovered force hydrogens or hydrogen bonds outside placement routing', () => {
    const mol = {
      atoms: new Map([
        ['c1', { id: 'c1', name: 'C' }],
        ['h1', { id: 'h1', name: 'H' }]
      ]),
      bonds: new Map([['b1', { id: 'b1', atoms: ['c1', 'h1'] }]])
    };
    const { handlers, records } = makeKeyboardContext({
      activeMolecule: mol,
      mode: 'force',
      selectMode: true,
      hoveredAtomIds: new Set(['h1']),
      hoveredBondIds: new Set(['b1'])
    });

    handlers.get('keydown')({
      key: 'Delete',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {}
    });

    assert.deepEqual(records, [['clearPrimitiveHover'], ['deleteTargets', [], [], { transient: true }]]);
  });

  it('allows Delete to remove hovered force stereochemical hydrogens and their displayed bonds', () => {
    const mol = {
      atoms: new Map([
        ['c1', { id: 'c1', name: 'C', bonds: ['b1'] }],
        ['h1', { id: 'h1', name: 'H', bonds: ['b1'] }]
      ]),
      bonds: new Map([['b1', { id: 'b1', atoms: ['c1', 'h1'], properties: { display: { as: 'wedge', centerId: 'c1' } } }]])
    };
    const { handlers, records } = makeKeyboardContext({
      activeMolecule: mol,
      mode: 'force',
      selectMode: true,
      hoveredAtomIds: new Set(['h1']),
      hoveredBondIds: new Set(['b1'])
    });

    handlers.get('keydown')({
      key: 'Delete',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {}
    });

    assert.deepEqual(records, [['clearPrimitiveHover'], ['deleteTargets', ['h1'], ['b1'], { transient: true }]]);
  });

  it('does not delete force atoms highlighted only by hydrogen placement routing', () => {
    const mol = {
      atoms: new Map([['c1', { id: 'c1', name: 'C' }]]),
      bonds: new Map()
    };
    const { handlers, records } = makeKeyboardContext({
      activeMolecule: mol,
      mode: 'force',
      selectMode: true,
      hoveredAtomIds: new Set(['c1']),
      placementRedirectedHoverAtomIds: new Set(['c1'])
    });

    handlers.get('keydown')({
      key: 'Delete',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {}
    });

    assert.deepEqual(records, [['clearPrimitiveHover'], ['deleteTargets', [], [], { transient: true }]]);
  });
});
