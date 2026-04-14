import test from 'node:test';
import assert from 'node:assert/strict';

import { createNavigationActions } from '../../../src/app/interactions/navigation.js';

test('cleanLayout2d rerenders from a cloned molecule with preserved history', () => {
  const clonedMol = {
    atoms: new Map([
      ['a1', { id: 'a1', name: 'C', x: 0, y: 0 }],
      ['a2', { id: 'a2', name: 'O', x: 2.2, y: 0 }],
      ['h1', { id: 'h1', name: 'H', x: 0, y: 0, visible: false }]
    ]),
    bonds: new Map([
      ['b1', { id: 'b1', atoms: ['a1', 'a2'] }],
      ['b2', { id: 'b2', atoms: ['a1', 'h1'] }]
    ])
  };
  const sourceMol = {
    cloneCalls: 0,
    clone() {
      this.cloneCalls += 1;
      return clonedMol;
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
        calls.push([
          'refineExistingCoords',
          mol,
          {
            ...options,
            touchedAtoms: options.touchedAtoms ? [...options.touchedAtoms].sort() : options.touchedAtoms,
            touchedBonds: options.touchedBonds ? [...options.touchedBonds].sort() : options.touchedBonds
          }
        ]);
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
    [
      'refineExistingCoords',
      clonedMol,
      {
        suppressH: true,
        bondLength: 1.5,
        maxPasses: 12,
        touchedAtoms: ['a1', 'a2'],
        touchedBonds: ['b1']
      }
    ],
    ['preserveSelection', true],
    ['renderMol', clonedMol, { preserveHistory: true, preserveAnalysis: true, preserveGeometry: true }]
  ]);
});

test('cleanLayout2d preserves reaction-preview metadata on the working clone', () => {
  const previewMeta = {
    forcedStereoBondTypes: new Map([['b1', 'wedge']]),
    forcedStereoBondCenters: new Map([['b1', 'a1']])
  };
  const clonedMol = {
    atoms: new Map(),
    bonds: new Map()
  };
  const sourceMol = {
    __reactionPreview: previewMeta,
    clone() {
      return clonedMol;
    }
  };

  const seen = {
    refinePreview: null,
    renderPreview: null
  };
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
      takeSnapshot() {}
    },
    renderers: {
      renderMol: mol => {
        seen.renderPreview = mol.__reactionPreview ?? null;
      }
    },
    helpers: {
      refineExistingCoords: mol => {
        seen.refinePreview = mol.__reactionPreview ?? null;
        return new Map();
      }
    },
    view: {
      setPreserveSelectionOnNextRender() {}
    },
    dom: {
      clean2dButton: null
    }
  });

  actions.cleanLayout2d();

  assert.equal(seen.refinePreview, previewMeta);
  assert.equal(seen.renderPreview, previewMeta);
  assert.equal(clonedMol.__reactionPreview, previewMeta);
});

test('cleanLayout2d ignores hidden hydrogen bonds when deriving refinement hints', () => {
  const clonedMol = {
    atoms: new Map([
      ['a1', { id: 'a1', name: 'C', x: 0, y: 0, visible: true }],
      ['a2', { id: 'a2', name: 'C', x: 1.5, y: 0, visible: true }],
      ['h1', { id: 'h1', name: 'H', x: 0, y: 0, visible: false }]
    ]),
    bonds: new Map([
      ['b1', { id: 'b1', atoms: ['a1', 'a2'] }],
      ['b2', { id: 'b2', atoms: ['a1', 'h1'] }]
    ])
  };
  const sourceMol = {
    clone() {
      return clonedMol;
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
      takeSnapshot() {}
    },
    renderers: {
      renderMol() {}
    },
    helpers: {
      refineExistingCoords: (_mol, options) => {
        calls.push({
          touchedAtoms: options.touchedAtoms ? [...options.touchedAtoms].sort() : null,
          touchedBonds: options.touchedBonds ? [...options.touchedBonds].sort() : null
        });
        return new Map();
      }
    },
    view: {
      setPreserveSelectionOnNextRender() {}
    },
    dom: {
      clean2dButton: null
    }
  });

  actions.cleanLayout2d();

  assert.deepEqual(calls, [
    {
      touchedAtoms: [],
      touchedBonds: []
    }
  ]);
});

test('cleanLayout2d expands stretched heavy-bond hints through the attached local heavy neighborhood', () => {
  const clonedMol = {
    atoms: new Map([
      ['a1', { id: 'a1', name: 'C', x: 0, y: 0, visible: true }],
      ['a2', { id: 'a2', name: 'C', x: 1.5, y: 0, visible: true }],
      ['a3', { id: 'a3', name: 'C', x: 3, y: 0, visible: true }],
      ['a4', { id: 'a4', name: 'O', x: 5.5, y: 0, visible: true }],
      ['a5', { id: 'a5', name: 'O', x: 3, y: 1.5, visible: true }]
    ]),
    bonds: new Map([
      ['b1', { id: 'b1', atoms: ['a1', 'a2'] }],
      ['b2', { id: 'b2', atoms: ['a2', 'a3'] }],
      ['b3', { id: 'b3', atoms: ['a3', 'a4'] }],
      ['b4', { id: 'b4', atoms: ['a3', 'a5'] }]
    ])
  };
  const sourceMol = {
    clone() {
      return clonedMol;
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
      takeSnapshot() {}
    },
    renderers: {
      renderMol() {}
    },
    helpers: {
      refineExistingCoords: (_mol, options) => {
        calls.push({
          touchedAtoms: options.touchedAtoms ? [...options.touchedAtoms].sort() : null,
          touchedBonds: options.touchedBonds ? [...options.touchedBonds].sort() : null
        });
        return new Map();
      }
    },
    view: {
      setPreserveSelectionOnNextRender() {}
    },
    dom: {
      clean2dButton: null
    }
  });

  actions.cleanLayout2d();

  assert.deepEqual(calls, [
    {
      touchedAtoms: ['a1', 'a2', 'a3', 'a4', 'a5'],
      touchedBonds: ['b1', 'b2', 'b3', 'b4']
    }
  ]);
});

test('cleanLayout2d treats compressed non-ring heavy bonds as locally distorted', () => {
  const clonedMol = {
    atoms: new Map([
      ['a1', { id: 'a1', name: 'C', x: 0, y: 0, visible: true }],
      ['a2', { id: 'a2', name: 'C', x: 1.5, y: 0, visible: true }],
      ['a3', { id: 'a3', name: 'O', x: 2.2, y: 0, visible: true }]
    ]),
    bonds: new Map([
      [
        'b1',
        {
          id: 'b1',
          atoms: ['a1', 'a2'],
          isInRing: () => false
        }
      ],
      [
        'b2',
        {
          id: 'b2',
          atoms: ['a2', 'a3'],
          isInRing: () => false
        }
      ]
    ])
  };
  const sourceMol = {
    clone() {
      return clonedMol;
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
      takeSnapshot() {}
    },
    renderers: {
      renderMol() {}
    },
    helpers: {
      refineExistingCoords: (_mol, options) => {
        calls.push({
          touchedAtoms: options.touchedAtoms ? [...options.touchedAtoms].sort() : null,
          touchedBonds: options.touchedBonds ? [...options.touchedBonds].sort() : null
        });
        return new Map();
      }
    },
    view: {
      setPreserveSelectionOnNextRender() {}
    },
    dom: {
      clean2dButton: null
    }
  });

  actions.cleanLayout2d();

  assert.deepEqual(calls, [
    {
      touchedAtoms: ['a1', 'a2', 'a3'],
      touchedBonds: ['b1', 'b2']
    }
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

test('cleanLayoutForce refines the live force geometry with local damage hints and rerenders with anchored force coords', () => {
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
          {
            ...options,
            touchedAtoms: options.touchedAtoms ? [...options.touchedAtoms].sort() : options.touchedAtoms,
            touchedBonds: options.touchedBonds ? [...options.touchedBonds].sort() : options.touchedBonds
          }
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
        maxPasses: 12,
        touchedAtoms: [],
        touchedBonds: []
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

test('cleanLayoutForce derives local refinement hints from distorted force geometry', () => {
  const cloneAtoms = new Map([
    ['a1', { id: 'a1', name: 'C', x: null, y: null, visible: true }],
    ['a2', { id: 'a2', name: 'C', x: null, y: null, visible: true }],
    ['a3', { id: 'a3', name: 'O', x: null, y: null, visible: true }]
  ]);
  const cloneBonds = new Map([
    ['b1', { id: 'b1', atoms: ['a1', 'a2'], isInRing: () => false }],
    ['b2', { id: 'b2', atoms: ['a2', 'a3'], isInRing: () => false }]
  ]);
  const sourceMol = {
    clone() {
      return {
        cloned: true,
        atoms: cloneAtoms,
        bonds: cloneBonds
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
      takeSnapshot() {}
    },
    simulation: {
      nodes: () => [
        { id: 'a1', x: 100, y: 100 },
        { id: 'a2', x: 141, y: 100 },
        { id: 'a3', x: 210, y: 100 }
      ]
    },
    helpers: {
      refineExistingCoords: (_mol, options) => {
        calls.push({
          touchedAtoms: options.touchedAtoms ? [...options.touchedAtoms].sort() : null,
          touchedBonds: options.touchedBonds ? [...options.touchedBonds].sort() : null
        });
        return new Map();
      }
    },
    renderers: {
      renderMol() {}
    },
    view: {
      setPreserveSelectionOnNextRender() {}
    },
    dom: {
      cleanForceButton: null
    }
  });

  actions.cleanLayoutForce();

  assert.deepEqual(calls, [
    {
      touchedAtoms: ['a1', 'a2', 'a3'],
      touchedBonds: ['b1', 'b2']
    }
  ]);
});

test('cleanLayoutForce reapplies reaction-preview orientation before anchoring the cleaned force layout', () => {
  const previewMeta = {
    mappedAtomPairs: [['a1', '__rxn_product__0:a1']]
  };
  const cloneAtoms = new Map([
    ['a1', { id: 'a1', name: 'C', x: null, y: null }],
    ['__rxn_product__0:a1', { id: '__rxn_product__0:a1', name: 'C', x: null, y: null }]
  ]);
  const sourceMol = {
    __reactionPreview: previewMeta,
    clone() {
      return {
        atoms: cloneAtoms,
        bonds: new Map()
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
      takeSnapshot() {}
    },
    simulation: {
      nodes: () => [
        { id: 'a1', x: 100, y: 100 },
        { id: '__rxn_product__0:a1', x: 141, y: 100 }
      ]
    },
    helpers: {
      refineExistingCoords: () => new Map()
    },
    overlays: {
      alignReaction2dProductOrientation: mol => calls.push(['align', mol.__reactionPreview]),
      spreadReaction2dProductComponents: (_mol, bondLength) => calls.push(['spread', bondLength]),
      centerReaction2dPairCoords: (_mol, bondLength) => calls.push(['center', bondLength])
    },
    renderers: {
      renderMol: () => calls.push(['render'])
    },
    view: {
      setPreserveSelectionOnNextRender: () => {}
    },
    dom: {
      cleanForceButton: null
    }
  });

  actions.cleanLayoutForce();

  assert.deepEqual(calls, [['align', previewMeta], ['spread', 1.5], ['center', 1.5], ['render']]);
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
    [
      'patchForceNodePositions',
      [
        ['a1', { x: 40, y: 20 }],
        ['a2', { x: 10, y: 20 }]
      ],
      { setAnchors: true, alpha: 0 }
    ],
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

  assert.equal(
    calls.some(([name]) => name === 'forceFitTransform' || name === 'setZoomTransform'),
    false
  );
});
