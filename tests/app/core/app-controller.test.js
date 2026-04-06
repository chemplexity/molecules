import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppController } from '../../../src/app/core/app-controller.js';

describe('createAppController', () => {
  it('exposes snapshot helpers by delegation', () => {
    const snapshot = { state: 'snapshot' };
    const calls = [];
    const controller = createAppController({
      state: {
        documentState: {
          getActiveMolecule: () => null,
          setActiveMolecule() {}
        },
        viewState: {
          getMode: () => '2d'
        }
      },
      renderers: {
        draw2d() {},
        updateForce() {}
      },
      history: {
        takeSnapshot() {}
      },
      panels: {},
      analysis: {
        syncInputField() {},
        updateFormula() {},
        updateDescriptors() {},
        updatePanels() {}
      },
      dom: {},
      overlays: {
        hasReactionPreview: () => false,
        prepareReactionPreviewBondEditTarget() {},
        prepareReactionPreviewEditTargets() {},
        prepareResonanceStructuralEdit: mol => ({ mol, resonanceReset: false })
      },
      snapshot: {
        capture() {
          calls.push('capture');
          return snapshot;
        },
        restore(nextSnapshot) {
          calls.push(['restore', nextSnapshot]);
        }
      },
      navigation: {
        toggleMode() {
          calls.push('toggle-mode');
        },
        cleanLayout2d() {
          calls.push('clean-layout-2d');
        },
        cleanLayoutForce() {
          calls.push('clean-layout-force');
        },
        startRotate(delta) {
          calls.push(['start-rotate', delta]);
        },
        stopRotate() {
          calls.push('stop-rotate');
        },
        flip(axis) {
          calls.push(['flip', axis]);
        }
      }
    });

    assert.deepEqual(controller.captureAppSnapshot(), snapshot);
    controller.restoreAppSnapshot(snapshot);
    controller.performViewAction('toggle-mode');
    controller.performViewAction('start-rotate', { delta: 5 });
    controller.performViewAction('flip', { axis: 'h' });

    assert.deepEqual(calls, ['capture', ['restore', snapshot], 'toggle-mode', ['start-rotate', 5], ['flip', 'h']]);
  });
});
