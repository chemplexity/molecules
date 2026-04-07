import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimitiveEventHandlers } from '../../../src/app/interactions/primitive-events.js';

function makeContext(overrides = {}) {
  let drawBondMode = false;
  let eraseMode = false;
  let erasePainting = false;
  let selectMode = false;
  let mode = 'force';
  let selectionValenceTooltipAtomId = null;
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
      replaceForceHydrogenAtom(...args) {
        calls.push(['replaceForceHydrogenAtom', ...args]);
      }
    },
    view: {
      showPrimitiveHover(...args) {
        calls.push(['showPrimitiveHover', ...args]);
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
    setMode: value => {
      mode = value;
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
});
