import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutAtom } from '../../../src/layoutv2/model/layout-atom.js';
import { makeHydrogenatedCarbon } from '../support/molecules.js';

describe('layoutv2/model/layout-atom', () => {
  it('creates a layout-oriented atom descriptor with heavy-degree and explicit-H counts', () => {
    const molecule = makeHydrogenatedCarbon();
    const atom = molecule.atoms.get('c0');
    atom.visible = false;
    atom.x = 1.25;
    atom.y = -0.5;
    const layoutAtom = createLayoutAtom(atom, molecule);
    assert.deepEqual(layoutAtom, {
      id: 'c0',
      element: 'C',
      charge: -1,
      aromatic: false,
      radical: 1,
      chirality: null,
      atomMap: 7,
      visible: false,
      degree: 2,
      heavyDegree: 1,
      explicitHydrogenCount: 1,
      x: 1.25,
      y: -0.5,
      z: null
    });
  });
});
