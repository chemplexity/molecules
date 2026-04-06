import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSceneBridges } from '../../../src/app/bootstrap/scene-bridges.js';

describe('scene bridge bootstrap', () => {
  it('delegates force, hover, and 2d helper wrappers', () => {
    const calls = [];
    const bridges = createSceneBridges({
      forceHighlightRenderer: {
        applyForceHighlights() {
          calls.push('highlights');
          return 'force-highlights';
        }
      },
      forceSelectionRenderer: {
        applyForceSelection() {
          calls.push('selection');
          return 'force-selection';
        }
      },
      selectionOverlayManager: {
        clearPrimitiveHover() {
          calls.push('clear-hover');
          return 'cleared';
        },
        refreshSelectionOverlay() {
          calls.push('refresh');
          return 'refreshed';
        },
        getRenderableSelectionIds() {
          calls.push('renderable');
          return { atomIds: new Set([1]), bondIds: new Set([2]) };
        },
        showPrimitiveHover(atomIds, bondIds) {
          calls.push(['show', atomIds, bondIds]);
          return 'shown';
        },
        setPrimitiveHover(atomIds, bondIds) {
          calls.push(['set', atomIds, bondIds]);
          return 'set';
        }
      },
      selectionStateHelpers: {
        getSelectedDragAtomIds(mol, atomIds, bondIds) {
          calls.push(['drag', mol, atomIds, bondIds]);
          return new Set([3]);
        }
      },
      render2DHelpers: {
        toSVGPt2d(atom) {
          calls.push(['svg', atom]);
          return { x: atom.x, y: atom.y };
        },
        zoomToFitIf2d() {
          calls.push('zoom');
          return 'zoomed';
        }
      }
    });

    assert.equal(bridges.applyForceHighlights(), 'force-highlights');
    assert.equal(bridges.applyForceSelection(), 'force-selection');
    assert.equal(bridges.clearPrimitiveHover(), 'cleared');
    assert.equal(bridges.refreshSelectionOverlay(), 'refreshed');
    assert.deepEqual(bridges.getRenderableSelectionIds(), { atomIds: new Set([1]), bondIds: new Set([2]) });
    assert.equal(bridges.showPrimitiveHover([1], [2]), 'shown');
    assert.equal(bridges.setPrimitiveHover([3], [4]), 'set');
    assert.deepEqual(bridges.getSelectedDragAtomIds('mol', [5], [6]), new Set([3]));
    assert.deepEqual(bridges.toSVGPt2d({ x: 7, y: 8 }), { x: 7, y: 8 });
    assert.equal(bridges.zoomToFitIf2d(), 'zoomed');

    assert.deepEqual(calls, [
      'highlights',
      'selection',
      'clear-hover',
      'refresh',
      'renderable',
      ['show', [1], [2]],
      ['set', [3], [4]],
      ['drag', 'mol', [5], [6]],
      ['svg', { x: 7, y: 8 }],
      'zoom'
    ]);
  });
});
