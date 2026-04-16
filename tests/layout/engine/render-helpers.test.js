import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { applyCoords } from '../../../src/layout/engine/apply.js';
import { generateCoords } from '../../../src/layout/engine/api.js';
import { atomColor, formatChargeLabel, kekulize, ringLabelOffset } from '../../../src/layout/engine/render-helpers.js';

describe('layout/engine/render-helpers', () => {
  it('uses the subdued metallic palette for selected metals', () => {
    assert.equal(atomColor('Mg'), '#5E636B');
    assert.equal(atomColor('Ag'), '#C0C0C0');
    assert.equal(atomColor('Au'), '#D4AF37');
    assert.equal(atomColor('Pt'), '#C9CDD2');
    assert.equal(atomColor('Hg'), '#B8C3CF');
  });

  it('formats positive and negative charge labels for display', () => {
    assert.equal(formatChargeLabel(0), '');
    assert.equal(formatChargeLabel(1), '+');
    assert.equal(formatChargeLabel(2), '2+');
    assert.equal(formatChargeLabel(-1), '−');
    assert.equal(formatChargeLabel(-2), '2−');
  });

  it('localizes fluorene aromatic bonds without turning the bridge into an exocyclic double', () => {
    const molecule = parseSMILES('c1ccc2c(c1)Cc1ccccc1-2');
    kekulize(molecule);

    const bridgeBond = [...molecule.bonds.values()].find(bond => {
      const atomIds = [...bond.atoms].sort();
      return atomIds[0] === 'C13' && atomIds[1] === 'C4';
    });
    assert.ok(bridgeBond, 'expected fluorene bridge bond');
    assert.equal(bridgeBond.properties.order, 1);
    assert.equal(bridgeBond.properties.aromatic ?? false, false);

    const localizedDoubleCount = [...molecule.bonds.values()].filter(bond => (bond.properties.aromatic ?? false) && bond.properties.localizedOrder === 2).length;
    assert.equal(localizedDoubleCount, 6);
  });

  it('pushes terminal carbonyl hetero labels outward along the bond axis', () => {
    const molecule = parseSMILES('CC=O');
    const layoutResult = generateCoords(molecule, { suppressH: true });
    applyCoords(molecule, layoutResult, { clearUnplaced: true });
    const oxygen = molecule.atoms.get('O3');
    const carbon = molecule.atoms.get('C2');
    const offset = ringLabelOffset(oxygen, molecule, atom => ({ x: atom.x, y: atom.y }), 'O', 11);
    const axis = { x: oxygen.x - carbon.x, y: oxygen.y - carbon.y };
    const dot = offset.dx * axis.x + offset.dy * axis.y;

    assert.ok(dot > 0, 'expected carbonyl oxygen label offset to point outward from the carbonyl carbon');
    assert.ok(Math.hypot(offset.dx, offset.dy) > 3, 'expected a meaningful outward nudge for carbonyl oxygen labels');
  });

  it('keeps ordinary ring nitrogens centered when the ring face has enough room', () => {
    const molecule = parseSMILES('n1ccccc1');
    const layoutResult = generateCoords(molecule, { suppressH: true });
    applyCoords(molecule, layoutResult, { clearUnplaced: true });
    const nitrogen = molecule.atoms.get('N1');
    const offset = ringLabelOffset(nitrogen, molecule, atom => ({ x: atom.x * 46, y: atom.y * 46 }), 'N', 11);

    assert.ok(Math.hypot(offset.dx, offset.dy) < 0.5, `expected pyridine nitrogen to remain centered, got ${JSON.stringify(offset)}`);
  });

  it('keeps ordinary ring oxygen and sulfur labels centered when the ring face has enough room', () => {
    const molecule = parseSMILES('o1cccc1.s1cccc1');
    const layoutResult = generateCoords(molecule, { suppressH: true });
    applyCoords(molecule, layoutResult, { clearUnplaced: true });
    const oxygen = molecule.atoms.get('O1');
    const sulfur = molecule.atoms.get('S6');
    const oxygenOffset = ringLabelOffset(oxygen, molecule, atom => ({ x: atom.x * 46, y: atom.y * 46 }), 'O', 11);
    const sulfurOffset = ringLabelOffset(sulfur, molecule, atom => ({ x: atom.x * 46, y: atom.y * 46 }), 'S', 11);

    assert.ok(Math.hypot(oxygenOffset.dx, oxygenOffset.dy) < 0.5, `expected furan oxygen to remain centered, got ${JSON.stringify(oxygenOffset)}`);
    assert.ok(Math.hypot(sulfurOffset.dx, sulfurOffset.dy) < 0.5, `expected thiophene sulfur to remain centered, got ${JSON.stringify(sulfurOffset)}`);
  });
});
