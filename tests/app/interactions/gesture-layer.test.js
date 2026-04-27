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
  let chargeTool = null;
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
        getChargeTool: () => chargeTool,
        setChargeTool: value => {
          chargeTool = value;
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
      toSelectionSVGPt2d: atom => atom,
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
      setDrawBondMode: value => (drawBondMode = value),
      setChargeTool: value => (chargeTool = value)
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

  it('does not trigger blank-space select-all while charge mode is active', () => {
    const calls = [];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}]
      ]),
      bonds: new Map([['b1', {}]])
    };
    const { context, svg, selectedAtomIds, selectedBondIds, state } = makeBaseContext({
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
    state.setChargeTool('positive');

    initGestureInteractions(context);

    svg.handlers.get('dblclick.select-all')({
      target: { closest: () => null }
    });

    assert.deepEqual(calls, []);
    assert.deepEqual([...selectedAtomIds], []);
    assert.deepEqual([...selectedBondIds], []);
  });

  it('selects a projected stereo hydrogen when its rendered point falls inside the drag box', () => {
    const hydrogen = { id: 'h1', x: 10, y: 10, visible: true, name: 'H' };
    const carbon = { id: 'c1', x: 10, y: 10, visible: true, name: 'C' };
    const mol = {
      atoms: new Map([
        ['h1', hydrogen],
        ['c1', carbon]
      ]),
      bonds: new Map()
    };
    const overlayCalls = [];
    const { context, svg, listeners, selectedAtomIds, state } = makeBaseContext({
      renderers: {
        applySelectionOverlay() {
          overlayCalls.push('applySelectionOverlay');
        }
      },
      helpers: {
        toSVGPt2d: atom => ({ x: atom.x, y: atom.y }),
        toSelectionSVGPt2d: atom => (atom.id === 'h1' ? { x: 90, y: 90 } : { x: atom.x, y: atom.y }),
        getDatum: element => element.__datum ?? null
      }
    });
    context.state.documentState.getMol2d = () => mol;
    state.setSelectMode(true);

    initGestureInteractions(context);

    svg.handlers.get('mousedown.selection')({
      button: 0,
      clientX: 80,
      clientY: 80,
      target: { closest: () => null },
      preventDefault() {}
    });
    listeners.get('mouseup')({
      button: 0,
      clientX: 100,
      clientY: 100
    });

    assert.deepEqual([...selectedAtomIds], ['h1']);
    assert.deepEqual(overlayCalls, ['applySelectionOverlay']);
  });

  it('previews 2D drag-box atom and bond selection before mouseup', () => {
    const a1 = { id: 'a1', x: 50, y: 50, visible: true, name: 'C' };
    const a2 = { id: 'a2', x: 90, y: 90, visible: true, name: 'C' };
    const a3 = { id: 'a3', x: 180, y: 90, visible: true, name: 'C' };
    const b1 = { id: 'b1', atoms: ['a1', 'a2'], getAtomObjects: () => [a1, a2] };
    const b2 = { id: 'b2', atoms: ['a2', 'a3'], getAtomObjects: () => [a2, a3] };
    const mol = {
      atoms: new Map([
        ['a1', a1],
        ['a2', a2],
        ['a3', a3]
      ]),
      bonds: new Map([
        ['b1', b1],
        ['b2', b2]
      ])
    };
    const overlayCalls = [];
    const { context, svg, selectedAtomIds, selectedBondIds, state } = makeBaseContext({
      renderers: {
        applySelectionOverlay() {
          overlayCalls.push('applySelectionOverlay');
        }
      }
    });
    context.state.documentState.getMol2d = () => mol;
    state.setSelectMode(true);

    initGestureInteractions(context);

    svg.handlers.get('mousedown.selection')({
      button: 0,
      clientX: 40,
      clientY: 40,
      target: { closest: () => null },
      preventDefault() {}
    });
    svg.handlers.get('mousemove.selection')({
      clientX: 110,
      clientY: 110
    });

    assert.deepEqual([...selectedAtomIds].sort(), ['a1', 'a2']);
    assert.deepEqual([...selectedBondIds], ['b1']);
    assert.deepEqual(overlayCalls, ['applySelectionOverlay']);

    svg.handlers.get('mousemove.selection')({
      clientX: 42,
      clientY: 42
    });

    assert.deepEqual([...selectedAtomIds], []);
    assert.deepEqual([...selectedBondIds], []);
    assert.equal(overlayCalls.length, 2);
  });

  it('previews additive drag-box selection from the pre-drag baseline', () => {
    const a1 = { id: 'a1', x: 50, y: 50, visible: true, name: 'C' };
    const a2 = { id: 'a2', x: 90, y: 90, visible: true, name: 'C' };
    const b1 = { id: 'b1', atoms: ['a1', 'a2'], getAtomObjects: () => [a1, a2] };
    const mol = {
      atoms: new Map([
        ['a1', a1],
        ['a2', a2]
      ]),
      bonds: new Map([['b1', b1]])
    };
    const { context, svg, selectedAtomIds, selectedBondIds, state } = makeBaseContext();
    context.state.documentState.getMol2d = () => mol;
    selectedAtomIds.add('a1');
    selectedBondIds.add('b1');
    state.setSelectMode(true);

    initGestureInteractions(context);

    svg.handlers.get('mousedown.selection')({
      button: 0,
      clientX: 40,
      clientY: 40,
      metaKey: true,
      target: { closest: () => null },
      preventDefault() {}
    });
    svg.handlers.get('mousemove.selection')({
      clientX: 110,
      clientY: 110
    });

    assert.deepEqual([...selectedAtomIds], ['a2']);
    assert.deepEqual([...selectedBondIds], []);
  });
});
