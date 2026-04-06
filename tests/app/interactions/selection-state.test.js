import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSelectionStateHelpers } from '../../../src/app/interactions/selection-state.js';

function makeHelpers(options = {}) {
  let selectedAtomIds = options.selectedAtomIds ?? new Set();
  let selectedBondIds = options.selectedBondIds ?? new Set();

  const helpers = createSelectionStateHelpers({
    state: {
      getSelectedAtomIds: () => selectedAtomIds,
      setSelectedAtomIds: value => {
        selectedAtomIds = value;
      },
      getSelectedBondIds: () => selectedBondIds,
      setSelectedBondIds: value => {
        selectedBondIds = value;
      }
    }
  });

  return {
    helpers,
    getSelectedAtomIds: () => selectedAtomIds,
    getSelectedBondIds: () => selectedBondIds
  };
}

describe('createSelectionStateHelpers', () => {
  it('syncs selected atom and bond ids to the current molecule', () => {
    const { helpers, getSelectedAtomIds, getSelectedBondIds } = makeHelpers({
      selectedAtomIds: new Set(['a1', 'ghost-atom']),
      selectedBondIds: new Set(['b1', 'ghost-bond'])
    });
    const mol = {
      atoms: new Map([['a1', { id: 'a1' }]]),
      bonds: new Map([['b1', { id: 'b1' }]])
    };

    helpers.syncSelectionToMolecule(mol);

    assert.deepEqual([...getSelectedAtomIds()], ['a1']);
    assert.deepEqual([...getSelectedBondIds()], ['b1']);
  });

  it('returns null when a drag does not start on the current selection', () => {
    const { helpers } = makeHelpers({
      selectedAtomIds: new Set(['a1']),
      selectedBondIds: new Set(['b1'])
    });
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1' }],
        ['a2', { id: 'a2' }]
      ]),
      bonds: new Map([['b1', { id: 'b1', atoms: ['a1', 'a2'] }]])
    };

    assert.equal(helpers.getSelectedDragAtomIds(mol, ['a2'], []), null);
    assert.equal(helpers.getSelectedDragAtomIds(mol, [], ['missing']), null);
  });

  it('expands a selected drag to selected atoms and selected bond endpoints', () => {
    const { helpers } = makeHelpers({
      selectedAtomIds: new Set(['a1']),
      selectedBondIds: new Set(['b1', 'missing'])
    });
    const mol = {
      atoms: new Map([
        ['a1', { id: 'a1' }],
        ['a2', { id: 'a2' }],
        ['a3', { id: 'a3' }]
      ]),
      bonds: new Map([['b1', { id: 'b1', atoms: ['a2', 'a3'] }]])
    };

    const atomIds = helpers.getSelectedDragAtomIds(mol, ['a1'], []);

    assert.deepEqual([...atomIds].sort(), ['a1', 'a2', 'a3']);
  });
});
