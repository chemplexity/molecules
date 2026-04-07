import test from 'node:test';
import assert from 'node:assert/strict';

import { createNavigationActions } from '../../../src/app/interactions/navigation.js';

test('cleanLayout2d rerenders from a cloned molecule with preserved history', () => {
  const sourceMol = {
    cloneCalls: 0,
    clone() {
      this.cloneCalls += 1;
      return { cloned: true };
    }
  };

  const calls = [];
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => '2d'
      },
      documentState: {
        getMol2d: () => sourceMol
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    renderers: {
      renderMol: (mol, options) => calls.push(['renderMol', mol, options])
    },
    helpers: {
      generateAndRefine2dCoords: (mol, options) => calls.push(['generateAndRefine2dCoords', mol, options])
    },
    view: {
      setPreserveSelectionOnNextRender: value => calls.push(['preserveSelection', value])
    },
    dom: {
      clean2dButton: null
    }
  });

  actions.cleanLayout2d();

  assert.equal(sourceMol.cloneCalls, 1);
  assert.deepEqual(calls, [
    ['takeSnapshot', { clearReactionPreview: false }],
    ['generateAndRefine2dCoords', { cloned: true }, {
      suppressH: true,
      bondLength: 1.5,
      maxPasses: 12,
      freezeRings: true,
      freezeChiralCenters: false,
      allowBranchReflect: true
    }],
    ['preserveSelection', true],
    ['renderMol', { cloned: true }, { preserveHistory: true, preserveAnalysis: true, preserveGeometry: true }]
  ]);
});

test('cleanLayout2d is a no-op outside 2d mode', () => {
  let called = false;
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => 'force'
      },
      documentState: {
        getMol2d: () => ({})
      }
    },
    history: {
      takeSnapshot: () => {
        called = true;
      }
    },
    renderers: {
      renderMol: () => {
        called = true;
      }
    },
    view: {
      setPreserveSelectionOnNextRender: () => {
        called = true;
      }
    },
    dom: {
      clean2dButton: null
    }
  });

  actions.cleanLayout2d();

  assert.equal(called, false);
});
