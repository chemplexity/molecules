import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initPlotInteractions } from '../../../src/app/ui/plot-interactions.js';

function makeTooltip(records) {
  return {
    hide() {
      records.push(['hide']);
    },
    show(html, event) {
      records.push(['show', html, event.clientX, event.clientY]);
    }
  };
}

describe('initPlotInteractions', () => {
  it('prevents text selection in the plot container', () => {
    let selectStartHandler = null;
    let contextMenuHandler = null;
    let mouseDownHandler = null;
    let documentMouseDownHandler = null;
    let documentContextMenuHandler = null;
    let windowMouseDownHandler = null;
    let windowAuxClickHandler = null;
    let windowContextMenuHandler = null;
    const plotEl = {
      addEventListener(type, handler) {
        if (type === 'selectstart') {
          selectStartHandler = handler;
        }
        if (type === 'contextmenu') {
          contextMenuHandler = handler;
        }
        if (type === 'mousedown') {
          mouseDownHandler = handler;
        }
      }
    };
    const docEl = {};
    const bodyEl = {};
    const win = {
      addEventListener(type, handler) {
        if (type === 'mousedown') {
          windowMouseDownHandler = handler;
        }
        if (type === 'auxclick') {
          windowAuxClickHandler = handler;
        }
        if (type === 'contextmenu') {
          windowContextMenuHandler = handler;
        }
      }
    };
    initPlotInteractions({
      plotEl,
      window: win,
      document: {
        documentElement: docEl,
        body: bodyEl,
        addEventListener(type, handler) {
          if (type === 'mousedown') {
            documentMouseDownHandler = handler;
          }
          if (type === 'contextmenu') {
            documentContextMenuHandler = handler;
          }
        },
        elementsFromPoint() {
          return [];
        }
      },
      state: {
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        isRenderableMode: () => false,
        getActiveMolecule: () => null,
        getTooltipMode: () => '2d'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => new Map()
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => null,
        setSelectionValenceTooltipAtomId() {}
      },
      tooltip: makeTooltip([]),
      helpers: {
        getNodeDatum: () => null
      },
      molecule: {
        getAtomById: () => null
      },
      formatters: {
        atomTooltipHtml: () => ''
      }
    });

    let prevented = false;
    selectStartHandler({
      preventDefault() {
        prevented = true;
      }
    });

    assert.equal(prevented, true);
    assert.equal(typeof contextMenuHandler, 'function');
    assert.equal(typeof mouseDownHandler, 'function');
    assert.equal(typeof documentMouseDownHandler, 'function');
    assert.equal(typeof documentContextMenuHandler, 'function');
    assert.equal(typeof windowMouseDownHandler, 'function');
    assert.equal(typeof windowAuxClickHandler, 'function');
    assert.equal(typeof windowContextMenuHandler, 'function');
    assert.equal(typeof plotEl.oncontextmenu, 'function');
    assert.equal(typeof plotEl.onmousedown, 'function');
    assert.equal(typeof docEl.oncontextmenu, 'function');
    assert.equal(typeof docEl.onmousedown, 'function');
    assert.equal(typeof bodyEl.oncontextmenu, 'function');
    assert.equal(typeof bodyEl.onmousedown, 'function');
    assert.equal(typeof win.oncontextmenu, 'function');
    assert.equal(typeof win.onmousedown, 'function');
  });

  it('suppresses the native context menu while a charge tool is active', () => {
    let contextMenuHandler = null;
    const plotEl = {
      addEventListener(type, handler) {
        if (type === 'contextmenu') {
          contextMenuHandler = handler;
        }
      }
    };
    const win = {
      addEventListener() {}
    };
    const docEl = {};
    const bodyEl = {};

    initPlotInteractions({
      plotEl,
      window: win,
      document: {
        documentElement: docEl,
        body: bodyEl,
        addEventListener() {},
        elementsFromPoint() {
          return [];
        }
      },
      state: {
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        getChargeTool: () => 'positive',
        isRenderableMode: () => true,
        getActiveMolecule: () => null,
        getTooltipMode: () => '2d'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => new Map()
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => null,
        setSelectionValenceTooltipAtomId() {}
      },
      tooltip: makeTooltip([]),
      helpers: {
        getNodeDatum: () => null
      },
      molecule: {
        getAtomById: () => null
      },
      formatters: {
        atomTooltipHtml: () => ''
      }
    });

    let prevented = false;
    contextMenuHandler({
      preventDefault() {
        prevented = true;
      }
    });

    assert.equal(prevented, true);

    prevented = false;
    const result = win.oncontextmenu({
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
      stopImmediatePropagation() {}
    });
    assert.equal(prevented, true);
    assert.equal(result, false);
  });

  it('suppresses the native context menu inside the plot even without a charge tool', () => {
    let contextMenuHandler = null;
    let mouseDownHandler = null;
    const plotEl = {
      addEventListener(type, handler) {
        if (type === 'contextmenu') {
          contextMenuHandler = handler;
        }
        if (type === 'mousedown') {
          mouseDownHandler = handler;
        }
      }
    };

    initPlotInteractions({
      plotEl,
      window: {
        addEventListener() {}
      },
      document: {
        addEventListener() {},
        elementsFromPoint() {
          return [];
        }
      },
      state: {
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        getChargeTool: () => null,
        isRenderableMode: () => true,
        getActiveMolecule: () => null,
        getTooltipMode: () => '2d'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => new Map()
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => null,
        setSelectionValenceTooltipAtomId() {}
      },
      tooltip: makeTooltip([]),
      helpers: {
        getNodeDatum: () => null
      },
      molecule: {
        getAtomById: () => null
      },
      formatters: {
        atomTooltipHtml: () => ''
      }
    });

    let prevented = false;
    contextMenuHandler({
      preventDefault() {
        prevented = true;
      }
    });
    assert.equal(prevented, true);

    prevented = false;
    mouseDownHandler({
      button: 2,
      ctrlKey: false,
      preventDefault() {
        prevented = true;
      }
    });
    assert.equal(prevented, true);

    prevented = false;
    const result = plotEl.oncontextmenu({
      preventDefault() {
        prevented = true;
      }
    });
    assert.equal(prevented, true);
    assert.equal(result, false);
  });

  it('suppresses secondary mousedown in charge mode before the browser menu opens', () => {
    let documentMouseDownHandler = null;
    const plotEl = {
      addEventListener() {}
    };

    initPlotInteractions({
      plotEl,
      window: {
        addEventListener() {}
      },
      document: {
        addEventListener(type, handler) {
          if (type === 'mousedown') {
            documentMouseDownHandler = handler;
          }
        },
        elementsFromPoint() {
          return [];
        }
      },
      state: {
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        getChargeTool: () => 'negative',
        isRenderableMode: () => true,
        getActiveMolecule: () => null,
        getTooltipMode: () => '2d'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => new Map()
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => null,
        setSelectionValenceTooltipAtomId() {}
      },
      tooltip: makeTooltip([]),
      helpers: {
        getNodeDatum: () => null
      },
      molecule: {
        getAtomById: () => null
      },
      formatters: {
        atomTooltipHtml: () => ''
      }
    });

    let prevented = false;
    let stopped = false;
    documentMouseDownHandler({
      button: 2,
      ctrlKey: false,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
  });

  it('suppresses document-level context menus anywhere during charge mode', () => {
    let documentContextMenuHandler = null;
    const plotEl = {
      addEventListener() {}
    };

    initPlotInteractions({
      plotEl,
      window: {
        addEventListener() {}
      },
      document: {
        addEventListener(type, handler) {
          if (type === 'contextmenu') {
            documentContextMenuHandler = handler;
          }
        },
        elementsFromPoint() {
          return [];
        }
      },
      state: {
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        getChargeTool: () => 'positive',
        isRenderableMode: () => true,
        getActiveMolecule: () => null,
        getTooltipMode: () => '2d'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => new Map()
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => null,
        setSelectionValenceTooltipAtomId() {}
      },
      tooltip: makeTooltip([]),
      helpers: {
        getNodeDatum: () => null
      },
      molecule: {
        getAtomById: () => null
      },
      formatters: {
        atomTooltipHtml: () => ''
      }
    });

    let prevented = false;
    let stopped = false;
    documentContextMenuHandler({
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
  });

  it('suppresses window-level context menus during charge mode', () => {
    let windowContextMenuHandler = null;
    const plotEl = {
      addEventListener() {}
    };

    initPlotInteractions({
      plotEl,
      window: {
        addEventListener(type, handler) {
          if (type === 'contextmenu') {
            windowContextMenuHandler = handler;
          }
        }
      },
      document: {
        addEventListener() {},
        elementsFromPoint() {
          return [];
        }
      },
      state: {
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        getChargeTool: () => 'positive',
        isRenderableMode: () => true,
        getActiveMolecule: () => null,
        getTooltipMode: () => '2d'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => new Map()
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => null,
        setSelectionValenceTooltipAtomId() {}
      },
      tooltip: makeTooltip([]),
      helpers: {
        getNodeDatum: () => null
      },
      molecule: {
        getAtomById: () => null
      },
      formatters: {
        atomTooltipHtml: () => ''
      }
    });

    let prevented = false;
    let stopped = false;
    windowContextMenuHandler({
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      stopImmediatePropagation() {
        stopped = true;
      }
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
  });

  it('shows a valence tooltip for the hovered force atom and hides it when the hover clears', () => {
    const records = [];
    const warningMap = new Map([['a1', { atomId: 'a1', code: 'warn' }]]);
    const atom = { id: 'a1', name: 'C' };
    let mousemoveHandler = null;
    let selectionTooltipAtomId = null;

    initPlotInteractions({
      plotEl: {
        addEventListener() {}
      },
      document: {
        addEventListener(type, handler) {
          if (type === 'mousemove') {
            mousemoveHandler = handler;
          }
        },
        elementsFromPoint() {
          return [
            {
              classList: {
                contains(value) {
                  return value === 'node';
                }
              }
            }
          ];
        }
      },
      state: {
        getSelectMode: () => true,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        isRenderableMode: () => true,
        getActiveMolecule: () => ({ atoms: new Map([['a1', atom]]) }),
        getTooltipMode: () => 'force'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => warningMap
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => selectionTooltipAtomId,
        setSelectionValenceTooltipAtomId(value) {
          selectionTooltipAtomId = value;
          records.push(['setSelectionTooltipAtomId', value]);
        }
      },
      tooltip: makeTooltip(records),
      helpers: {
        getNodeDatum: () => ({ id: 'a1' })
      },
      molecule: {
        getAtomById: atomId => (atomId === 'a1' ? atom : null)
      },
      formatters: {
        atomTooltipHtml: (hoveredAtom, mol, warning, mode) => `${hoveredAtom.id}:${warning.code}:${mode}:${mol.atoms.size}`
      }
    });

    mousemoveHandler({ clientX: 10, clientY: 20 });
    assert.deepEqual(records.slice(0, 2), [
      ['setSelectionTooltipAtomId', 'a1'],
      ['show', 'a1:warn:force:1', 10, 20]
    ]);

    records.length = 0;
    mousemoveHandler({ clientX: 10, clientY: 20, dummy: true });
  });

  it('hides the tooltip when there is no hovered warning target', () => {
    const records = [];
    let mousemoveHandler = null;
    let selectionTooltipAtomId = 'a1';

    initPlotInteractions({
      plotEl: {
        addEventListener() {}
      },
      document: {
        addEventListener(type, handler) {
          if (type === 'mousemove') {
            mousemoveHandler = handler;
          }
        },
        elementsFromPoint() {
          return [];
        }
      },
      state: {
        getSelectMode: () => true,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        isRenderableMode: () => true,
        getActiveMolecule: () => ({ atoms: new Map() }),
        getTooltipMode: () => '2d'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => new Map()
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => selectionTooltipAtomId,
        setSelectionValenceTooltipAtomId(value) {
          selectionTooltipAtomId = value;
          records.push(['setSelectionTooltipAtomId', value]);
        }
      },
      tooltip: makeTooltip(records),
      helpers: {
        getNodeDatum: () => null
      },
      molecule: {
        getAtomById: () => null
      },
      formatters: {
        atomTooltipHtml: () => ''
      }
    });

    mousemoveHandler({ clientX: 1, clientY: 2 });

    assert.deepEqual(records, [['setSelectionTooltipAtomId', null], ['hide']]);
  });

  it('does not show valence tooltips while charge mode is active', () => {
    const records = [];
    const warningMap = new Map([['a1', { atomId: 'a1', code: 'warn' }]]);
    const atom = { id: 'a1', name: 'C' };
    let mousemoveHandler = null;

    initPlotInteractions({
      plotEl: {
        addEventListener() {}
      },
      document: {
        addEventListener(type, handler) {
          if (type === 'mousemove') {
            mousemoveHandler = handler;
          }
        },
        elementsFromPoint() {
          return [
            {
              classList: {
                contains(value) {
                  return value === 'node';
                }
              }
            }
          ];
        }
      },
      state: {
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        hasDrawBondState: () => false,
        getEraseMode: () => false,
        getChargeTool: () => 'positive',
        isRenderableMode: () => true,
        getActiveMolecule: () => ({ atoms: new Map([['a1', atom]]) }),
        getTooltipMode: () => 'force'
      },
      options: {
        getShowAtomTooltips: () => true
      },
      analysis: {
        getActiveValenceWarningMap: () => warningMap
      },
      tooltipState: {
        getSelectionValenceTooltipAtomId: () => null,
        setSelectionValenceTooltipAtomId(value) {
          records.push(['setSelectionTooltipAtomId', value]);
        }
      },
      tooltip: makeTooltip(records),
      helpers: {
        getNodeDatum: () => ({ id: 'a1' })
      },
      molecule: {
        getAtomById: atomId => (atomId === 'a1' ? atom : null)
      },
      formatters: {
        atomTooltipHtml: () => 'tooltip'
      }
    });

    mousemoveHandler({ clientX: 10, clientY: 20 });

    assert.deepEqual(records, []);
  });
});
