import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initGestureInteractions } from '../../../src/app/interactions/gesture-layer.js';

function makeSelection(node = null) {
  const handlers = new Map();
  const attrs = new Map();
  const styles = new Map();
  return {
    handlers,
    attrs,
    styles,
    on(name, handler) {
      handlers.set(name, handler);
      return this;
    },
    append() {
      return makeSelection({
        ownerSVGElement: null,
        getScreenCTM() {
          return null;
        }
      });
    },
    attr(name, value) {
      attrs.set(name, value);
      return this;
    },
    style(name, value) {
      styles.set(name, value);
      return this;
    },
    node() {
      return node;
    }
  };
}

function makeBaseContext(overrides = {}) {
  let mode = '2d';
  let selectMode = false;
  let drawBondMode = false;
  let eraseMode = false;
  let erasePainting = false;
  const selectedAtomIds = new Set();
  const selectedBondIds = new Set();
  const svgNode = {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 300, height: 200 };
    }
  };
  const svg = makeSelection(svgNode);
  const gNode = {};
  const g = makeSelection(gNode);
  const listeners = new Map();
  const cursorEl = { style: {} };

  const context = {
    state: {
      viewState: {
        getMode: () => mode
      },
      documentState: {
        getMol2d: () => null,
        getCurrentMol: () => null
      },
      overlayState: {
        getSelectMode: () => selectMode,
        setSelectMode: value => {
          selectMode = value;
        },
        getDrawBondMode: () => drawBondMode,
        setDrawBondMode: value => {
          drawBondMode = value;
        },
        getEraseMode: () => eraseMode,
        setEraseMode: value => {
          eraseMode = value;
        },
        getErasePainting: () => erasePainting,
        setErasePainting: value => {
          erasePainting = value;
        },
        getSelectedAtomIds: () => selectedAtomIds,
        getSelectedBondIds: () => selectedBondIds
      }
    },
    selection: {
      toggleSelectMode() {}
    },
    renderers: {
      applySelectionOverlay() {}
    },
    overlays: {
      hasReactionPreview: () => false
    },
    drawBond: {
      hasDrawBondState: () => false,
      start() {},
      markDragged() {},
      updatePreview() {},
      commit() {}
    },
    actions: {
      eraseItem() {}
    },
    view: {
      getZoomTransform: () => ({
        applyX: value => value,
        applyY: value => value
      }),
      clearPrimitiveHover() {},
      showPrimitiveHover() {},
      setDrawBondHoverSuppressed() {}
    },
    helpers: {
      toSVGPt2d: atom => atom,
      getDatum: element => element.__datum ?? null
    },
    simulation: {
      nodes: () => [],
      force: () => ({
        links: () => []
      })
    },
    svg,
    g,
    pointer: () => [12, 34],
    schedule: callback => callback(),
    dom: {
      plotEl: {
        querySelectorAll() {
          return [];
        }
      },
      getEraseCursorElement: () => cursorEl
    },
    doc: {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      elementsFromPoint() {
        return [];
      }
    }
  };

  Object.assign(context, overrides);
  return {
    context,
    svg,
    g,
    listeners,
    cursorEl,
    selectedAtomIds,
    selectedBondIds,
    state: {
      setMode: value => (mode = value),
      setSelectMode: value => (selectMode = value),
      setDrawBondMode: value => (drawBondMode = value)
    }
  };
}

describe('initGestureInteractions', () => {
  it('starts a blank-space draw-bond gesture through the extracted SVG handler', () => {
    let started = null;
    const { context, svg, state } = makeBaseContext({
      drawBond: {
        hasDrawBondState: () => false,
        start(atomId, x, y) {
          started = { atomId, x, y };
        },
        markDragged() {},
        updatePreview() {},
        commit() {}
      }
    });
    state.setDrawBondMode(true);

    initGestureInteractions(context);

    let stopped = false;
    svg.handlers.get('mousedown.drawbond')({
      button: 0,
      target: { closest: () => null },
      stopPropagation() {
        stopped = true;
      }
    });

    assert.equal(stopped, true);
    assert.deepEqual(started, { atomId: null, x: 12, y: 34 });
  });

  it('selects the whole molecule on blank-space double-click and enters select mode', () => {
    const calls = [];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}]
      ]),
      bonds: new Map([['b1', {}]])
    };
    const { context, svg, selectedAtomIds, selectedBondIds } = makeBaseContext({
      selection: {
        toggleSelectMode() {
          calls.push('toggleSelectMode');
        }
      },
      renderers: {
        applySelectionOverlay() {
          calls.push('applySelectionOverlay');
        }
      }
    });
    context.state.documentState.getMol2d = () => mol;

    initGestureInteractions(context);

    svg.handlers.get('dblclick.select-all')({
      target: { closest: () => null }
    });

    assert.deepEqual(calls, ['toggleSelectMode', 'applySelectionOverlay']);
    assert.deepEqual([...selectedAtomIds].sort(), ['a1', 'a2']);
    assert.deepEqual([...selectedBondIds], ['b1']);
  });
});
