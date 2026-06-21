import test from 'node:test';
import assert from 'node:assert/strict';

import { createNavigationActions } from '../../../src/app/interactions/navigation.js';
import { convertLineCoordsToForceLayout } from '../../../src/app/render/force-helpers.js';
import { Molecule } from '../../../src/core/Molecule.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineExistingCoords } from '../../../src/layout/index.js';

function approxEqual(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function maxRingBondLengthDeviation(molecule, expectedLength = 1.5) {
  return Math.max(
    0,
    ...molecule.getRings().flatMap(ring =>
      ring.map((atomId, index) => {
        const first = molecule.atoms.get(atomId);
        const second = molecule.atoms.get(ring[(index + 1) % ring.length]);
        return Math.abs(Math.hypot(first.x - second.x, first.y - second.y) - expectedLength);
      })
    )
  );
}

test('autoZoom recenters and fits the 2d molecule viewport', () => {
  const mol = {
    atoms: new Map([
      ['a1', { id: 'a1', name: 'C', x: 0, y: 0 }],
      ['a2', { id: 'a2', name: 'O', x: 2, y: 1 }],
      ['h1', { id: 'h1', name: 'H', x: 100, y: 100, visible: false }]
    ])
  };
  const calls = [];
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => '2d',
        setCx2d: value => calls.push(['setCx2d', value]),
        setCy2d: value => calls.push(['setCy2d', value])
      },
      documentState: {
        getMol2d: () => mol
      }
    },
    view: {
      fitCurrent2dView: () => calls.push(['fitCurrent2dView'])
    }
  });

  actions.autoZoom();

  assert.deepEqual(calls, [['fitCurrent2dView']]);
});

test('autoZoom fits the force molecule viewport', () => {
  const nodes = [
    { id: 'a1', x: 10, y: 20 },
    { id: 'a2', x: 40, y: 30 },
    { id: 'bad', x: NaN, y: 0 }
  ];
  const fitTransform = { x: 20, y: 30, k: 1.2 };
  const calls = [];
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => 'force'
      },
      documentState: {}
    },
    simulation: {
      nodes: () => nodes
    },
    force: {
      fitPad: 40,
      initialZoomMultiplier: 1.3,
      forceFitTransform: (fitNodes, pad, options) => {
        calls.push(['forceFitTransform', fitNodes.map(node => node.id), pad, options]);
        return fitTransform;
      }
    },
    view: {
      setZoomTransform: transform => calls.push(['setZoomTransform', transform])
    }
  });

  actions.autoZoom();

  assert.deepEqual(calls, [
    ['forceFitTransform', ['a1', 'a2'], 40, { scaleMultiplier: 1.3 }],
    ['setZoomTransform', fitTransform]
  ]);
});

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

test('cleanLayout2d snaps slightly distorted rings back to regular geometry before refinement', () => {
  const radius = 1.5;
  const atomEntries = Array.from({ length: 6 }, (_, index) => {
    const angle = (2 * Math.PI * index) / 6;
    const id = `a${index + 1}`;
    return [
      id,
      {
        id,
        name: 'C',
        x: radius * Math.cos(angle) + (index === 0 ? 0.18 : 0),
        y: radius * Math.sin(angle),
        visible: true
      }
    ];
  });
  const bondEntries = Array.from({ length: 6 }, (_, index) => {
    const firstId = `a${index + 1}`;
    const secondId = `a${((index + 1) % 6) + 1}`;
    return [
      `b${index + 1}`,
      {
        id: `b${index + 1}`,
        atoms: [firstId, secondId],
        isInRing: () => true
      }
    ];
  });
  const clonedMol = {
    atoms: new Map(atomEntries),
    bonds: new Map(bondEntries),
    getRings: () => [['a1', 'a2', 'a3', 'a4', 'a5', 'a6']],
    getBond(firstId, secondId) {
      return [...this.bonds.values()].find(bond => bond.atoms.includes(firstId) && bond.atoms.includes(secondId)) ?? null;
    }
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
        return new Map([...clonedMol.atoms].map(([id, atom]) => [id, { x: atom.x, y: atom.y }]));
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

  const lengths = bondEntries.map(([, bond]) => {
    const first = clonedMol.atoms.get(bond.atoms[0]);
    const second = clonedMol.atoms.get(bond.atoms[1]);
    return Math.hypot(first.x - second.x, first.y - second.y);
  });
  for (const length of lengths) {
    approxEqual(length, 1.5, 1e-9);
  }
  assert.deepEqual(calls, [
    {
      touchedAtoms: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
      touchedBonds: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']
    }
  ]);
});

test('cleanLayout2d snaps single ring substituent exits back to the local exterior angle', () => {
  const radius = 1.5;
  const atomEntries = Array.from({ length: 6 }, (_, index) => {
    const angle = (2 * Math.PI * index) / 6;
    const id = `a${index + 1}`;
    return [
      id,
      {
        id,
        name: 'C',
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        visible: true
      }
    ];
  });
  atomEntries.push([
    's1',
    {
      id: 's1',
      name: 'C',
      x: radius + 1.5 * Math.cos(Math.PI / 4),
      y: 1.5 * Math.sin(Math.PI / 4),
      visible: true
    }
  ]);
  const bondEntries = Array.from({ length: 6 }, (_, index) => {
    const firstId = `a${index + 1}`;
    const secondId = `a${((index + 1) % 6) + 1}`;
    return [
      `b${index + 1}`,
      {
        id: `b${index + 1}`,
        atoms: [firstId, secondId],
        isInRing: () => true
      }
    ];
  });
  bondEntries.push(['b7', { id: 'b7', atoms: ['a1', 's1'], isInRing: () => false }]);
  const clonedMol = {
    atoms: new Map(atomEntries),
    bonds: new Map(bondEntries),
    getRings: () => [['a1', 'a2', 'a3', 'a4', 'a5', 'a6']],
    getBond(firstId, secondId) {
      return [...this.bonds.values()].find(bond => bond.atoms.includes(firstId) && bond.atoms.includes(secondId)) ?? null;
    }
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
        return new Map([...clonedMol.atoms].map(([id, atom]) => [id, { x: atom.x, y: atom.y }]));
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

  const anchor = clonedMol.atoms.get('a1');
  const substituent = clonedMol.atoms.get('s1');
  approxEqual(Math.atan2(substituent.y - anchor.y, substituent.x - anchor.x), 0, 1e-9);
  approxEqual(Math.hypot(substituent.x - anchor.x, substituent.y - anchor.y), 1.5, 1e-9);
  assert.deepEqual(calls, [
    {
      touchedAtoms: ['a1', 'a2', 'a6', 's1'],
      touchedBonds: ['b1', 'b6', 'b7']
    }
  ]);
});

test('cleanLayout2d does not rotate attached rings as substituent angle repairs', () => {
  const radius = 1.5;
  const atomEntries = [];
  const bondEntries = [];
  const addAtom = (id, x, y) => {
    atomEntries.push([id, { id, name: 'C', x, y, visible: true }]);
  };
  const addBond = (id, firstId, secondId, inRing) => {
    bondEntries.push([id, { id, atoms: [firstId, secondId], isInRing: () => inRing }]);
  };

  const firstRingIds = Array.from({ length: 6 }, (_, index) => `a${index + 1}`);
  for (let index = 0; index < firstRingIds.length; index++) {
    const angle = (2 * Math.PI * index) / firstRingIds.length;
    addAtom(firstRingIds[index], radius * Math.cos(angle), radius * Math.sin(angle));
    addBond(`ra${index + 1}`, firstRingIds[index], firstRingIds[(index + 1) % firstRingIds.length], true);
  }

  const attachedRoot = {
    x: radius + radius * Math.cos(Math.PI / 4),
    y: radius * Math.sin(Math.PI / 4)
  };
  const secondCenter = { x: attachedRoot.x + radius, y: attachedRoot.y };
  const secondRingIds = Array.from({ length: 6 }, (_, index) => `b${index + 1}`);
  for (let index = 0; index < secondRingIds.length; index++) {
    const angle = Math.PI + (2 * Math.PI * index) / secondRingIds.length;
    addAtom(secondRingIds[index], secondCenter.x + radius * Math.cos(angle), secondCenter.y + radius * Math.sin(angle));
    addBond(`rb${index + 1}`, secondRingIds[index], secondRingIds[(index + 1) % secondRingIds.length], true);
  }
  addBond('link', 'a1', 'b1', false);

  const clonedMol = {
    atoms: new Map(atomEntries),
    bonds: new Map(bondEntries),
    getRings: () => [firstRingIds, secondRingIds],
    getBond(firstId, secondId) {
      return [...this.bonds.values()].find(bond => bond.atoms.includes(firstId) && bond.atoms.includes(secondId)) ?? null;
    }
  };
  const originalB1 = { x: clonedMol.atoms.get('b1').x, y: clonedMol.atoms.get('b1').y };
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
        return new Map([...clonedMol.atoms].map(([id, atom]) => [id, { x: atom.x, y: atom.y }]));
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

  approxEqual(clonedMol.atoms.get('b1').x, originalB1.x, 1e-9);
  approxEqual(clonedMol.atoms.get('b1').y, originalB1.y, 1e-9);
  assert.deepEqual(calls, [
    {
      touchedAtoms: [],
      touchedBonds: []
    }
  ]);
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
        forceKeepInView: true,
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

test('toggleMode seeds force mode from converted line coordinates', () => {
  const mol = new Molecule();
  const c1 = mol.addAtom('c1', 'C');
  const c2 = mol.addAtom('c2', 'C');
  c1.x = 0;
  c1.y = 0;
  c2.x = 1.5;
  c2.y = 0;
  mol.addBond('b1', 'c1', 'c2', { order: 1 }, false);
  const calls = [];
  let mode = '2d';
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => mode,
        setMode: nextMode => {
          mode = nextMode;
          calls.push(['setMode', nextMode]);
        },
        setRotationDeg: value => calls.push(['setRotationDeg', value]),
        setFlipH: value => calls.push(['setFlipH', value]),
        setFlipV: value => calls.push(['setFlipV', value])
      },
      documentState: {
        getCurrentMol: () => mol,
        getMol2d: () => mol,
        getCurrentSmiles: () => '',
        getCurrentInchi: () => ''
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    overlays: {
      hasReactionPreview: () => false,
      resetActiveResonanceView: source => calls.push(['resetActiveResonanceView', source]),
      reapplyActiveReactionPreview: () => false
    },
    simulation: {
      stop: () => calls.push(['stopSimulation'])
    },
    dom: {
      plotEl: { clientWidth: 800, clientHeight: 600 },
      updateModeChrome: nextMode => calls.push(['updateModeChrome', nextMode])
    },
    view: {
      clearPrimitiveHover: () => calls.push(['clearPrimitiveHover']),
      setPreserveSelectionOnNextRender: value => calls.push(['preserveSelection', value])
    },
    renderers: {
      renderMol: (renderedMol, options) => calls.push(['renderMol', renderedMol, options])
    },
    parsers: {}
  });

  actions.toggleMode();

  const renderCall = calls.find(call => call[0] === 'renderMol');
  assert.equal(mode, 'force');
  assert.equal(renderCall[2].preserveHistory, true);
  assert.deepEqual([...renderCall[2].forceAnchorLayout.entries()], [
    ['c1', { x: 0, y: 0 }],
    ['c2', { x: 1.5, y: 0 }]
  ]);
  approxEqual(renderCall[2].forceInitialPatchPos.get('c1').x, 379.5);
  approxEqual(renderCall[2].forceInitialPatchPos.get('c1').y, 300);
  approxEqual(renderCall[2].forceInitialPatchPos.get('c2').x, 420.5);
  approxEqual(renderCall[2].forceInitialPatchPos.get('c2').y, 300);
});

test('toggleMode writes converted force coordinates before rendering line mode', () => {
  const mol = new Molecule();
  mol.addAtom('c1', 'C');
  mol.addAtom('c2', 'C');
  mol.addBond('b1', 'c1', 'c2', { order: 1 }, false);
  const calls = [];
  let mode = 'force';
  const nodes = [
    { id: 'c1', name: 'C', x: 100, y: 200 },
    { id: 'c2', name: 'C', x: 141, y: 200 }
  ];
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => mode,
        setMode: nextMode => {
          mode = nextMode;
          calls.push(['setMode', nextMode]);
        },
        setRotationDeg: value => calls.push(['setRotationDeg', value]),
        setFlipH: value => calls.push(['setFlipH', value]),
        setFlipV: value => calls.push(['setFlipV', value])
      },
      documentState: {
        getCurrentMol: () => mol,
        getMol2d: () => null,
        getCurrentSmiles: () => '',
        getCurrentInchi: () => ''
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    overlays: {
      hasReactionPreview: () => false,
      resetActiveResonanceView: source => calls.push(['resetActiveResonanceView', source]),
      reapplyActiveReactionPreview: () => false
    },
    simulation: {
      stop: () => calls.push(['stopSimulation']),
      nodes: () => nodes
    },
    dom: {
      updateModeChrome: nextMode => calls.push(['updateModeChrome', nextMode])
    },
    view: {
      clearPrimitiveHover: () => calls.push(['clearPrimitiveHover']),
      setPreserveSelectionOnNextRender: value => calls.push(['preserveSelection', value])
    },
    renderers: {
      renderMol: (renderedMol, options) => calls.push(['renderMol', renderedMol, options])
    },
    parsers: {}
  });

  actions.toggleMode();

  const renderCall = calls.find(call => call[0] === 'renderMol');
  const renderedMol = renderCall[1];
  assert.equal(mode, '2d');
  assert.deepEqual(renderCall[2], { preserveHistory: true, preserveGeometry: true });
  approxEqual(renderedMol.atoms.get('c1').x, -0.75);
  approxEqual(renderedMol.atoms.get('c1').y, 0);
  approxEqual(renderedMol.atoms.get('c2').x, 0.75);
  approxEqual(renderedMol.atoms.get('c2').y, 0);
});

test('toggleMode regularizes small force-mode ring drift before rendering line mode', () => {
  const mol = new Molecule();
  const ringIds = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  for (const atomId of ringIds) {
    mol.addAtom(atomId, 'C');
  }
  for (let index = 0; index < ringIds.length; index++) {
    mol.addBond(`b${index + 1}`, ringIds[index], ringIds[(index + 1) % ringIds.length], { order: 1 }, false);
  }
  const forceCenter = { x: 100, y: 100 };
  const nodes = ringIds.map((atomId, index) => {
    const angle = (2 * Math.PI * index) / ringIds.length;
    return {
      id: atomId,
      name: 'C',
      x: forceCenter.x + 41 * Math.cos(angle),
      y: forceCenter.y + 41 * Math.sin(angle)
    };
  });
  nodes[2].x += 6;
  nodes[2].y -= 3;
  const calls = [];
  let mode = 'force';
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => mode,
        setMode: nextMode => {
          mode = nextMode;
          calls.push(['setMode', nextMode]);
        },
        setRotationDeg: value => calls.push(['setRotationDeg', value]),
        setFlipH: value => calls.push(['setFlipH', value]),
        setFlipV: value => calls.push(['setFlipV', value])
      },
      documentState: {
        getCurrentMol: () => mol,
        getMol2d: () => null,
        getCurrentSmiles: () => '',
        getCurrentInchi: () => ''
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    overlays: {
      hasReactionPreview: () => false,
      resetActiveResonanceView: source => calls.push(['resetActiveResonanceView', source]),
      reapplyActiveReactionPreview: () => false
    },
    simulation: {
      stop: () => calls.push(['stopSimulation']),
      nodes: () => nodes
    },
    dom: {
      updateModeChrome: nextMode => calls.push(['updateModeChrome', nextMode])
    },
    view: {
      clearPrimitiveHover: () => calls.push(['clearPrimitiveHover']),
      setPreserveSelectionOnNextRender: value => calls.push(['preserveSelection', value])
    },
    renderers: {
      renderMol: (renderedMol, options) => calls.push(['renderMol', renderedMol, options])
    },
    parsers: {}
  });

  actions.toggleMode();

  const renderedMol = calls.find(call => call[0] === 'renderMol')[1];
  for (let index = 0; index < ringIds.length; index++) {
    const first = renderedMol.atoms.get(ringIds[index]);
    const second = renderedMol.atoms.get(ringIds[(index + 1) % ringIds.length]);
    approxEqual(Math.hypot(first.x - second.x, first.y - second.y), 1.5, 1e-9);
  }
});

test('repeated clean after force perturbation preserves regular ring geometry', () => {
  const smiles = 'Cc1cc(C)cc(NC(=O)c2cc(NC(=O)c3ccc(cc3Cl)S(=O)(=O)C)ccc2Cl)c1';
  let mol2d = parseSMILES(smiles);
  generateCoords(mol2d, { suppressH: true, bondLength: 1.5 });
  let currentMol = mol2d;
  let mode = 'force';
  const converted = convertLineCoordsToForceLayout(currentMol, {
    bondLength: 1.5,
    forceCenter: { x: 400, y: 300 }
  });
  const nodes = converted.nodes.map(node => ({ ...node }));
  const movedNode = nodes.find(node => node.id === 'C15');
  assert.ok(movedNode);
  movedNode.x += 12;
  movedNode.y -= 8;
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => mode,
        setMode: nextMode => {
          mode = nextMode;
        },
        setRotationDeg() {},
        setFlipH() {},
        setFlipV() {}
      },
      documentState: {
        getCurrentMol: () => currentMol,
        getMol2d: () => mol2d,
        getCurrentSmiles: () => smiles,
        getCurrentInchi: () => ''
      }
    },
    history: {
      takeSnapshot() {}
    },
    overlays: {
      hasReactionPreview: () => false,
      resetActiveResonanceView() {},
      reapplyActiveReactionPreview: () => false
    },
    simulation: {
      stop() {},
      nodes: () => nodes
    },
    dom: {
      updateModeChrome() {},
      clean2dButton: null,
      plotEl: { clientWidth: 800, clientHeight: 600 }
    },
    view: {
      clearPrimitiveHover() {},
      setPreserveSelectionOnNextRender() {}
    },
    renderers: {
      renderMol: renderedMol => {
        currentMol = renderedMol;
        if (mode === '2d') {
          mol2d = renderedMol;
        }
      }
    },
    helpers: {
      refineExistingCoords
    },
    parsers: {
      parseSMILES
    }
  });

  actions.toggleMode();
  for (let cleanIndex = 0; cleanIndex < 8; cleanIndex++) {
    actions.cleanLayout2d();
    assert.ok(maxRingBondLengthDeviation(mol2d) < 1e-6, `ring geometry drifted after clean ${cleanIndex + 1}`);
  }
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

test('line rotate uses the rendered auto zoom fit after drawing', () => {
  const mol = {
    atoms: new Map([
      ['c1', { id: 'c1', name: 'C', x: 0, y: 0 }],
      ['c2', { id: 'c2', name: 'C', x: 1.5, y: 0 }]
    ])
  };
  const calls = [];
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => '2d',
        getRotationDeg: () => 0,
        setRotationDeg: value => calls.push(['setRotationDeg', value]),
        setCx2d: value => calls.push(['setCx2d', value]),
        setCy2d: value => calls.push(['setCy2d', value])
      },
      documentState: {
        getMol2d: () => mol
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    helpers: {
      atomBBox(atoms) {
        const xs = atoms.map(atom => atom.x);
        const ys = atoms.map(atom => atom.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
          minX,
          maxX,
          minY,
          maxY,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2
        };
      }
    },
    force: {
      fitPad: 40,
      initialZoomMultiplier: 1.3
    },
    overlays: {
      viewportFitPadding: pad => ({ left: pad, right: pad, top: pad, bottom: pad })
    },
    dom: {
      plotEl: { clientWidth: 600, clientHeight: 400 }
    },
    view: {
      scale: 60,
      restorePersistentHighlight: () => calls.push(['restorePersistentHighlight']),
      getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      makeZoomIdentity: (x, y, k) => ({ x, y, k }),
      setZoomTransform: transform => calls.push(['setZoomTransform', transform]),
      fitCurrent2dView: () => calls.push(['fitCurrent2dView'])
    },
    renderers: {
      draw2d: () => calls.push(['draw2d'])
    }
  });

  actions.startRotate(90);
  actions.stopRotate();

  const drawIndex = calls.findIndex(([name]) => name === 'draw2d');
  const fitIndex = calls.findIndex(([name]) => name === 'fitCurrent2dView');
  assert.ok(drawIndex >= 0);
  assert.ok(fitIndex > drawIndex);
  assert.equal(calls.some(([name]) => name === 'setZoomTransform'), false);
});

test('line rotate falls back to the math fit when rendered auto zoom is unavailable', () => {
  const mol = {
    atoms: new Map([
      ['c1', { id: 'c1', name: 'C', x: 0, y: 0 }],
      ['c2', { id: 'c2', name: 'C', x: 1.5, y: 0 }]
    ])
  };
  const calls = [];
  const actions = createNavigationActions({
    state: {
      viewState: {
        getMode: () => '2d',
        getRotationDeg: () => 0,
        setRotationDeg: value => calls.push(['setRotationDeg', value]),
        setCx2d: value => calls.push(['setCx2d', value]),
        setCy2d: value => calls.push(['setCy2d', value])
      },
      documentState: {
        getMol2d: () => mol
      }
    },
    history: {
      takeSnapshot: options => calls.push(['takeSnapshot', options])
    },
    helpers: {
      atomBBox(atoms) {
        const xs = atoms.map(atom => atom.x);
        const ys = atoms.map(atom => atom.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
          minX,
          maxX,
          minY,
          maxY,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2
        };
      }
    },
    force: {
      fitPad: 40,
      initialZoomMultiplier: 1.3
    },
    overlays: {
      viewportFitPadding: pad => ({ left: pad, right: pad, top: pad, bottom: pad })
    },
    dom: {
      plotEl: { clientWidth: 600, clientHeight: 400 }
    },
    view: {
      scale: 60,
      restorePersistentHighlight: () => calls.push(['restorePersistentHighlight']),
      makeZoomIdentity: (x, y, k) => ({ x, y, k }),
      setZoomTransform: transform => calls.push(['setZoomTransform', transform])
    },
    renderers: {
      draw2d: () => calls.push(['draw2d'])
    }
  });

  actions.startRotate(90);
  actions.stopRotate();

  assert.deepEqual(calls.find(([name]) => name === 'setZoomTransform'), ['setZoomTransform', { x: -90, y: -60, k: 1.3 }]);
  assert.ok(calls.some(([name]) => name === 'draw2d'));
});

test('force rotate transforms hydrogen slots and fits the viewport outside reaction preview', () => {
  const nodes = [
    { id: 'c1', name: 'C', x: 300, y: 200, vx: 0, vy: 0 },
    { id: 'h1', name: 'H', x: 300, y: 220, vx: 0, vy: 0, forcePlacementParentId: 'c1', forcePlacementAngle: Math.PI / 2 }
  ];
  const calls = [];
  const fitTransform = { x: 18, y: 24, k: 1.1 };
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
    overlays: {
      hasReactionPreview: () => false
    },
    dom: {
      plotEl: { clientWidth: 600, clientHeight: 400 }
    },
    view: {
      getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      setZoomTransform: transform => calls.push(['setZoomTransform', transform])
    }
  });

  actions.startRotate(90);
  actions.stopRotate();

  const patchCall = calls.find(([name]) => name === 'patchForceNodePositions');
  assert.deepEqual(patchCall[2], { setAnchors: true, alpha: 0 });
  approxEqual(patchCall[1][0][1].x, 290);
  approxEqual(patchCall[1][0][1].y, 210);
  approxEqual(patchCall[1][1][1].x, 310);
  approxEqual(patchCall[1][1][1].y, 210);
  assert.equal(patchCall[1][1][1].forcePlacementParentId, 'c1');
  approxEqual(patchCall[1][1][1].forcePlacementAngle, 0);
  assert.deepEqual(calls.filter(([name]) => name === 'forceFitTransform'), [['forceFitTransform', ['c1', 'h1'], 40, { scaleMultiplier: 1.3 }]]);
  assert.deepEqual(calls.find(([name]) => name === 'zoomTransformsDiffer'), ['zoomTransformsDiffer', fitTransform, { x: 0, y: 0, k: 1 }]);
  assert.deepEqual(calls.find(([name]) => name === 'setZoomTransform'), ['setZoomTransform', fitTransform]);
});

test('force rotate skips applying a fit when the viewport is already fitted', () => {
  const nodes = [
    { id: 'c1', name: 'C', x: 580, y: 200, vx: 0, vy: 0 },
    { id: 'h1', name: 'H', x: 580, y: 220, vx: 0, vy: 0, forcePlacementParentId: 'c1', forcePlacementAngle: Math.PI / 2 }
  ];
  const calls = [];
  const fitTransform = { x: 12, y: 18, k: 0.8 };
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
        return false;
      }
    },
    overlays: {
      hasReactionPreview: () => false
    },
    dom: {
      plotEl: { clientWidth: 600, clientHeight: 400 }
    },
    view: {
      getZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      setZoomTransform: transform => calls.push(['setZoomTransform', transform])
    }
  });

  actions.startRotate(90);
  actions.stopRotate();

  assert.ok(calls.some(([name]) => name === 'patchForceNodePositions'));
  assert.deepEqual(calls.filter(([name]) => name === 'forceFitTransform'), [['forceFitTransform', ['c1', 'h1'], 40, { scaleMultiplier: 1.3 }]]);
  assert.deepEqual(calls.find(([name]) => name === 'zoomTransformsDiffer'), ['zoomTransformsDiffer', fitTransform, { x: 0, y: 0, k: 1 }]);
  assert.equal(calls.some(([name]) => name === 'setZoomTransform'), false);
});

test('force flip mirrors hydrogen slot angles with the hydrogen nodes', () => {
  const nodes = [
    { id: 'c1', name: 'C', x: 10, y: 20, vx: 0, vy: 0 },
    { id: 'h1', name: 'H', x: 30, y: 20, vx: 0, vy: 0, forcePlacementParentId: 'c1', forcePlacementAngle: 0 }
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
      patchForceNodePositions: (patchPos, options) => calls.push(['patchForceNodePositions', [...patchPos.entries()], options])
    },
    helpers: {},
    overlays: {
      hasReactionPreview: () => false
    },
    renderers: {
      updateForce: (mol, options) => calls.push(['updateForce', mol, options])
    },
    view: {
      restorePersistentHighlight: () => calls.push(['restorePersistentHighlight'])
    }
  });

  actions.flip('h');

  const patchCall = calls.find(([name]) => name === 'patchForceNodePositions');
  assert.deepEqual(patchCall[2], { setAnchors: true, alpha: 0 });
  assert.deepEqual(patchCall[1][0], ['c1', { x: 30, y: 20 }]);
  assert.equal(patchCall[1][1][0], 'h1');
  approxEqual(patchCall[1][1][1].x, 10);
  approxEqual(patchCall[1][1][1].y, 20);
  assert.equal(patchCall[1][1][1].forcePlacementParentId, 'c1');
  approxEqual(patchCall[1][1][1].forcePlacementAngle, Math.PI);
});
