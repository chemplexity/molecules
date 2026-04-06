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
    initPlotInteractions({
      plotEl: {
        addEventListener(type, handler) {
          if (type === 'selectstart') {
            selectStartHandler = handler;
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

    assert.deepEqual(records, [
      ['setSelectionTooltipAtomId', null],
      ['hide']
    ]);
  });
});
