import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionRuntimeBridge } from '../../../src/app/core/session-runtime-bridge.js';

function makeBridge(options = {}) {
  let currentSmiles = options.currentSmiles ?? null;
  let currentInchi = options.currentInchi ?? null;
  let inputValue = options.inputValue ?? '';
  let mode = options.mode ?? '2d';
  let cx2d = options.cx2d ?? 0;
  let cy2d = options.cy2d ?? 0;
  let hCounts2d = options.hCounts2d ?? new Map();
  let stereoMap2d = options.stereoMap2d ?? new Map();
  let currentMol = options.currentMol ?? null;
  let mol2d = options.mol2d ?? null;
  const calls = [];
  const forceNodes = options.forceNodes ?? [];

  const bridge = createSessionRuntimeBridge({
    io: {
      toSMILES: options.toSMILES ?? (mol => `smiles:${mol.id}`),
      toInChI: options.toInChI ?? (mol => `inchi:${mol.id}`)
    },
    state: {
      getInputMode: () => options.inputMode ?? 'smiles',
      setCurrentSmiles: value => {
        currentSmiles = value;
      },
      setCurrentInchi: value => {
        currentInchi = value;
      }
    },
    dom: {
      setInputValue: value => {
        inputValue = value;
      }
    },
    view: {
      getMode: () => mode,
      captureZoomTransform: () => options.zoomTransform ?? { x: 1, y: 2, k: 3 },
      restoreZoomTransform: snapshot => {
        calls.push(['restoreZoomTransform', snapshot]);
      },
      getRotationDeg: () => options.rotationDeg ?? 0,
      getFlipH: () => options.flipH ?? false,
      getFlipV: () => options.flipV ?? false,
      getCx2d: () => cx2d,
      getCy2d: () => cy2d,
      getHCounts2d: () => hCounts2d,
      getStereoMap2d: () => stereoMap2d,
      setCx2d: value => {
        cx2d = value;
      },
      setCy2d: value => {
        cy2d = value;
      },
      setHCounts2d: value => {
        hCounts2d = value;
      },
      setStereoMap2d: value => {
        stereoMap2d = value;
      }
    },
    force: {
      getNodePositions: () => forceNodes,
      clearGraph: () => {
        calls.push(['clearGraph']);
      },
      stop: () => {
        calls.push(['stop']);
      },
      setAutoFitEnabled: value => {
        calls.push(['setAutoFitEnabled', value]);
      },
      disableKeepInView: () => {
        calls.push(['disableKeepInView']);
      },
      restoreNodePositions: positionMap => {
        calls.push(['restoreNodePositions', [...positionMap.keys()]]);
      },
      restart: () => {
        calls.push(['restart']);
      }
    },
    scene: {
      clear: () => {
        calls.push(['scene.clear']);
      },
      draw2d: () => {
        calls.push(['draw2d']);
      },
      updateForce: (mol, renderOptions) => {
        calls.push(['updateForce', mol.id, renderOptions]);
      }
    },
    cache: {
      reset: () => {
        calls.push(['cache.reset']);
      }
    },
    selection: {
      clearValenceWarnings: () => {
        calls.push(['clearValenceWarnings']);
      }
    },
    analysis: {
      clearFormula: () => {
        calls.push(['clearFormula']);
      },
      clearWeight: () => {
        calls.push(['clearWeight']);
      },
      clearDescriptors: () => {
        calls.push(['clearDescriptors']);
      },
      clearFunctionalGroups: () => {
        calls.push(['clearFunctionalGroups']);
      }
    },
    document: {
      setCurrentMol: value => {
        currentMol = value;
      },
      setMol2d: value => {
        mol2d = value;
      }
    }
  });

  return {
    bridge,
    calls,
    getCurrentSmiles: () => currentSmiles,
    getCurrentInchi: () => currentInchi,
    getInputValue: () => inputValue,
    getCurrentMol: () => currentMol,
    getMol2d: () => mol2d,
    getCx2d: () => cx2d,
    getCy2d: () => cy2d,
    getHCounts2d: () => hCounts2d,
    getStereoMap2d: () => stereoMap2d,
    setMode: value => {
      mode = value;
    }
  };
}

describe('createSessionRuntimeBridge', () => {
  it('syncs the input field to SMILES mode', () => {
    const { bridge, getCurrentSmiles, getCurrentInchi, getInputValue } = makeBridge({
      inputMode: 'smiles'
    });

    bridge.syncInputField({ id: 'mol-1' });

    assert.equal(getCurrentSmiles(), 'smiles:mol-1');
    assert.equal(getCurrentInchi(), null);
    assert.equal(getInputValue(), 'smiles:mol-1');
  });

  it('syncs the input field to InChI mode', () => {
    const { bridge, getCurrentSmiles, getCurrentInchi, getInputValue } = makeBridge({
      inputMode: 'inchi'
    });

    bridge.syncInputField({ id: 'mol-2' });

    assert.equal(getCurrentSmiles(), 'smiles:mol-2');
    assert.equal(getCurrentInchi(), 'inchi:mol-2');
    assert.equal(getInputValue(), 'inchi:mol-2');
  });

  it('captures 2D and force view state snapshots', () => {
    const view2D = makeBridge({
      mode: '2d',
      cx2d: 11,
      cy2d: 12,
      hCounts2d: new Map([['a1', 2]]),
      stereoMap2d: new Map([['b1', 'wedge']])
    });
    const force = makeBridge({
      mode: 'force',
      forceNodes: [{ id: 'a1', x: 1, y: 2, vx: 3, vy: 4, anchorX: 5, anchorY: 6 }]
    });

    assert.deepEqual(view2D.bridge.captureViewState(), {
      mode: '2d',
      zoomTransform: { x: 1, y: 2, k: 3 },
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      cx2d: 11,
      cy2d: 12,
      hCounts2d: [['a1', 2]],
      stereoMap2d: [['b1', 'wedge']]
    });
    assert.deepEqual(force.bridge.captureViewState(), {
      mode: 'force',
      zoomTransform: { x: 1, y: 2, k: 3 },
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      nodePositions: [{ id: 'a1', x: 1, y: 2, vx: 3, vy: 4, anchorX: 5, anchorY: 6 }]
    });
  });

  it('clears force state through the extracted runtime bridge', () => {
    const { bridge, calls } = makeBridge();

    bridge.clearForceState();

    assert.deepEqual(calls, [['clearGraph'], ['stop'], ['setAutoFitEnabled', false], ['disableKeepInView'], ['scene.clear'], ['cache.reset'], ['clearValenceWarnings']]);
  });

  it('restores 2D snapshot state and redraws when 2D is active', () => {
    const { bridge, calls, getMol2d, getCx2d, getCy2d, getHCounts2d, getStereoMap2d } = makeBridge({
      mode: '2d'
    });
    const displayMol = { id: 'display-mol' };

    bridge.restore2dState(displayMol, {
      cx2d: 7,
      cy2d: 9,
      hCounts2d: [['a1', 1]],
      stereoMap2d: [['b1', 'dash']],
      zoomTransform: { x: 4, y: 5, k: 1.25 }
    });

    assert.equal(getMol2d(), displayMol);
    assert.equal(getCx2d(), 7);
    assert.equal(getCy2d(), 9);
    assert.deepEqual([...getHCounts2d()], [['a1', 1]]);
    assert.deepEqual([...getStereoMap2d()], [['b1', 'dash']]);
    assert.deepEqual(calls, [['draw2d'], ['restoreZoomTransform', { x: 4, y: 5, k: 1.25 }]]);
  });

  it('restores force snapshot state and node positions when force is active', () => {
    const { bridge, calls, getCurrentMol } = makeBridge({
      mode: 'force'
    });
    const displayMol = { id: 'force-mol' };

    bridge.restoreForceState(displayMol, {
      nodePositions: [{ id: 'a1', x: 10, y: 11, vx: 0, vy: 0, anchorX: 12, anchorY: 13 }],
      zoomTransform: { x: 2, y: 3, k: 0.75 }
    });

    assert.equal(getCurrentMol(), displayMol);
    assert.deepEqual(calls, [
      ['updateForce', 'force-mol', { preservePositions: true, preserveView: true }],
      ['restoreNodePositions', ['a1']],
      ['restart'],
      ['restoreZoomTransform', { x: 2, y: 3, k: 0.75 }]
    ]);
  });
});
