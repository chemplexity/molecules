import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDragGestureActions } from '../../../src/app/interactions/drag-gestures.js';

function createDragStub() {
  const handlers = new Map();
  const api = {
    filter(fn) {
      api.filterFn = fn;
      return api;
    },
    on(name, fn) {
      handlers.set(name, fn);
      return api;
    },
    handlers
  };
  return api;
}

function makeContext(overrides = {}) {
  let drawBondMode = false;
  let eraseMode = false;
  const calls = [];
  const dragStubs = [];

  const context = {
    d3: {
      createDrag: () => {
        const stub = createDragStub();
        dragStubs.push(stub);
        return stub;
      }
    },
    state: {
      getDrawBondMode: () => drawBondMode,
      getEraseMode: () => eraseMode
    },
    history: {
      captureSnapshot: () => ({ id: 'snapshot-1' }),
      takeSnapshot: options => {
        calls.push(['takeSnapshot', options]);
      }
    },
    selection: {
      getSelectedDragAtomIds: (...args) => {
        calls.push(['getSelectedDragAtomIds', ...args]);
        return overrides.selectedDragAtomIds ?? null;
      }
    },
    molecule: {
      getCurrent: () => overrides.currentMol ?? null
    },
    force: {
      setAutoFitEnabled: value => {
        calls.push(['setAutoFitEnabled', value]);
      },
      disableKeepInView: () => {
        calls.push(['disableKeepInView']);
      }
    },
    view: {
      clearPrimitiveHover: () => {
        calls.push(['clearPrimitiveHover']);
      },
      refresh2dSelection: () => {
        calls.push(['refresh2dSelection']);
      },
      hideTooltip: () => {
        calls.push(['hideTooltip']);
      },
      setElementCursor: (element, value) => {
        calls.push(['setElementCursor', element.id ?? null, value]);
      }
    }
  };

  return {
    actions: createDragGestureActions(context),
    calls,
    dragStubs,
    setDrawBondMode: value => {
      drawBondMode = value;
    },
    setEraseMode: value => {
      eraseMode = value;
    }
  };
}

describe('createDragGestureActions', () => {
  it('takes a force-atom drag snapshot only on first movement', () => {
    const simCalls = [];
    const node = { id: 'a1', x: 4, y: 6 };
    const simulation = {
      nodes: () => [node],
      alphaTarget(value) {
        simCalls.push(['alphaTarget', value]);
        return simulation;
      },
      restart() {
        simCalls.push(['restart']);
        return simulation;
      }
    };
    const { actions, calls } = makeContext();
    const behavior = actions.createForceAtomDrag(simulation);
    const start = behavior.handlers.get('start');
    const drag = behavior.handlers.get('drag');
    const end = behavior.handlers.get('end');

    start({ active: false, x: 10, y: 20 }, node);
    drag({ x: 13, y: 26 }, node);
    drag({ x: 15, y: 30 }, node);
    end({ active: false }, node);

    assert.deepEqual(
      calls.filter(([name]) => name === 'takeSnapshot'),
      [
        [
          'takeSnapshot',
          {
            clearReactionPreview: false,
            snapshot: { id: 'snapshot-1' }
          }
        ]
      ]
    );
    assert.deepEqual(simCalls, [['alphaTarget', 0.3], ['restart'], ['alphaTarget', 0]]);
    assert.equal(node.anchorX, 9);
    assert.equal(node.anchorY, 16);
    assert.equal(node.fx, null);
    assert.equal(node.fy, null);
  });

  it('uses the selected drag atoms for force-bond drag and resets cursor on end', () => {
    const nodeA = { id: 'a1', x: 1, y: 2 };
    const nodeB = { id: 'a2', x: 3, y: 4 };
    const simCalls = [];
    const simulation = {
      nodes: () => [nodeA, nodeB],
      alphaTarget(value) {
        simCalls.push(['alphaTarget', value]);
        return simulation;
      },
      restart() {
        simCalls.push(['restart']);
        return simulation;
      }
    };
    const { actions, calls: contextCalls } = makeContext({
      selectedDragAtomIds: new Set(['a1', 'a2']),
      currentMol: { id: 'mol-1' }
    });
    const behavior = actions.createForceBondDrag(simulation, { id: 'mol-2' });
    const start = behavior.handlers.get('start');
    const end = behavior.handlers.get('end');
    const element = { id: 'bond-hit-1' };
    let stopped = false;

    start.call(
      element,
      {
        active: false,
        x: 2,
        y: 3,
        sourceEvent: {
          stopPropagation() {
            stopped = true;
          }
        }
      },
      { id: 'b1' }
    );
    end.call(element, { active: false });

    assert.equal(stopped, true);
    assert.deepEqual(contextCalls.slice(0, 5), [
      ['getSelectedDragAtomIds', { id: 'mol-2' }, [], ['b1']],
      ['setAutoFitEnabled', false],
      ['disableKeepInView'],
      ['hideTooltip'],
      ['setElementCursor', 'bond-hit-1', 'grabbing']
    ]);
    assert.deepEqual(contextCalls.at(-1), ['setElementCursor', 'bond-hit-1', 'grab']);
    assert.deepEqual(simCalls, [['alphaTarget', 0.3], ['restart'], ['alphaTarget', 0]]);
  });

  it('takes a 2D drag snapshot once and redraws drag targets before final draw', () => {
    const atom = { id: 'a1', x: 0, y: 0 };
    const molecule = {
      atoms: new Map([[atom.id, atom]])
    };
    const { actions, calls } = makeContext();
    const behavior = actions.create2dAtomDrag(molecule, 'a1', {
      captureDragState: () => ({
        pX: 10,
        pY: 20,
        atomPositions: new Map([['a1', { x: 1, y: 2 }]]),
        movedAtomIds: new Set(['a1'])
      }),
      redrawDragTargets: (_mol, movedAtomIds) => {
        calls.push(['redrawDragTargets', [...movedAtomIds]]);
      },
      pointer: () => [30, 50],
      scale: 10,
      draw: () => {
        calls.push(['draw']);
      },
      setDraggingCursor: () => {
        calls.push(['setDraggingCursor']);
      },
      resetCursor: () => {
        calls.push(['resetCursor']);
      }
    });
    const start = behavior.handlers.get('start');
    const drag = behavior.handlers.get('drag');
    const end = behavior.handlers.get('end');
    const element = {};
    let stopped = false;

    start.call(element, {
      sourceEvent: {
        stopPropagation() {
          stopped = true;
        }
      }
    });
    drag.call(element, { sourceEvent: {} });
    drag.call(element, { sourceEvent: {} });
    end.call(element, {});

    assert.equal(stopped, true);
    assert.equal(atom.x, 3);
    assert.equal(atom.y, -1);
    assert.deepEqual(
      calls.filter(([name]) => name === 'takeSnapshot'),
      [
        [
          'takeSnapshot',
          {
            clearReactionPreview: false,
            snapshot: { id: 'snapshot-1' }
          }
        ]
      ]
    );
    assert.deepEqual(
      calls.filter(([name]) => name === 'redrawDragTargets'),
      [
        ['redrawDragTargets', ['a1']],
        ['redrawDragTargets', ['a1']]
      ]
    );
    assert.deepEqual(calls.at(-1), ['draw']);
  });
});
