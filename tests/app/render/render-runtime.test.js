import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRenderRuntime } from '../../../src/app/render/render-runtime.js';

function makeRuntime({ mode = '2d' } = {}) {
  const calls = [];
  const runtime = createRenderRuntime({
    state: {
      getMode: () => mode,
      setCurrentMol: mol => {
        calls.push(['setCurrentMol', mol]);
      }
    },
    view: {
      resetOrientation: () => {
        calls.push(['resetOrientation']);
      }
    },
    history: {
      clear: () => {
        calls.push(['clearHistory']);
      }
    },
    highlights: {
      clear: () => {
        calls.push(['clearHighlights']);
      }
    },
    chemistry: {
      kekulize: mol => {
        calls.push(['kekulize', mol]);
      }
    },
    simulation: {
      stop: () => {
        calls.push(['stopSimulation']);
      }
    },
    scene: {
      draw2d: () => {
        calls.push(['draw2d']);
      },
      updateForce: (mol, options) => {
        calls.push(['updateForce', mol, options]);
      },
      render2d: (mol, options) => {
        calls.push(['render2d', mol, options]);
      }
    },
    analysis: {
      updateFormula: mol => {
        calls.push(['updateFormula', mol]);
      },
      updateDescriptors: mol => {
        calls.push(['updateDescriptors', mol]);
      },
      updatePanels: (mol, options) => {
        calls.push(['updatePanels', mol, options]);
      }
    }
  });

  return { runtime, calls };
}

describe('createRenderRuntime', () => {
  it('exposes direct draw2d and render2d delegates', () => {
    const { runtime, calls } = makeRuntime({ mode: '2d' });
    const mol = { id: 'mol-direct' };

    runtime.draw2d();
    runtime.render2d(mol, { preserveGeometry: true });

    assert.deepEqual(calls, [['draw2d'], ['render2d', mol, { preserveGeometry: true }]]);
  });

  it('routes 2D renders through the shared policy layer', () => {
    const { runtime, calls } = makeRuntime({ mode: '2d' });
    const mol = { id: 'mol-2d' };

    runtime.renderMol(mol, { preserveGeometry: true });

    assert.deepEqual(calls, [
      ['clearHighlights'],
      ['setCurrentMol', mol],
      ['resetOrientation'],
      ['clearHistory'],
      ['kekulize', mol],
      ['stopSimulation'],
      [
        'render2d',
        mol,
        {
          recomputeResonance: true,
          refreshResonancePanel: true,
          preserveGeometry: true,
          preserveAnalysis: false
        }
      ]
    ]);
  });

  it('passes reaction-layout preservation through 2D render policy', () => {
    const { runtime, calls } = makeRuntime({ mode: '2d' });
    const mol = { id: 'mol-reaction-layout' };

    runtime.renderMol(mol, { preserveGeometry: true, preserveReactionLayout: true });

    const renderCall = calls.find(call => call[0] === 'render2d');
    assert.deepEqual(renderCall, [
      'render2d',
      mol,
      {
        recomputeResonance: true,
        refreshResonancePanel: true,
        preserveGeometry: true,
        preserveAnalysis: false,
        preserveReactionLayout: true
      }
    ]);
  });

  it('routes force renders through the shared policy layer', () => {
    const { runtime, calls } = makeRuntime({ mode: 'force' });
    const mol = { id: 'mol-force' };
    const forceAnchorLayout = new Map([['a1', { x: 0, y: 0 }]]);

    runtime.renderMol(mol, { preserveHistory: true, preserveView: true, forceAnchorLayout });

    assert.deepEqual(calls, [
      ['clearHighlights'],
      ['setCurrentMol', mol],
      ['resetOrientation'],
      ['kekulize', mol],
      ['updateForce', mol, { preserveView: true, anchorLayout: forceAnchorLayout }],
      ['updateFormula', mol],
      ['updateDescriptors', mol],
      [
        'updatePanels',
        mol,
        {
          recomputeResonance: true,
          refreshResonancePanel: true
        }
      ]
    ]);
  });

  it('passes tight viewport fit options through the shared policy layer', () => {
    const mol2d = { id: 'mol-2d-tight' };
    const twoD = makeRuntime({ mode: '2d' });

    twoD.runtime.renderMol(mol2d, {
      preserveHistory: true,
      fitPad: 4,
      fitMaxScale: 4,
      ignoreOverlayPadding: true
    });

    assert.deepEqual(
      twoD.calls.find(call => call[0] === 'render2d'),
      [
        'render2d',
        mol2d,
        {
          recomputeResonance: true,
          refreshResonancePanel: true,
          preserveGeometry: false,
          preserveAnalysis: false,
          fitPad: 4,
          fitMaxScale: 4,
          ignoreOverlayPadding: true
        }
      ]
    );

    const molForce = { id: 'mol-force-tight' };
    const force = makeRuntime({ mode: 'force' });

    force.runtime.renderMol(molForce, {
      preserveHistory: true,
      forceFitPad: 4,
      forceFitScaleMultiplier: 4,
      forceIgnoreOverlayPadding: true
    });

    assert.deepEqual(
      force.calls.find(call => call[0] === 'updateForce'),
      [
        'updateForce',
        molForce,
        {
          preserveView: false,
          anchorLayout: null,
          fitPad: 4,
          fitScaleMultiplier: 4,
          ignoreOverlayPadding: true
        }
      ]
    );
  });

  it('passes initial force coordinate patches through the shared policy layer', () => {
    const { runtime, calls } = makeRuntime({ mode: 'force' });
    const mol = { id: 'mol-force-patch' };
    const forceAnchorLayout = new Map([['a1', { x: 0, y: 0 }]]);
    const forceInitialPatchPos = new Map([['a1', { x: 100, y: 120 }]]);

    runtime.renderMol(mol, {
      preserveHistory: true,
      forceAnchorLayout,
      forceInitialPatchPos
    });

    assert.deepEqual(
      calls.find(call => call[0] === 'updateForce'),
      ['updateForce', mol, { preserveView: false, anchorLayout: forceAnchorLayout, initialPatchPos: forceInitialPatchPos }]
    );
  });

  it('passes force position preservation through the shared policy layer', () => {
    const { runtime, calls } = makeRuntime({ mode: 'force' });
    const mol = { id: 'mol-force-preserve' };
    const forceAnchorLayout = new Map([['a1', { x: 0, y: 0 }]]);

    runtime.renderMol(mol, {
      preserveHistory: true,
      preserveView: true,
      forcePreservePositions: true,
      forceAnchorLayout
    });

    assert.deepEqual(
      calls.find(call => call[0] === 'updateForce'),
      ['updateForce', mol, { preserveView: true, anchorLayout: forceAnchorLayout, preservePositions: true }]
    );
  });

  it('passes force simulation restart policy through the shared policy layer', () => {
    const { runtime, calls } = makeRuntime({ mode: 'force' });
    const mol = { id: 'mol-force-no-restart' };

    runtime.renderMol(mol, {
      preserveHistory: true,
      forceRestartSimulation: false
    });

    assert.deepEqual(
      calls.find(call => call[0] === 'updateForce'),
      ['updateForce', mol, { preserveView: false, anchorLayout: null, restartSimulation: false }]
    );
  });

  it('passes force initial-settle policy through the shared policy layer', () => {
    const { runtime, calls } = makeRuntime({ mode: 'force' });
    const mol = { id: 'mol-force-no-settle' };

    runtime.renderMol(mol, {
      preserveHistory: true,
      forceSettleInitialLayout: false
    });

    assert.deepEqual(
      calls.find(call => call[0] === 'updateForce'),
      ['updateForce', mol, { preserveView: false, anchorLayout: null, settleInitialLayout: false }]
    );
  });

  it('preserves history and analysis when asked', () => {
    const { runtime, calls } = makeRuntime({ mode: '2d' });
    const mol = { id: 'mol-overlay' };

    runtime.renderMol(mol, { preserveHistory: true, preserveAnalysis: true });

    assert.deepEqual(calls, [
      ['setCurrentMol', mol],
      ['resetOrientation'],
      ['kekulize', mol],
      ['stopSimulation'],
      [
        'render2d',
        mol,
        {
          recomputeResonance: true,
          refreshResonancePanel: true,
          preserveGeometry: false,
          preserveAnalysis: true
        }
      ]
    ]);
  });

  it('passes force keep-in-view through the shared policy layer when requested', () => {
    const { runtime, calls } = makeRuntime({ mode: 'force' });
    const mol = { id: 'mol-force-clean' };
    const forceAnchorLayout = new Map([['a1', { x: 0, y: 0 }]]);

    runtime.renderMol(mol, {
      preserveHistory: true,
      preserveAnalysis: true,
      preserveView: true,
      forceKeepInView: true,
      forceAnchorLayout
    });

    assert.deepEqual(
      calls.filter(call => call[0] === 'updateForce'),
      [['updateForce', mol, { preserveView: true, anchorLayout: forceAnchorLayout, keepInView: true }]]
    );
  });

  it('restores the prior 2D zoom when preserveView is requested', () => {
    const calls = [];
    const runtime = createRenderRuntime({
      state: {
        getMode: () => '2d',
        setCurrentMol: mol => {
          calls.push(['setCurrentMol', mol]);
        }
      },
      view: {
        resetOrientation: () => {
          calls.push(['resetOrientation']);
        },
        captureZoomTransform: () => {
          calls.push(['captureZoomTransform']);
          return { x: 1, y: 2, k: 3 };
        },
        restoreZoomTransform: snapshot => {
          calls.push(['restoreZoomTransform', snapshot]);
        }
      },
      history: {
        clear: () => {
          calls.push(['clearHistory']);
        }
      },
      highlights: {
        clear: () => {
          calls.push(['clearHighlights']);
        }
      },
      chemistry: {
        kekulize: mol => {
          calls.push(['kekulize', mol]);
        }
      },
      simulation: {
        stop: () => {
          calls.push(['stopSimulation']);
        }
      },
      scene: {
        draw2d: () => {},
        updateForce: () => {},
        render2d: (mol, options) => {
          calls.push(['render2d', mol, options]);
        }
      },
      analysis: {
        updateFormula: () => {},
        updateDescriptors: () => {},
        updatePanels: () => {}
      }
    });
    const mol = { id: 'mol-zoom' };

    runtime.renderMol(mol, { preserveView: true });

    assert.deepEqual(calls, [
      ['clearHighlights'],
      ['captureZoomTransform'],
      ['setCurrentMol', mol],
      ['resetOrientation'],
      ['clearHistory'],
      ['kekulize', mol],
      ['stopSimulation'],
      [
        'render2d',
        mol,
        {
          recomputeResonance: true,
          refreshResonancePanel: true,
          preserveGeometry: false,
          preserveAnalysis: false
        }
      ],
      ['restoreZoomTransform', { x: 1, y: 2, k: 3 }]
    ]);
  });

  it('exposes the scene passthrough helpers', () => {
    const { runtime, calls } = makeRuntime({ mode: '2d' });
    const mol = { id: 'mol-force' };

    runtime.draw2d();
    runtime.updateForce(mol, { preservePositions: true, preserveView: true });

    assert.deepEqual(calls, [['draw2d'], ['updateForce', mol, { preservePositions: true, preserveView: true }]]);
  });
});
