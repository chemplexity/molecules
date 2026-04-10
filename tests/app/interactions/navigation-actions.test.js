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
      refineExistingCoords: (mol, options) => {
        calls.push(['refineExistingCoords', mol, options]);
        return new Map([['a1', { x: 0, y: 0 }]]);
      }
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
    ['refineExistingCoords', { cloned: true }, {
      suppressH: true,
      bondLength: 1.5,
      maxPasses: 12
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

test('cleanLayoutForce refines the live force geometry and rerenders with anchored force coords', () => {
  const cloneAtoms = new Map([
    ['a1', { id: 'a1', name: 'C', x: null, y: null }],
    ['a2', { id: 'a2', name: 'O', x: null, y: null }],
    ['h1', { id: 'h1', name: 'H', x: null, y: null }]
  ]);
  const sourceMol = {
    cloneCalls: 0,
    clone() {
      this.cloneCalls += 1;
      return {
        cloned: true,
        atoms: cloneAtoms
      };
    }
  };
  const calls = [];
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => 'force'
      },
      documentState: {
        getCurrentMol: () => sourceMol
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    simulation: {
      nodes: () => [
        { id: 'a1', x: 100, y: 100 },
        { id: 'a2', x: 141, y: 100 },
        { id: 'h1', x: 120.5, y: 100 }
      ]
    },
    helpers: {
      refineExistingCoords: (mol, options) => {
        calls.push([
          'refineExistingCoords',
          [...mol.atoms.entries()].map(([id, atom]) => [id, { x: atom.x, y: atom.y }]),
          options
        ]);
        mol.atoms.get('a1').x = 0;
        mol.atoms.get('a1').y = 0;
        mol.atoms.get('a2').x = 1.5;
        mol.atoms.get('a2').y = 0;
        return new Map([
          ['a1', { x: 0, y: 0 }],
          ['a2', { x: 1.5, y: 0 }]
        ]);
      }
    },
    renderers: {
      renderMol: (mol, options) => {
        calls.push([
          'renderMol',
          mol,
          {
            ...options,
            forceAnchorLayout: options.forceAnchorLayout ? [...options.forceAnchorLayout.entries()] : options.forceAnchorLayout
          }
        ]);
      }
    },
    view: {
      setPreserveSelectionOnNextRender: value => calls.push(['preserveSelection', value])
    },
    dom: {
      cleanForceButton: null
    }
  });

  actions.cleanLayoutForce();

  assert.equal(sourceMol.cloneCalls, 1);
  assert.deepEqual(calls, [
    ['takeSnapshot', { clearReactionPreview: false }],
    [
      'refineExistingCoords',
      [
        ['a1', { x: -0.75, y: 0 }],
        ['a2', { x: 0.75, y: 0 }],
        ['h1', { x: 0, y: 0 }]
      ],
      {
        suppressH: true,
        bondLength: 1.5,
        maxPasses: 12
      }
    ],
    ['preserveSelection', true],
    [
      'renderMol',
      { cloned: true, atoms: cloneAtoms },
      {
        preserveHistory: true,
        preserveAnalysis: true,
        preserveView: true,
        forceAnchorLayout: [
          ['a1', { x: 0, y: 0 }],
          ['a2', { x: 1.5, y: 0 }]
        ]
      }
    ]
  ]);
});

test('force flip refits the viewport when a reaction preview is active', () => {
  const nodes = [
    { id: 'a1', x: 10, y: 20, vx: 0, vy: 0 },
    { id: 'a2', x: 40, y: 20, vx: 0, vy: 0 }
  ];
  const calls = [];
  const fitTransform = { x: 12, y: 18, k: 1.2 };
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => 'force'
      },
      documentState: {
        getCurrentMol: () => ({})
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    simulation: {
      nodes: () => nodes
    },
    force: {
      patchForceNodePositions: (patchPos, options) => calls.push(['patchForceNodePositions', [...patchPos.entries()], options]),
      forceFitTransform: (fitNodes, pad, options) => {
        calls.push(['forceFitTransform', fitNodes.map(node => node.id), pad, options]);
        return fitTransform;
      },
      fitPad: 40,
      initialZoomMultiplier: 1.3,
      zoomTransformsDiffer: (a, b) => {
        calls.push(['zoomTransformsDiffer', a, b]);
        return true;
      }
    },
    helpers: {},
    overlays: {
      hasReactionPreview: () => true
    },
    renderers: {
      updateForce: (mol, options) => calls.push(['updateForce', mol, options])
    },
    view: {
      getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      setZoomTransform: transform => calls.push(['setZoomTransform', transform]),
      restorePersistentHighlight: () => calls.push(['restorePersistentHighlight'])
    }
  });

  actions.flip('h');

  assert.deepEqual(calls, [
    ['takeSnapshot', { clearReactionPreview: false }],
    ['patchForceNodePositions', [
      ['a1', { x: 40, y: 20 }],
      ['a2', { x: 10, y: 20 }]
    ], { setAnchors: true, alpha: 0 }],
    ['updateForce', {}, { preservePositions: true, preserveView: true }],
    ['forceFitTransform', ['a1', 'a2'], 40, { scaleMultiplier: 1.3 }],
    ['zoomTransformsDiffer', fitTransform, { x: 0, y: 0, k: 1 }],
    ['setZoomTransform', fitTransform],
    ['restorePersistentHighlight']
  ]);
});

test('force flip preserves the current viewport when no reaction preview is active', () => {
  const nodes = [
    { id: 'a1', x: 10, y: 20, vx: 0, vy: 0 },
    { id: 'a2', x: 40, y: 20, vx: 0, vy: 0 }
  ];
  const calls = [];
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => 'force'
      },
      documentState: {
        getCurrentMol: () => ({})
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    simulation: {
      nodes: () => nodes
    },
    force: {
      patchForceNodePositions: (patchPos, options) => calls.push(['patchForceNodePositions', [...patchPos.entries()], options]),
      forceFitTransform: () => {
        calls.push(['forceFitTransform']);
        return null;
      },
      fitPad: 40,
      initialZoomMultiplier: 1.3,
      zoomTransformsDiffer: () => true
    },
    helpers: {},
    overlays: {
      hasReactionPreview: () => false
    },
    renderers: {
      updateForce: (mol, options) => calls.push(['updateForce', mol, options])
    },
    view: {
      getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      setZoomTransform: transform => calls.push(['setZoomTransform', transform]),
      restorePersistentHighlight: () => calls.push(['restorePersistentHighlight'])
    }
  });

  actions.flip('h');

  assert.equal(calls.some(([name]) => name === 'forceFitTransform' || name === 'setZoomTransform'), false);
});
