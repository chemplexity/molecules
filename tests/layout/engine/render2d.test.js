import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { applyCoords } from '../../../src/layout/engine/apply.js';
import { generateCoords } from '../../../src/layout/engine/api.js';
import { BOND_OFF, renderMolSVG, renderMolSVGFromSMILES } from '../../../src/layout/engine/render2d.js';

const RUN_LAYOUT_STRESS_TESTS = process.env.RUN_LAYOUT_STRESS === '1';
const stressIt = RUN_LAYOUT_STRESS_TESTS ? it : it.skip;

describe('layout/engine/render2d', () => {
  it('omits lone-pair circles by default', () => {
    const molecule = parseSMILES('CO');
    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 0);
  });

  it('keeps metal hydrogens as explicit single bonds', () => {
    const molecule = parseSMILES('[FeH]');
    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/<line /g) ?? []).length, 1);
    assert.doesNotMatch(rendered.svgContent, /FeH/);
    assert.match(rendered.svgContent, /<tspan>Fe<\/tspan>/);
    assert.match(rendered.svgContent, /<tspan>H<\/tspan>/);
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

  it('keeps charge badges black on styled atoms', () => {
    const molecule = parseSMILES('[NH4+]');
    molecule.atoms.get('N1').setStyle({ color: '#3366ff', opacity: 0.55 });

    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.match(rendered.svgContent, /<text [^>]*fill="#3366ff" opacity="0.55"[^>]*><tspan>NH<\/tspan><tspan baseline-shift="sub"[^>]*>4<\/tspan><\/text>/);
    assert.match(rendered.svgContent, /class="atom-charge-ring"[^>]+stroke="#111111"[^>]+opacity="0.55"/);
    assert.match(rendered.svgContent, /class="atom-charge-text"[^>]+fill="#111111"[^>]+opacity="0.55"[^>]*>\+<\/text>/);
  });

  it('renders custom bond and ring fill styles without implicit carbon atom markers', () => {
    const molecule = parseSMILES('c1ccccc1');
    molecule.atoms.get('C1').setStyle({ color: '#3366ff', opacity: 0.7 });
    const [bond] = molecule.bonds.values();
    bond.setStyle({ color: '#ff6633', opacity: 0.4 });
    molecule.setRingFill(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'], { color: '#ffe66d', opacity: 0.3 });

    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.match(rendered.svgContent, /class="ring-fill"[^>]+fill="#ffe66d"[^>]+fill-opacity="0.3"/);
    assert.match(rendered.svgContent, /data-ring-fill-id="ring-fill:C1\|C2\|C3\|C4\|C5\|C6"/);
    assert.equal(rendered.svgContent.includes('\0'), false);
    assert.match(rendered.svgContent, /stroke="#ff6633" stroke-opacity="0.4"/);
    assert.doesNotMatch(rendered.svgContent, /class="atom-style-marker"/);
    assert.ok(rendered.svgContent.indexOf('class="ring-fill"') < rendered.svgContent.indexOf('<line '), 'expected ring fill to render before bonds');
  });

  it('punches smaller fused ring faces out of larger ring fills', () => {
    const molecule = parseSMILES('CCOCC1=C2CC(C1)COC1OC2C=C1');
    const macroRingAtomIds = molecule.getRings().find(ringAtomIds => ringAtomIds.length === 8);
    molecule.setRingFill(macroRingAtomIds, { color: '#ffe66d', opacity: 0.3 });

    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    const pathMatch = /<path class="ring-fill"[^>]+d="([^"]+)"[^>]+fill-rule="evenodd"/.exec(rendered.svgContent);
    assert.ok(pathMatch, 'expected compound ring-fill path');
    assert.equal((pathMatch[1].match(/M /g) ?? []).length, 2);
    assert.doesNotMatch(rendered.svgContent, /<polygon class="ring-fill"/);
  });

  it('renders custom atom label opacity', () => {
    const molecule = parseSMILES('CO');
    molecule.atoms.get('O2').setStyle({ color: '#3366ff', opacity: 0.55 });

    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.match(rendered.svgContent, /<text [^>]*fill="#3366ff" opacity="0.55"[^>]*><tspan>(?:OH|HO)<\/tspan><\/text>/);
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

  it('centers terminal carbonyl double-bond strokes around the atom axis', () => {
    const molecule = parseSMILES('CC(=O)C');
    const carbonylBond = [...molecule.bonds.values()].find(bond => {
      if ((bond.properties.order ?? 1) !== 2) {
        return false;
      }
      const [firstAtom, secondAtom] = bond.getAtomObjects(molecule);
      return firstAtom.name === 'O' || secondAtom.name === 'O';
    });
    assert.ok(carbonylBond, 'expected acetone carbonyl bond');

    const [firstAtom, secondAtom] = carbonylBond.getAtomObjects(molecule);
    const carbonylCarbon = firstAtom.name === 'C' ? firstAtom : secondAtom;
    const carbonylOxygen = firstAtom.name === 'O' ? firstAtom : secondAtom;
    const sideCarbons = carbonylCarbon.getNeighbors(molecule).filter(atom => atom.name === 'C');
    assert.equal(sideCarbons.length, 2);

    const coords = new Map([
      [carbonylCarbon.id, { x: 0, y: 0 }],
      [carbonylOxygen.id, { x: 0, y: 1.5 }],
      [sideCarbons[0].id, { x: -1.299038106, y: -0.75 }],
      [sideCarbons[1].id, { x: 1.299038106, y: -0.75 }]
    ]);
    const rendered = renderMolSVG(molecule, { coords });
    assert.ok(rendered, 'expected SVG render output');

    const verticalLines = [...rendered.svgContent.matchAll(/<line x1="([0-9.-]+)" y1="([0-9.-]+)" x2="([0-9.-]+)" y2="([0-9.-]+)"/g)]
      .map(([, x1, y1, x2, y2]) => ({
        x1: Number.parseFloat(x1),
        y1: Number.parseFloat(y1),
        x2: Number.parseFloat(x2),
        y2: Number.parseFloat(y2)
      }))
      .filter(line => Math.abs(line.x1 - line.x2) < 0.05 && Math.abs(line.y2 - line.y1) > 20);

    assert.equal(verticalLines.length, 2, 'expected the terminal carbonyl to render as two vertical strokes');
    const lineXs = verticalLines.map(line => (line.x1 + line.x2) / 2).sort((a, b) => a - b);
    const strokeMidpoint = (lineXs[0] + lineXs[1]) / 2;
    const carbonylAxisX = rendered.cellW / 2;
    assert.ok(Math.abs(strokeMidpoint - carbonylAxisX) < 0.1, `expected carbonyl stroke pair centered on axis ${carbonylAxisX}, got ${strokeMidpoint}`);
    assert.ok(Math.abs(lineXs[1] - lineXs[0] - BOND_OFF) < 0.1, `expected centered stroke spacing ${BOND_OFF}, got ${lineXs[1] - lineXs[0]}`);
  });

  it('renders rough bridged fallback layouts instead of dropping the molecule entirely', () => {
    const smiles = 'OCC[C@H]1C[C@H](O)[C@@H](O)[C@@]2(Cc3ccccc3CCO2)O1';
    const layoutResult = generateCoords(parseSMILES(smiles));
    const rendered = renderMolSVGFromSMILES(smiles);

    assert.equal(layoutResult.metadata.stage, 'coordinates-ready');
    assert.ok(rendered, 'expected a rough bridged fallback render');
    assert.match(rendered.svgContent, /<line /);
  });

  stressIt('renders partial mixed-family layouts when a secondary ring system cannot be fully placed', () => {
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

  it('trims bond endpoints so visible nitrogen labels are not stroked through', () => {
    const rendered = renderMolSVGFromSMILES('CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C');

    assert.ok(rendered, 'expected SVG render output');

    const textMatches = [...rendered.svgContent.matchAll(/<text x="([0-9.-]+)" y="([0-9.-]+)"[^>]*><tspan>N<\/tspan><\/text>/g)];
    const lineMatches = [...rendered.svgContent.matchAll(/<line x1="([0-9.-]+)" y1="([0-9.-]+)" x2="([0-9.-]+)" y2="([0-9.-]+)"/g)];

    assert.ok(textMatches.length > 0, 'expected at least one visible N label');
    assert.ok(lineMatches.length > 0, 'expected line segments in the rendered SVG');

    for (const [, xText, yText] of textMatches) {
      const tx = Number.parseFloat(xText);
      const ty = Number.parseFloat(yText);
      const hasEndpointAtCenter = lineMatches.some(([, x1, y1, x2, y2]) => {
        const endpoints = [
          [Number.parseFloat(x1), Number.parseFloat(y1)],
          [Number.parseFloat(x2), Number.parseFloat(y2)]
        ];
        return endpoints.some(([x, y]) => Math.abs(x - tx) < 0.05 && Math.abs(y - ty) < 0.05);
      });
      assert.equal(hasEndpointAtCenter, false, `expected no bond endpoint to terminate at visible N label center ${tx},${ty}`);
    }
  });

  it('trims bonds farther from subscripted NH2 labels', () => {
    const molecule = parseSMILES('C[NH2+]');
    const coords = new Map();
    for (const atom of molecule.atoms.values()) {
      if (atom.name === 'N') {
        coords.set(atom.id, { x: 0, y: 0 });
      }
      if (atom.name === 'C') {
        coords.set(atom.id, { x: 0, y: -1.5 });
      }
    }

    const rendered = renderMolSVG(molecule, { coords });
    const lineMatch = rendered.svgContent.match(/<line x1="([0-9.-]+)" y1="([0-9.-]+)" x2="([0-9.-]+)" y2="([0-9.-]+)"/);
    const textMatch = rendered.svgContent.match(/<text x="([0-9.-]+)" y="([0-9.-]+)"[^>]*><tspan>NH<\/tspan><tspan[^>]*>2<\/tspan><\/text>/);

    assert.ok(lineMatch, 'expected rendered bond line');
    assert.ok(textMatch, 'expected rendered NH2 label');
    assert.ok(
      Number.parseFloat(lineMatch[4]) - Number.parseFloat(textMatch[2]) >= 10.5,
      `expected bond endpoint to clear the subscripted NH2 label, got endpoint y ${lineMatch[4]} vs text y ${textMatch[2]}`
    );
  });
});
