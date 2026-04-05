import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimitiveSelectionActions } from '../../src/app/interactions/primitives.js';

describe('createPrimitiveSelectionActions', () => {
  it('toggles 2D primitive atom selection additively and redraws', () => {
    const selectedAtomIds = new Set(['a1']);
    const selectedBondIds = new Set();
    const calls = [];
    const mol2d = {
      atoms: new Map([
        ['a1', { id: 'a1', x: 0, y: 0, visible: true }],
        ['a2', { id: 'a2', x: 1, y: 0, visible: true }]
      ]),
      bonds: new Map()
    };

    const actions = createPrimitiveSelectionActions({
      state: {
        viewState: {
          getMode: () => '2d'
        },
        documentState: {
          getMol2d: () => mol2d,
          getCurrentMol: () => null
        },
        overlayState: {
          getSelectMode: () => true,
          getSelectedAtomIds: () => selectedAtomIds,
          getSelectedBondIds: () => selectedBondIds
        }
      },
      renderers: {
        draw2d() {
          calls.push('draw2d');
        },
        applyForceSelection() {
          calls.push('applyForceSelection');
        }
      },
      view: {
        clearPrimitiveHover() {
          calls.push('clearPrimitiveHover');
        }
      },
      helpers: {
        isAdditiveSelectionEvent: () => true,
        hasVisibleStereoBond: () => false
      }
    });

    actions.select2dPrimitive(['a1', 'a2'], [], true);

    assert.deepEqual([...selectedAtomIds].sort(), ['a2']);
    assert.deepEqual(calls, ['clearPrimitiveHover', 'draw2d']);
  });

  it('selects a full force component on double-click and prevents the event', () => {
    const selectedAtomIds = new Set();
    const selectedBondIds = new Set();
    const calls = [];
    const mol = {
      atoms: new Map([
        [
          'a1',
          {
            id: 'a1',
            bonds: ['b1']
          }
        ],
        [
          'a2',
          {
            id: 'a2',
            bonds: ['b1', 'b2']
          }
        ],
        [
          'a3',
          {
            id: 'a3',
            bonds: ['b2']
          }
        ]
      ]),
      bonds: new Map([
        [
          'b1',
          {
            id: 'b1',
            atoms: ['a1', 'a2'],
            getOtherAtom(atomId) {
              return atomId === 'a1' ? 'a2' : 'a1';
            }
          }
        ],
        [
          'b2',
          {
            id: 'b2',
            atoms: ['a2', 'a3'],
            getOtherAtom(atomId) {
              return atomId === 'a2' ? 'a3' : 'a2';
            }
          }
        ]
      ])
    };
    const actions = createPrimitiveSelectionActions({
      state: {
        viewState: {
          getMode: () => 'force'
        },
        documentState: {
          getMol2d: () => null,
          getCurrentMol: () => mol
        },
        overlayState: {
          getSelectMode: () => true,
          getSelectedAtomIds: () => selectedAtomIds,
          getSelectedBondIds: () => selectedBondIds
        }
      },
      renderers: {
        draw2d() {},
        applyForceSelection() {
          calls.push('applyForceSelection');
        }
      },
      view: {
        clearPrimitiveHover() {
          calls.push('clearPrimitiveHover');
        }
      },
      helpers: {
        isAdditiveSelectionEvent: () => false,
        hasVisibleStereoBond: () => false
      }
    });

    let prevented = false;
    let stopped = false;
    actions.handleForceComponentDblClick(
      {
        defaultPrevented: false,
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        }
      },
      ['a2']
    );

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual([...selectedAtomIds].sort(), ['a1', 'a2', 'a3']);
    assert.deepEqual([...selectedBondIds].sort(), ['b1', 'b2']);
    assert.deepEqual(calls, ['clearPrimitiveHover', 'applyForceSelection']);
  });
});
