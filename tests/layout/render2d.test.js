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

test('renderMolSVG trims bonds farther from subscripted NH2 labels', () => {
  const mol = parseSMILES('C[NH2+]');
  for (const atom of mol.atoms.values()) {
    if (atom.name === 'N') {
      atom.x = 0;
      atom.y = 0;
    }
    if (atom.name === 'C') {
      atom.x = 0;
      atom.y = -1.5;
    }
  }

  const rendered = renderMolSVG(mol, { skipLayout: true });
  const lineMatch = rendered.svgContent.match(/<line x1="([0-9.-]+)" y1="([0-9.-]+)" x2="([0-9.-]+)" y2="([0-9.-]+)"/);
  const textMatch = rendered.svgContent.match(/<text x="([0-9.-]+)" y="([0-9.-]+)"[^>]*><tspan>NH<\/tspan><tspan[^>]*>2<\/tspan><\/text>/);

  assert.ok(lineMatch, 'expected rendered bond line');
  assert.ok(textMatch, 'expected rendered NH2 label');
  assert.ok(
    Number.parseFloat(lineMatch[4]) - Number.parseFloat(textMatch[2]) >= 10.5,
    `expected bond endpoint to clear the subscripted NH2 label, got endpoint y ${lineMatch[4]} vs text y ${textMatch[2]}`
  );
});
