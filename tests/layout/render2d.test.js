import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/smiles.js';
import { renderMolSVG } from '../../src/layout/render2d.js';
import { generateAndRefine2dCoords } from '../../src/layout/index.js';
import { atomColor } from '../../src/layout/mol2d-helpers.js';

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

test('renderMolSVG does not mutate hidden stereo hydrogen coordinates while rendering', () => {
  const mol = parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O');
  generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5, maxPasses: 6 });
  mol.hideHydrogens();
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const [parent] = atom.getNeighbors(mol);
    atom.x = parent?.x ?? null;
    atom.y = parent?.y ?? null;
  }

  const before = [...mol.atoms.values()].filter(atom => atom.name === 'H' && atom.visible === false).map(atom => [atom.id, { x: atom.x, y: atom.y }]);
  const firstRender = renderMolSVG(mol);
  const afterFirstRender = [...mol.atoms.values()].filter(atom => atom.name === 'H' && atom.visible === false).map(atom => [atom.id, { x: atom.x, y: atom.y }]);
  const secondRender = renderMolSVG(mol);
  const afterSecondRender = [...mol.atoms.values()].filter(atom => atom.name === 'H' && atom.visible === false).map(atom => [atom.id, { x: atom.x, y: atom.y }]);

  assert.ok(firstRender, 'expected first SVG render output');
  assert.ok(secondRender, 'expected second SVG render output');
  assert.deepEqual(afterFirstRender, before);
  assert.deepEqual(afterSecondRender, before);
  assert.equal(secondRender.svgContent, firstRender.svgContent);
});
