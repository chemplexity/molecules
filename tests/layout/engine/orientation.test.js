import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Molecule } from '../../../src/core/index.js';
import { parseSMILES } from '../../../src/io/index.js';
import { ensureLandscapeOrientation } from '../../../src/layout/engine/orientation.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';

function normalizeBondAngle(angle) {
  let normalized = angle % Math.PI;
  if (normalized < 0) {
    normalized += Math.PI;
  }
  return normalized;
}

function countHorizontalRingBonds(coords, molecule) {
  const seenBondIds = new Set();
  let horizontalCount = 0;

  for (const ring of molecule.getRings()) {
    for (let index = 0; index < ring.length; index++) {
      const firstAtomId = ring[index];
      const secondAtomId = ring[(index + 1) % ring.length];
      const bond = molecule.getBond(firstAtomId, secondAtomId);
      if (!bond || seenBondIds.has(bond.id)) {
        continue;
      }
      seenBondIds.add(bond.id);

      const first = coords.get(firstAtomId);
      const second = coords.get(secondAtomId);
      if (first && second && Math.abs(second.y - first.y) < 1e-6) {
        horizontalCount++;
      }
    }
  }

  return horizontalCount;
}

function principalAxisDegrees(coords, molecule) {
  const heavyAtomIds = [...molecule.atoms.keys()].filter(atomId => molecule.atoms.get(atomId)?.name !== 'H');
  let sumX = 0;
  let sumY = 0;
  for (const atomId of heavyAtomIds) {
    const point = coords.get(atomId);
    sumX += point.x;
    sumY += point.y;
  }
  const centerX = sumX / heavyAtomIds.length;
  const centerY = sumY / heavyAtomIds.length;

  let inertiaXX = 0;
  let inertiaYY = 0;
  let inertiaXY = 0;
  for (const atomId of heavyAtomIds) {
    const point = coords.get(atomId);
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    inertiaXX += dy * dy;
    inertiaYY += dx * dx;
    inertiaXY -= dx * dy;
  }

  const angle0 = 0.5 * Math.atan2(2 * inertiaXY, inertiaXX - inertiaYY);
  const inertia0 = inertiaXX * Math.cos(angle0) ** 2 + inertiaYY * Math.sin(angle0) ** 2 + inertiaXY * Math.sin(2 * angle0);
  const inertia1 = inertiaXX + inertiaYY - inertia0;
  let axis = inertia0 <= inertia1 ? angle0 : angle0 + Math.PI / 2;
  if (axis > Math.PI / 2) {
    axis -= Math.PI;
  }
  if (axis <= -Math.PI / 2) {
    axis += Math.PI;
  }
  return (axis * 180) / Math.PI;
}

describe('layout/engine/orientation', () => {
  it('levels an already-landscape tilted long chain onto a horizontal backbone', () => {
    const molecule = new Molecule();
    for (let index = 0; index < 8; index++) {
      molecule.addAtom(`a${index}`, 'C');
    }
    for (let index = 0; index < 7; index++) {
      molecule.addBond(`b${index}`, `a${index}`, `a${index + 1}`, {}, false);
    }

    const tilt = (20 * Math.PI) / 180;
    const coords = new Map();
    for (let index = 0; index < 8; index++) {
      coords.set(`a${index}`, {
        x: index * Math.cos(tilt),
        y: index * Math.sin(tilt)
      });
    }

    const applied = ensureLandscapeOrientation(coords, molecule);
    const ys = [...coords.values()].map(position => position.y);

    assert.equal(applied, true);
    assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-6);
  });

  it('levels tilted rings onto an exact ring-friendly bond lattice', () => {
    const molecule = new Molecule();
    for (let index = 0; index < 6; index++) {
      molecule.addAtom(`a${index}`, 'C');
    }
    for (let index = 0; index < 6; index++) {
      molecule.addBond(`b${index}`, `a${index}`, `a${(index + 1) % 6}`, {}, false);
    }

    const tilt = (20 * Math.PI) / 180;
    const radius = 1.5;
    const coords = new Map();
    for (let index = 0; index < 6; index++) {
      const angle = tilt + (index * Math.PI) / 3;
      coords.set(`a${index}`, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle)
      });
    }

    const applied = ensureLandscapeOrientation(coords, molecule);
    const bondAngles = [];
    for (let index = 0; index < 6; index++) {
      const first = coords.get(`a${index}`);
      const second = coords.get(`a${(index + 1) % 6}`);
      bondAngles.push(normalizeBondAngle(Math.atan2(second.y - first.y, second.x - first.x)));
    }

    assert.equal(applied, true);
    assert.ok(
      bondAngles.every(angle => Math.abs(angle - ((Math.PI / 6) * Math.round(angle / (Math.PI / 6)))) < 1e-6),
      `expected ring bonds to land on the 30-degree lattice, got ${bondAngles.map(angle => ((angle * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
  });

  it('levels short mixed ring-linked zigzag connectors onto a horizontal axis when they are the clearest readable backbone', () => {
    const result = runPipeline(parseSMILES('NC(CC1=CNC=N1)C(O)=O'), {
      suppressH: true,
      finalLandscapeOrientation: true
    });
    const left = result.coords.get('C3');
    const right = result.coords.get('C9');

    assert.notEqual(left, undefined);
    assert.notEqual(right, undefined);
    assert.ok(
      Math.abs(right.y - left.y) < 1e-6,
      `expected the mixed zigzag axis to be level, got endpoint tilt ${Math.abs(right.y - left.y).toFixed(6)}`
    );
  });

  it('does not let a short tail outrank the main ring slab when leveling a large mixed scaffold', () => {
    const molecule = parseSMILES('CS(=O)(=O)Nc1cc(Nc2nccc(Nc3c(Cl)ccc4OCOc34)n2)cc(c1)C(=O)N');
    const result = runPipeline(molecule, {
      suppressH: true,
      finalLandscapeOrientation: true
    });

    assert.ok(
      countHorizontalRingBonds(result.coords, molecule) >= 3,
      `expected the leveled ring-rich scaffold to keep multiple horizontal ring bonds, got ${countHorizontalRingBonds(result.coords, molecule)}`
    );
  });

  it('keeps large ring-rich slabs close to horizontal instead of finishing on a diagonal compromise', () => {
    const molecule = parseSMILES('CC1=NC(NC2=NC=C(S2)C(=O)NC2=C(C)C=CC=C2Cl)=CC(=N1)N1CCN(CCO)CC1');
    const result = runPipeline(molecule, {
      suppressH: true,
      finalLandscapeOrientation: true
    });

    assert.ok(
      Math.abs(principalAxisDegrees(result.coords, molecule)) <= 15,
      `expected the leveled slab to stay near horizontal, got principal axis ${principalAxisDegrees(result.coords, molecule).toFixed(2)} degrees`
    );
  });

  it('keeps long chain-dominant mixed backbones level through the final bond-grid snap', () => {
    const molecule = parseSMILES('CCCCCCCC1N(CC)C=CN1C(C)C');
    const result = runPipeline(molecule, {
      suppressH: true,
      finalLandscapeOrientation: true
    });
    const start = result.coords.get('C1');
    const end = result.coords.get('C7');

    assert.notEqual(start, undefined);
    assert.notEqual(end, undefined);
    assert.ok(
      Math.abs(end.y - start.y) < 1e-6,
      `expected the long chain backbone to stay level, got tilt ${Math.abs(end.y - start.y).toFixed(6)}`
    );
  });
});
