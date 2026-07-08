import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/index.js';
import { pointInPolygon } from '../../src/layout/engine/geometry/polygon.js';
import { materializeMetalHydrideCoords, showMetalBoundHydrogens } from '../../src/layout/hydrogen-display.js';

function angleBetween(center, first, second) {
  const firstAngle = Math.atan2(first.y - center.y, first.x - center.x);
  const secondAngle = Math.atan2(second.y - center.y, second.x - center.x);
  const diff = Math.abs(firstAngle - secondAngle);
  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

test('materializeMetalHydrideCoords pulls stale far metal hydrogens back to the metal', () => {
  const mol = parseSMILES('[AlH]');
  const aluminum = mol.atoms.get('Al1');
  const hydrogen = mol.atoms.get('H2');
  aluminum.x = 12;
  aluminum.y = -4;
  hydrogen.x = 150;
  hydrogen.y = 90;

  showMetalBoundHydrogens(mol);
  const moved = materializeMetalHydrideCoords(mol, { bondLength: 1.5 });

  assert.equal(moved, 1);
  assert.equal(hydrogen.visible, true);
  assert.ok(Math.abs(Math.hypot(hydrogen.x - aluminum.x, hydrogen.y - aluminum.y) - 1.5) < 1e-9);
});

test('materializeMetalHydrideCoords expands compact force-round-tripped metal hydrogens', () => {
  const mol = parseSMILES('[AlH]');
  const aluminum = mol.atoms.get('Al1');
  const hydrogen = mol.atoms.get('H2');
  aluminum.x = 0;
  aluminum.y = 0;
  hydrogen.x = 0.244;
  hydrogen.y = 0;

  showMetalBoundHydrogens(mol);
  const moved = materializeMetalHydrideCoords(mol, { bondLength: 0.5 });

  assert.equal(moved, 1);
  assert.equal(hydrogen.visible, true);
  assert.ok(Math.abs(Math.hypot(hydrogen.x - aluminum.x, hydrogen.y - aluminum.y) - 0.5) < 1e-9);
});

test('materializeMetalHydrideCoords avoids a linear continuation from a single metal bond', () => {
  const mol = parseSMILES('[AlH]');
  const aluminum = mol.atoms.get('Al1');
  const hydrogen = mol.atoms.get('H2');
  const carbon = mol.addAtom('C3', 'C');
  aluminum.x = 0;
  aluminum.y = 0;
  hydrogen.x = 0;
  hydrogen.y = 0;
  carbon.x = 1.5;
  carbon.y = 0;
  mol.addBond('b-metal-carbon', aluminum.id, carbon.id, { order: 1 }, false);

  showMetalBoundHydrogens(mol);
  materializeMetalHydrideCoords(mol, { bondLength: 1.5 });

  const separation = angleBetween(aluminum, carbon, hydrogen);
  assert.ok(Math.abs(Math.PI - separation) > Math.PI / 9, `expected metal-H placement to avoid a straight C-Al-H line, got ${(separation * 180) / Math.PI} degrees`);
});

test('materializeMetalHydrideCoords avoids placing a metal hydrogen inside a nearby ring face', () => {
  const mol = parseSMILES('[AlH]');
  const aluminum = mol.atoms.get('Al1');
  const hydrogen = mol.atoms.get('H2');
  const carbon = mol.addAtom('C3', 'C');
  const ringAtoms = [
    mol.addAtom('R1', 'C'),
    mol.addAtom('R2', 'C'),
    mol.addAtom('R3', 'C'),
    mol.addAtom('R4', 'C')
  ];
  aluminum.x = 0;
  aluminum.y = -1.2;
  hydrogen.x = 0;
  hydrogen.y = -1.2;
  carbon.x = 0;
  carbon.y = -2.2;
  ringAtoms[0].x = -1;
  ringAtoms[0].y = -1;
  ringAtoms[1].x = 1;
  ringAtoms[1].y = -1;
  ringAtoms[2].x = 1;
  ringAtoms[2].y = 1;
  ringAtoms[3].x = -1;
  ringAtoms[3].y = 1;
  mol.addBond('b-metal-carbon', aluminum.id, carbon.id, { order: 1 }, false);
  for (let index = 0; index < ringAtoms.length; index++) {
    mol.addBond(`b-ring-${index}`, ringAtoms[index].id, ringAtoms[(index + 1) % ringAtoms.length].id, { order: 1 }, false);
  }

  showMetalBoundHydrogens(mol);
  materializeMetalHydrideCoords(mol, { bondLength: 1.5 });

  const ringPolygon = ringAtoms.map(atom => ({ x: atom.x, y: atom.y }));
  assert.equal(pointInPolygon({ x: hydrogen.x, y: hydrogen.y }, ringPolygon), false);
});
