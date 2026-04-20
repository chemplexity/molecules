import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Molecule } from '../../../src/core/index.js';
import { ensureLandscapeOrientation } from '../../../src/layout/engine/orientation.js';

function normalizeBondAngle(angle) {
  let normalized = angle % Math.PI;
  if (normalized < 0) {
    normalized += Math.PI;
  }
  return normalized;
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
});
