import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/smiles.js';
import { renderMolSVG } from '../../src/layout/render2d.js';
import { atomColor } from '../../src/layout/mol2d-helpers.js';
import { pointInPolygon } from '../../src/layoutv2/geometry/polygon.js';

test('renderMolSVG omits lone-pair circles by default', () => {
  const mol = parseSMILES('CO');
  const rendered = renderMolSVG(mol);

  assert.ok(rendered, 'expected SVG render output');
  assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 0);
});

test('renderMolSVG emits lone-pair circles when enabled', () => {
  const mol = parseSMILES('CO');
  const rendered = renderMolSVG(mol, { showLonePairs: true });

  assert.ok(rendered, 'expected SVG render output');
  assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 4);
});

test('renderMolSVG shows a lone pair for aromatic [nH] when enabled', () => {
  const mol = parseSMILES('c1ccc2[nH]ccc2c1');
  const rendered = renderMolSVG(mol, { showLonePairs: true });

  assert.ok(rendered, 'expected SVG render output');
  assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 2);
});

test('renderMolSVG wraps charge labels in a thin outlined circle', () => {
  const mol = parseSMILES('[NH4+]');
  const rendered = renderMolSVG(mol);

  assert.ok(rendered, 'expected SVG render output');
  assert.equal((rendered.svgContent.match(/class="atom-charge-ring"/g) ?? []).length, 1);
  assert.equal((rendered.svgContent.match(/class="atom-charge-text"/g) ?? []).length, 1);
  assert.match(rendered.svgContent, />\+<\/text>/);
});

test('atomColor uses a subdued metallic palette for selected metals', () => {
  assert.equal(atomColor('Mg'), '#5E636B');
  assert.equal(atomColor('Ag'), '#C0C0C0');
  assert.equal(atomColor('Au'), '#D4AF37');
  assert.equal(atomColor('Pt'), '#C9CDD2');
  assert.equal(atomColor('Hg'), '#B8C3CF');
});

test('renderMolSVG keeps projected hidden stereo hydrogens out of incident ring faces', () => {
  const mol = parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O');
  const rendered = renderMolSVG(mol);

  assert.ok(rendered, 'expected SVG render output');

  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'H' || atom.visible !== false || atom.x == null || atom.y == null) {
      continue;
    }
    const parent = atom.getNeighbors(mol).find(neighbor => neighbor && neighbor.x != null && neighbor.y != null);
    if (!parent?.getChirality?.()) {
      continue;
    }
    const incidentRingPolygons = mol.getRings()
      .filter(ringAtomIds => ringAtomIds.includes(parent.id))
      .map(ringAtomIds => ringAtomIds
        .map(atomId => mol.atoms.get(atomId))
        .filter(ringAtom => ringAtom && ringAtom.x != null && ringAtom.y != null)
        .map(ringAtom => ({ x: ringAtom.x, y: ringAtom.y })))
      .filter(polygon => polygon.length >= 3);
    assert.equal(
      incidentRingPolygons.some(polygon => pointInPolygon({ x: atom.x, y: atom.y }, polygon)),
      false,
      `expected projected hidden hydrogen on ${parent.id} to stay outside incident ring faces`
    );
  }
});
