import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimitiveEventHandlers } from '../../../src/app/interactions/primitive-events.js';

function makeContext(overrides = {}) {
  let drawBondMode = false;
  let eraseMode = false;
  let erasePainting = false;
  let selectMode = false;
  let chargeTool = null;
  let mode = 'force';
  let selectionValenceTooltipAtomId = null;
  let primitiveHoverSuppressed = false;
  const hoveredAtomIds = new Set();
  const hoveredBondIds = new Set();
  const calls = [];

  const context = {
    state: {
      viewState: {
        getMode: () => mode
      },
      documentState: {
        getCurrentMol: () => null,
        getMol2d: () => null
      },
      overlayState: {
        getDrawBondMode: () => drawBondMode,
        getEraseMode: () => eraseMode,
        getErasePainting: () => erasePainting,
        getSelectMode: () => selectMode,
        getChargeTool: () => chargeTool,
        getHoveredAtomIds: () => hoveredAtomIds,
        getHoveredBondIds: () => hoveredBondIds
      }
    },
    selection: {
      handle2dPrimitiveClick(...args) {
        calls.push(['handle2dPrimitiveClick', ...args]);
      },
      handle2dComponentDblClick(...args) {
        calls.push(['handle2dComponentDblClick', ...args]);
      },
      handleForcePrimitiveClick(...args) {
        calls.push(['handleForcePrimitiveClick', ...args]);
      },
      handleForceComponentDblClick(...args) {
        calls.push(['handleForceComponentDblClick', ...args]);
      }
    },
    overlays: {
      isReactionPreviewEditableAtomId: () => true
    },
    drawBond: {
      hasDrawBondState: () => false,
      start(...args) {
        calls.push(['start', ...args]);
      },
      resetHover() {
        calls.push(['resetHover']);
      },
      getElement: () => 'N',
      getType: () => 'triple'
    },
    actions: {
      promoteBondOrder(...args) {
        calls.push(['promoteBondOrder', ...args]);
      },
      eraseItem(...args) {
        calls.push(['eraseItem', ...args]);
      },
      changeAtomCharge(...args) {
        calls.push(['changeAtomCharge', ...args]);
      },
      replaceForceHydrogenAtom(...args) {
        calls.push(['replaceForceHydrogenAtom', ...args]);
      }
    },
    view: {
      showPrimitiveHover(...args) {
        calls.push(['showPrimitiveHover', ...args]);
      },
      isPrimitiveHoverSuppressed: () => primitiveHoverSuppressed,
      setPrimitiveHoverSuppressed(value) {
        primitiveHoverSuppressed = value;
        calls.push(['setPrimitiveHoverSuppressed', value]);
      },
      clearPrimitiveHover() {
        calls.push(['clearPrimitiveHover']);
      },
      refreshSelectionOverlay() {
        calls.push(['refreshSelectionOverlay']);
      },
      isDrawBondHoverSuppressed: () => false
    },
    tooltip: {
      showDelayed(...args) {
        calls.push(['showDelayed', ...args]);
      },
      showImmediate(...args) {
        calls.push(['showImmediate', ...args]);
      },
      move(...args) {
        calls.push(['move', ...args]);
      },
      hide() {
        calls.push(['hide']);
      }
    },
    tooltipState: {
      getSelectionValenceTooltipAtomId: () => selectionValenceTooltipAtomId,
      setSelectionValenceTooltipAtomId: value => {
        selectionValenceTooltipAtomId = value;
        calls.push(['setSelectionValenceTooltipAtomId', value]);
      }
    },
    options: {
      getRenderOptions: () => ({ showAtomTooltips: true })
    },
    formatters: {
      atomTooltipHtml: () => 'atom-tooltip',
      bondTooltipHtml: () => 'bond-tooltip'
    },
    pointer: () => [10, 20],
    dom: {
      gNode: () => ({})
    }
  };

  Object.assign(context, overrides);
  return {
    context,
    calls,
    setDrawBondMode: value => {
      drawBondMode = value;
    },
    setEraseMode: value => {
      eraseMode = value;
    },
    setErasePainting: value => {
      erasePainting = value;
    },
    setSelectMode: value => {
      selectMode = value;
    },
    setChargeTool: value => {
      chargeTool = value;
    },
    setMode: value => {
      mode = value;
    },
    setPrimitiveHoverSuppressed: value => {
      primitiveHoverSuppressed = value;
    }
  };
}

describe('createPrimitiveEventHandlers', () => {
  it('routes force bond click to bond promotion in draw-bond mode', () => {
    const { context, calls, setDrawBondMode } = makeContext();
    setDrawBondMode(true);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceBondClick({}, 'b1', {
      bonds: new Map()
    });

    assert.deepEqual(calls, [['promoteBondOrder', 'b1', { drawBondType: 'triple' }]]);
  });

  it('routes force hydrogen click in draw-bond mode to element replacement', () => {
    const { context, calls, setDrawBondMode } = makeContext();
    setDrawBondMode(true);
    const handlers = createPrimitiveEventHandlers(context);

    let stopped = false;
    const molecule = { id: 'mol' };
    handlers.handleForceAtomClick(
      {
        stopPropagation() {
          stopped = true;
        }
      },
      { id: 'a1', name: 'H' },
      molecule
    );

    assert.equal(stopped, true);
    assert.deepEqual(calls, [['replaceForceHydrogenAtom', 'a1', molecule]]);
  });

  it('shows immediate valence-warning tooltip for 2D atoms in select mode', () => {
    const { context, calls, setSelectMode, setMode } = makeContext();
    setMode('2d');
    setSelectMode(true);
    const handlers = createPrimitiveEventHandlers(context);
    const atom = { id: 'a1' };
    const mol = { id: 'mol' };

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, atom, mol, { message: 'warn' });

    assert.deepEqual(calls, [
      ['showPrimitiveHover', ['a1'], []],
      ['setSelectionValenceTooltipAtomId', 'a1'],
      ['showImmediate', 'atom-tooltip', { clientX: 5, clientY: 6 }]
    ]);
  });

  it('routes force atom clicks to charge edits when a charge tool is active', () => {
    const { context, calls, setChargeTool } = makeContext();
    setChargeTool('positive');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomClick({}, { id: 'a1', name: 'C', charge: 1 }, { id: 'mol' });

    assert.deepEqual(calls, [['changeAtomCharge', 'a1', { chargeTool: 'positive', decrement: false }]]);
  });

  it('routes 2D atom right-clicks to charge decrements when a charge tool is active', () => {
    const { context, calls, setChargeTool, setMode } = makeContext();
    setMode('2d');
    setChargeTool('negative');
    const handlers = createPrimitiveEventHandlers(context);
    let prevented = false;
    let stopped = false;

    handlers.handle2dAtomContextMenu(
      {
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        }
      },
      { id: 'a1', getCharge: () => -2 }
    );

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, [['changeAtomCharge', 'a1', { chargeTool: 'negative', decrement: true }]]);
  });

  it('suppresses 2D bond tooltips while charge mode is active', () => {
    const { context, calls, setChargeTool, setMode } = makeContext();
    setMode('2d');
    setChargeTool('positive');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dBondMouseOver({ clientX: 5, clientY: 6 }, { id: 'b1' }, { id: 'a1' }, { id: 'a2' });

    assert.deepEqual(calls, []);
  });

  it('suppresses force bond tooltips while charge mode is active', () => {
    const { context, calls, setChargeTool } = makeContext();
    setChargeTool('negative');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceBondMouseOver(
      { clientX: 5, clientY: 6 },
      'b1',
      {
        bonds: new Map([['b1', { id: 'b1', atoms: ['a1', 'a2'] }]]),
        atoms: new Map([
          ['a1', { id: 'a1', name: 'C' }],
          ['a2', { id: 'a2', name: 'O' }]
        ])
      }
    );

    assert.deepEqual(calls, []);
  });

  it('does not charge force-mode hydrogens when a charge tool is active', () => {
    const { context, calls, setChargeTool } = makeContext();
    setChargeTool('positive');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomClick({}, { id: 'h1', name: 'H', charge: 0 }, { id: 'mol' });

    assert.deepEqual(calls, []);
  });

  it('does not highlight force-mode hydrogens in charge mode', () => {
    const { context, calls, setChargeTool } = makeContext();
    setChargeTool('negative');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handleForceAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'h1', name: 'H' }, { atoms: new Map([['h1', { id: 'h1', name: 'H' }]]) }, null);

    assert.deepEqual(calls, []);
  });

  it('suppresses atom tooltips while charge mode is active', () => {
    const { context, calls, setChargeTool, setMode } = makeContext();
    setMode('2d');
    setChargeTool('positive');
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'a1' }, { id: 'mol' }, { message: 'warn' });

    assert.deepEqual(calls, [['showPrimitiveHover', ['a1'], []]]);
  });

  it('restores charge-mode hover immediately after primitive hover suppression', () => {
    const { context, calls, setChargeTool, setMode, setPrimitiveHoverSuppressed } = makeContext();
    setMode('2d');
    setChargeTool('positive');
    setPrimitiveHoverSuppressed(true);
    const handlers = createPrimitiveEventHandlers(context);

    handlers.handle2dAtomMouseOver({ clientX: 5, clientY: 6 }, { id: 'a1' }, { id: 'mol' }, null);

    assert.deepEqual(calls, [
      ['setPrimitiveHoverSuppressed', false],
      ['showPrimitiveHover', ['a1'], []]
    ]);
  });
});
