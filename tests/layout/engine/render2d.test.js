import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { applyCoords } from '../../../src/layout/engine/apply.js';
import { generateCoords } from '../../../src/layout/engine/api.js';
import { renderMolSVG, renderMolSVGFromSMILES } from '../../../src/layout/engine/render2d.js';

describe('layout/engine/render2d', () => {
  it('omits lone-pair circles by default', () => {
    const molecule = parseSMILES('CO');
    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 0);
  });

  it('emits lone-pair circles when enabled', () => {
    const molecule = parseSMILES('CO');
    const rendered = renderMolSVG(molecule, { showLonePairs: true });

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 4);
  });

  it('shows a lone pair for aromatic [nH] when enabled', () => {
    const molecule = parseSMILES('c1ccc2[nH]ccc2c1');
    const rendered = renderMolSVG(molecule, { showLonePairs: true });

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 2);
  });

  it('wraps charge labels in a thin outlined circle', () => {
    const molecule = parseSMILES('[NH4+]');
    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="atom-charge-ring"/g) ?? []).length, 1);
    assert.equal((rendered.svgContent.match(/class="atom-charge-text"/g) ?? []).length, 1);
    assert.match(rendered.svgContent, />\+<\/text>/);
  });

  it('accepts a precomputed layout result', () => {
    const molecule = parseSMILES('c1ccccc1');
    const layoutResult = generateCoords(molecule);
    const rendered = renderMolSVG(molecule, { layoutResult });

    assert.ok(rendered, 'expected SVG render output');
    assert.match(rendered.svgContent, /<line /);
  });

  it('renders directly from SMILES convenience wrapper', () => {
    const rendered = renderMolSVGFromSMILES('CCO');

    assert.ok(rendered, 'expected SVG render output');
    assert.match(rendered.svgContent, /<rect /);
  });

  it('renders rough bridged fallback layouts instead of dropping the molecule entirely', () => {
    const smiles = 'OCC[C@H]1C[C@H](O)[C@@H](O)[C@@]2(Cc3ccccc3CCO2)O1';
    const layoutResult = generateCoords(parseSMILES(smiles));
    const rendered = renderMolSVGFromSMILES(smiles);

    assert.equal(layoutResult.metadata.stage, 'coordinates-ready');
    assert.ok(rendered, 'expected a rough bridged fallback render');
    assert.match(rendered.svgContent, /<line /);
  });

  it('renders partial mixed-family layouts when a secondary ring system cannot be fully placed', () => {
    const smiles =
      'CC[C@H](C)[C@@H]1O[C@]2(CC[C@@H]1C)C[C@H]3C[C@H](C\\C=C(/C)\\[C@@H](O[C@H]4C[C@H](OC)[C@H](O[C@H]5C[C@H](OC)[C@H](O)[C@H](C)O5)[C@H](C)O4)[C@@H](C)\\C=C\\C=C6CO[C@@H]7[C@@H](O)C(=C[C@H](C(=O)O3)[C@@]67O)C)O2';
    const layoutResult = generateCoords(parseSMILES(smiles), { suppressH: true });
    const rendered = renderMolSVGFromSMILES(smiles);

    assert.equal(layoutResult.metadata.stage, 'partial-coordinates');
    assert.ok(layoutResult.coords.size > 0, 'expected partial coordinates to be preserved');
    assert.ok(rendered, 'expected a partial render instead of null');
    assert.match(rendered.svgContent, /<line /);
  });

  it('does not mutate hidden stereo hydrogen coordinates while rendering', () => {
    const molecule = parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O');
    const layoutResult = generateCoords(molecule);
    applyCoords(molecule, layoutResult, {
      clearUnplaced: true,
      hiddenHydrogenMode: 'coincident',
      syncStereoDisplay: true
    });
    molecule.hideHydrogens();
    const before = [...molecule.atoms.values()].filter(atom => atom.name === 'H').map(atom => [atom.id, { x: atom.x, y: atom.y }]);
    const firstRender = renderMolSVG(molecule, { layoutResult });
    const afterFirstRender = [...molecule.atoms.values()].filter(atom => atom.name === 'H').map(atom => [atom.id, { x: atom.x, y: atom.y }]);
    const secondRender = renderMolSVG(molecule, { layoutResult });
    const afterSecondRender = [...molecule.atoms.values()].filter(atom => atom.name === 'H').map(atom => [atom.id, { x: atom.x, y: atom.y }]);

    assert.ok(firstRender, 'expected first SVG render output');
    assert.ok(secondRender, 'expected second SVG render output');
    assert.deepEqual(afterFirstRender, before);
    assert.deepEqual(afterSecondRender, before);
    assert.equal(secondRender.svgContent, firstRender.svgContent);
  });
});
