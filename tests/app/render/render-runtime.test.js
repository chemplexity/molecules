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
