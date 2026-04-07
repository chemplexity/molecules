import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initKeyboardInteractions } from '../../../src/app/interactions/keyboard.js';

function makeKeyboardContext({ activeTagName = 'BODY' } = {}) {
  const handlers = new Map();
  const records = [];
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
        getActiveMolecule: () => null
      },
      viewState: {
        getMode: () => '2d'
      },
      overlayState: {
        getSelectionModifierActive: () => false,
        setSelectionModifierActive() {},
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        getEraseMode: () => false,
        getSelectedAtomIds: () => new Set(),
        getSelectedBondIds: () => new Set(),
        getHoveredAtomIds: () => new Set(),
        getHoveredBondIds: () => new Set()
      }
    },
    selection: {
      toggleSelectMode() {},
      toggleDrawBondMode() {}
    },
    drawBond: {
      hasDrawBondState: () => false,
      cancelDrawBond() {}
    },
    overlays: {
      isReactionPreviewEditableAtomId: () => true
    },
    actions: {
      changeAtomElements() {},
      deleteSelection() {},
      deleteTargets() {}
    },
    history: {
      undo() {
        records.push('undo');
      },
      redo() {
        records.push('redo');
      }
    },
    view: {
      refreshSelectionOverlay() {},
      applySelectionOverlay() {},
      getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      setZoomTransform() {},
      makeZoomIdentity: (x, y, k) => ({ x, y, k }),
      clearPrimitiveHover() {}
    }
  });

  return {
    handlers,
    records
  };
}

describe('initKeyboardInteractions', () => {
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
});
