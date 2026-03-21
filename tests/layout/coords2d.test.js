import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { generateCoords } from '../../src/layout/index.js';
import { getAtomLabel } from '../../src/layout/mol2d-helpers.js';
import { refineExistingCoords } from '../../src/layout/coords2d.js';
import { parseINCHI } from '../../src/io/inchi.js';
import { parseSMILES } from '../../src/io/smiles.js';

// ---------------------------------------------------------------------------
// Molecule factories (all built without implicit hydrogens)
// ---------------------------------------------------------------------------

function singleAtom() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  return mol;
}

function ethane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addBond('b0', 'a0', 'a1', {}, false);
  return mol;
}

function propane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addBond('b0', 'a0', 'a1', {}, false);
  mol.addBond('b1', 'a1', 'a2', {}, false);
  return mol;
}

function isobutane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');  // centre
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addAtom('a3', 'C');
  mol.addBond('b0', 'a0', 'a1', {}, false);
  mol.addBond('b1', 'a0', 'a2', {}, false);
  mol.addBond('b2', 'a0', 'a3', {}, false);
  return mol;
}

function linearChain(n) {
  const mol = new Molecule();
  for (let i = 0; i < n; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  for (let i = 0; i < n - 1; i++) {
    mol.addBond(`b${i}`, `a${i}`, `a${i + 1}`, {}, false);
  }
  return mol;
}

function benzene() {
  const mol = new Molecule();
  for (let i = 0; i < 6; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  for (let i = 0; i < 6; i++) {
    mol.addBond(`b${i}`, `a${i}`, `a${(i + 1) % 6}`, { aromatic: true }, false);
  }
  return mol;
}

function cyclohexane() {
  const mol = new Molecule();
  for (let i = 0; i < 6; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  for (let i = 0; i < 6; i++) {
    mol.addBond(`b${i}`, `a${i}`, `a${(i + 1) % 6}`, {}, false);
  }
  return mol;
}

/**
 * Naphthalene skeleton: 10 C atoms, 11 bonds (two fused 6-rings sharing a bond).
 * Connectivity: 0-1-2-3-4-5-0 (ring A) and 5-6-7-8-9-4 + 4-5 (ring B shares bond 4-5).
 */
function naphthalene() {
  const mol = new Molecule();
  for (let i = 0; i < 10; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  // Ring A: 0-1-2-3-4-5-0
  mol.addBond('b0',  'a0', 'a1', {}, false);
  mol.addBond('b1',  'a1', 'a2', {}, false);
  mol.addBond('b2',  'a2', 'a3', {}, false);
  mol.addBond('b3',  'a3', 'a4', {}, false);
  mol.addBond('b4',  'a4', 'a5', {}, false);
  mol.addBond('b5',  'a5', 'a0', {}, false);
  // Ring B: 4-6-7-8-9-5-4
  mol.addBond('b6',  'a4', 'a6', {}, false);
  mol.addBond('b7',  'a6', 'a7', {}, false);
  mol.addBond('b8',  'a7', 'a8', {}, false);
  mol.addBond('b9',  'a8', 'a9', {}, false);
  mol.addBond('b10', 'a9', 'a5', {}, false);
  return mol;
}

/** Two 5-membered rings sharing exactly one atom (spiro carbon). */
function spiro() {
  const mol = new Molecule();
  for (let i = 0; i < 9; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  // Ring A: 0-1-2-3-4-0
  mol.addBond('b0', 'a0', 'a1', {}, false);
  mol.addBond('b1', 'a1', 'a2', {}, false);
  mol.addBond('b2', 'a2', 'a3', {}, false);
  mol.addBond('b3', 'a3', 'a4', {}, false);
  mol.addBond('b4', 'a4', 'a0', {}, false);
  // Ring B: 4-5-6-7-8-4  (a4 = spiro atom)
  mol.addBond('b5', 'a4', 'a5', {}, false);
  mol.addBond('b6', 'a5', 'a6', {}, false);
  mol.addBond('b7', 'a6', 'a7', {}, false);
  mol.addBond('b8', 'a7', 'a8', {}, false);
  mol.addBond('b9', 'a8', 'a4', {}, false);
  return mol;
}

/** Benzene with one methyl substituent (toluene skeleton, heavy atoms only). */
function methylbenzene() {
  const mol = benzene();
  mol.addAtom('a6', 'C');  // methyl carbon
  mol.addBond('b6', 'a0', 'a6', {}, false);
  return mol;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bondLengthOf(mol, bond) {
  const a = mol.atoms.get(bond.atoms[0]);
  const b = mol.atoms.get(bond.atoms[1]);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function heavyDistanceSignature(mol) {
  const heavyIds = [...mol.atoms.keys()].filter(id => mol.atoms.get(id)?.name !== 'H');
  const distances = [];
  for (let i = 0; i < heavyIds.length; i++) {
    for (let j = i + 1; j < heavyIds.length; j++) {
      const a = mol.atoms.get(heavyIds[i]);
      const b = mol.atoms.get(heavyIds[j]);
      distances.push(Math.hypot(a.x - b.x, a.y - b.y).toFixed(3));
    }
  }
  distances.sort();
  return distances.join(',');
}

function pointToSegmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-12) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const px = a.x + t * abx;
  const py = a.y + t * aby;
  return Math.hypot(p.x - px, p.y - py);
}

function angleDeg(a, b, c) {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const dot = ux * vx + uy * vy;
  const mu = Math.hypot(ux, uy);
  const mv = Math.hypot(vx, vy);
  const cos = dot / (mu * mv);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

function approx(actual, expected, tol = 1e-6) {
  return Math.abs(actual - expected) <= tol;
}

function preferredBackbonePath(mol) {
  const heavyIds = [...mol.atoms.keys()].filter(id => mol.atoms.get(id)?.name !== 'H');
  const ringAtoms = new Set(mol.getRings().flat());
  let best = null;

  function shortestPath(startId, endId) {
    const prev = new Map([[startId, null]]);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === endId) {
        break;
      }
      for (const nb of mol.getNeighbors(cur)) {
        if (mol.atoms.get(nb)?.name === 'H' || prev.has(nb)) {
          continue;
        }
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
    if (!prev.has(endId)) {
      return null;
    }
    const path = [];
    for (let cur = endId; cur != null; cur = prev.get(cur)) {
      path.push(cur);
    }
    return path.reverse();
  }

  for (let i = 0; i < heavyIds.length; i++) {
    for (let j = i + 1; j < heavyIds.length; j++) {
      const path = shortestPath(heavyIds[i], heavyIds[j]);
      if (!path) {
        continue;
      }
      const ringCount = path.filter(id => ringAtoms.has(id)).length;
      const score = path.length - ringCount * 0.6;
      if (!best ||
          score > best.score ||
          (score === best.score && ringCount < best.ringCount) ||
          (score === best.score && ringCount === best.ringCount && path.length > best.path.length)) {
        best = { path, ringCount, score };
      }
    }
  }

  return best?.path ?? [];
}

// ---------------------------------------------------------------------------
// Coordinate assignment
// ---------------------------------------------------------------------------

describe('generateCoords — coordinate assignment', () => {
  it('single atom gets coordinates', () => {
    const mol = singleAtom();
    generateCoords(mol);
    const atom = mol.atoms.get('a0');
    assert.equal(typeof atom.x, 'number');
    assert.equal(typeof atom.y, 'number');
    assert.ok(!isNaN(atom.x));
    assert.ok(!isNaN(atom.y));
  });

  it('single atom is placed at origin', () => {
    const mol = singleAtom();
    generateCoords(mol);
    const atom = mol.atoms.get('a0');
    assert.equal(atom.x, 0);
    assert.equal(atom.y, 0);
  });

  it('all atoms in propane receive x and y', () => {
    const mol = propane();
    generateCoords(mol);
    for (const atom of mol.atoms.values()) {
      assert.equal(typeof atom.x, 'number');
      assert.equal(typeof atom.y, 'number');
      assert.ok(!isNaN(atom.x));
    }
  });

  it('returns a Map with size === atomCount', () => {
    const mol = benzene();
    const result = generateCoords(mol);
    assert.ok(result instanceof Map);
    assert.equal(result.size, mol.atomCount);
  });

  it('coordinates in returned map match atom.properties', () => {
    const mol = propane();
    const result = generateCoords(mol);
    for (const [atomId, coord] of result) {
      const atom = mol.atoms.get(atomId);
      assert.equal(atom.x, coord.x);
      assert.equal(atom.y, coord.y);
    }
  });

  it('empty molecule returns empty Map', () => {
    const mol = new Molecule();
    const result = generateCoords(mol);
    assert.equal(result.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Bond length invariant
// ---------------------------------------------------------------------------

describe('generateCoords — bond length', () => {
  it('ethane: bond length equals default 1.5', () => {
    const mol = ethane();
    generateCoords(mol);
    const [bond] = mol.bonds.values();
    assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
  });

  it('propane: all bonds have length 1.5', () => {
    const mol = propane();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });

  it('linear chain of 6: all bonds have length 1.5', () => {
    const mol = linearChain(6);
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });

  it('custom bondLength=2.0 is respected for ethane', () => {
    const mol = ethane();
    generateCoords(mol, { bondLength: 2.0 });
    const [bond] = mol.bonds.values();
    assert.ok(Math.abs(bondLengthOf(mol, bond) - 2.0) < 1e-9);
  });

  it('custom bondLength=1.0 is respected for benzene', () => {
    const mol = benzene();
    generateCoords(mol, { bondLength: 1.0 });
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.0) < 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// Ring geometry
// ---------------------------------------------------------------------------

describe('generateCoords — benzene ring geometry', () => {
  it('all 6 C atoms are equidistant from the centroid', () => {
    const mol = benzene();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 6;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 6;
    const radii = atoms.map(a => Math.hypot(a.x - cx, a.y - cy));
    const r0 = radii[0];
    for (const r of radii) {
      assert.ok(Math.abs(r - r0) < 1e-9, `radius ${r} !== ${r0}`);
    }
  });

  it('all 6 bonds have length 1.5', () => {
    const mol = benzene();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });

  it('no two atoms occupy the same position', () => {
    const mol = benzene();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(
          atoms[i].x - atoms[j].x,
          atoms[i].y - atoms[j].y
        );
        assert.ok(d > 0.1, `atoms ${i} and ${j} overlap (d=${d})`);
      }
    }
  });
});

describe('generateCoords — cyclohexane ring geometry', () => {
  it('6 bonds have length 1.5', () => {
    const mol = cyclohexane();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });

  it('all atoms equidistant from centroid', () => {
    const mol = cyclohexane();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 6;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 6;
    const radii = atoms.map(a => Math.hypot(a.x - cx, a.y - cy));
    const r0 = radii[0];
    for (const r of radii) {
      assert.ok(Math.abs(r - r0) < 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// Chain bond angles
// ---------------------------------------------------------------------------

describe('generateCoords — chain angles', () => {
  it('propane: bond angle at middle carbon is ~120°', () => {
    const mol = propane();
    generateCoords(mol);
    const a0 = mol.atoms.get('a0');
    const a1 = mol.atoms.get('a1');
    const a2 = mol.atoms.get('a2');
    const v1 = { x: a0.x - a1.x, y: a0.y - a1.y };
    const v2 = { x: a2.x - a1.x, y: a2.y - a1.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) /
                (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    assert.ok(Math.abs(angleDeg - 120) < 1, `bond angle ${angleDeg.toFixed(2)}° != 120°`);
  });

  it('isobutane: central carbon has 3 neighbors at 120° each', () => {
    const mol = isobutane();
    generateCoords(mol);
    const centre = mol.atoms.get('a0');
    const children = ['a1', 'a2', 'a3'].map(id => mol.atoms.get(id));
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const ci = children[i], cj = children[j];
        const v1 = { x: ci.x - centre.x, y: ci.y - centre.y };
        const v2 = { x: cj.x - centre.x, y: cj.y - centre.y };
        const cos = (v1.x * v2.x + v1.y * v2.y) /
                    (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
        const angleDeg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
        assert.ok(Math.abs(angleDeg - 120) < 1, `angle ${i}-${j}: ${angleDeg.toFixed(2)}° != 120°`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Fused ring systems
// ---------------------------------------------------------------------------

describe('generateCoords — naphthalene (fused bicyclic)', () => {
  it('all 11 bonds have length 1.5', () => {
    const mol = naphthalene();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      const d = bondLengthOf(mol, bond);
      assert.ok(Math.abs(d - 1.5) < 1e-9, `bond ${bond.id} length ${d}`);
    }
  });

  it('no two atoms overlap', () => {
    const mol = naphthalene();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(
          atoms[i].x - atoms[j].x,
          atoms[i].y - atoms[j].y
        );
        assert.ok(d > 0.5, `atoms ${i} and ${j} overlap (d=${d.toFixed(4)})`);
      }
    }
  });

  it('all 10 atoms have finite coordinates', () => {
    const mol = naphthalene();
    generateCoords(mol);
    for (const atom of mol.atoms.values()) {
      assert.ok(isFinite(atom.x));
      assert.ok(isFinite(atom.y));
    }
  });
});

// ---------------------------------------------------------------------------
// Spiro rings
// ---------------------------------------------------------------------------

describe('generateCoords — spiro bicyclic', () => {
  it('all 9 atoms receive finite coordinates', () => {
    const mol = spiro();
    generateCoords(mol);
    for (const atom of mol.atoms.values()) {
      assert.ok(isFinite(atom.x), `${atom.id} x is not finite`);
      assert.ok(isFinite(atom.y), `${atom.id} y is not finite`);
    }
  });

  it('all bonds have length 1.5', () => {
    const mol = spiro();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });

  it('no two atoms overlap', () => {
    const mol = spiro();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(
          atoms[i].x - atoms[j].x,
          atoms[i].y - atoms[j].y
        );
        assert.ok(d > 0.1, `atoms ${i} and ${j} overlap (d=${d.toFixed(4)})`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Ring substituents
// ---------------------------------------------------------------------------

describe('generateCoords — ring substituents', () => {
  it('methylbenzene: methyl carbon has correct bond length', () => {
    const mol = methylbenzene();
    generateCoords(mol);
    const bond = mol.getBond('a0', 'a6');
    assert.ok(bond, 'bond between ring and methyl should exist');
    assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
  });

  it('methylbenzene: all 7 atoms have coordinates', () => {
    const mol = methylbenzene();
    const result = generateCoords(mol);
    assert.equal(result.size, 7);
    for (const [, coord] of result) {
      assert.ok(isFinite(coord.x));
      assert.ok(isFinite(coord.y));
    }
  });
});

// ---------------------------------------------------------------------------
// suppressH option
// ---------------------------------------------------------------------------

describe('generateCoords — suppressH option', () => {
  it('suppressH: false places explicit H atoms', () => {
    const mol = new Molecule();
    mol.addAtom('c', 'C');
    mol.addAtom('h', 'H');
    mol.addBond('b', 'c', 'h', {}, false);
    generateCoords(mol, { suppressH: false });
    const h = mol.atoms.get('h');
    assert.equal(typeof h.x, 'number');
    assert.ok(!isNaN(h.x));
  });

  it('suppressH: true still gives H a coordinate (same as parent)', () => {
    const mol = new Molecule();
    mol.addAtom('c', 'C');
    mol.addAtom('h', 'H');
    mol.addBond('b', 'c', 'h', {}, false);
    generateCoords(mol, { suppressH: true });
    const h = mol.atoms.get('h');
    assert.equal(typeof h.x, 'number');
    assert.ok(!isNaN(h.x));
  });
});

// ---------------------------------------------------------------------------
// Additional factories
// ---------------------------------------------------------------------------

function cyclopentane() {
  const mol = new Molecule();
  for (let i = 0; i < 5; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  for (let i = 0; i < 5; i++) {
    mol.addBond(`b${i}`, `a${i}`, `a${(i + 1) % 5}`, {}, false);
  }
  return mol;
}

function cycloheptane() {
  const mol = new Molecule();
  for (let i = 0; i < 7; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  for (let i = 0; i < 7; i++) {
    mol.addBond(`b${i}`, `a${i}`, `a${(i + 1) % 7}`, {}, false);
  }
  return mol;
}

/** C(CH3)4 heavy-atom skeleton: central carbon bonded to 4 methyl carbons. */
function neopentane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  for (let i = 1; i <= 4; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  for (let i = 1; i <= 4; i++) {
    mol.addBond(`b${i}`, 'a0', `a${i}`, {}, false);
  }
  return mol;
}

/**
 * Indane skeleton: 6-ring fused to 5-ring sharing one bond.
 * 6-ring: a0-a1-a2-a3-a4-a5-a0; 5-ring shares bond a4-a5: a4-a6-a7-a8-a5-a4.
 */
function indane() {
  const mol = new Molecule();
  for (let i = 0; i < 9; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  for (let i = 0; i < 6; i++) {
    mol.addBond(`b6r${i}`, `a${i}`, `a${(i + 1) % 6}`, {}, false);
  }
  mol.addBond('b5r0', 'a4', 'a6', {}, false);
  mol.addBond('b5r1', 'a6', 'a7', {}, false);
  mol.addBond('b5r2', 'a7', 'a8', {}, false);
  mol.addBond('b5r3', 'a8', 'a5', {}, false);
  return mol;
}

/** Naphthalene skeleton (from existing tests) with one extra methyl substituent on a0. */
function naphthaleneMethyl() {
  const mol = new Molecule();
  for (let i = 0; i < 11; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  mol.addBond('b0',  'a0', 'a1', {}, false); mol.addBond('b1',  'a1', 'a2', {}, false);
  mol.addBond('b2',  'a2', 'a3', {}, false); mol.addBond('b3',  'a3', 'a4', {}, false);
  mol.addBond('b4',  'a4', 'a5', {}, false); mol.addBond('b5',  'a5', 'a0', {}, false);
  mol.addBond('b6',  'a4', 'a6', {}, false); mol.addBond('b7',  'a6', 'a7', {}, false);
  mol.addBond('b8',  'a7', 'a8', {}, false); mol.addBond('b9',  'a8', 'a9', {}, false);
  mol.addBond('b10', 'a9', 'a5', {}, false);
  mol.addBond('b11', 'a0', 'a10', {}, false);  // methyl substituent
  return mol;
}

/** Two disconnected fragments: benzene + isolated N atom. */
function benzeneAndN() {
  const mol = new Molecule();
  for (let i = 0; i < 6; i++) {
    mol.addAtom(`a${i}`, 'C');
  }
  for (let i = 0; i < 6; i++) {
    mol.addBond(`b${i}`, `a${i}`, `a${(i + 1) % 6}`, { aromatic: true }, false);
  }
  mol.addAtom('n0', 'N');
  return mol;
}

// ---------------------------------------------------------------------------
// Cyclopentane ring geometry
// ---------------------------------------------------------------------------

describe('generateCoords — cyclopentane ring geometry', () => {
  it('all 5 atoms equidistant from centroid', () => {
    const mol = cyclopentane();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 5;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 5;
    const radii = atoms.map(a => Math.hypot(a.x - cx, a.y - cy));
    for (const r of radii) {
      assert.ok(Math.abs(r - radii[0]) < 1e-9);
    }
  });

  it('all 5 bonds have length 1.5', () => {
    const mol = cyclopentane();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });

  it('no two atoms occupy the same position', () => {
    const mol = cyclopentane();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(
          atoms[i].x - atoms[j].x,
          atoms[i].y - atoms[j].y
        );
        assert.ok(d > 0.1, `atoms ${i} and ${j} overlap (d=${d})`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Cycloheptane ring geometry
// ---------------------------------------------------------------------------

describe('generateCoords — cycloheptane ring geometry', () => {
  it('all 7 atoms equidistant from centroid', () => {
    const mol = cycloheptane();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 7;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 7;
    const radii = atoms.map(a => Math.hypot(a.x - cx, a.y - cy));
    for (const r of radii) {
      assert.ok(Math.abs(r - radii[0]) < 1e-9);
    }
  });

  it('all 7 bonds have length 1.5', () => {
    const mol = cycloheptane();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });

  it('no two atoms overlap', () => {
    const mol = cycloheptane();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(
          atoms[i].x - atoms[j].x,
          atoms[i].y - atoms[j].y
        );
        assert.ok(d > 0.1, `atoms ${i} and ${j} overlap (d=${d})`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Degree-4 centre (neopentane skeleton)
// ---------------------------------------------------------------------------

describe('generateCoords — neopentane (degree-4 centre)', () => {
  it('all 4 C-C bonds have length 1.5', () => {
    const mol = neopentane();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });

  it('all 4 terminal atoms are at distinct positions', () => {
    const mol = neopentane();
    generateCoords(mol);
    const terminals = ['a1', 'a2', 'a3', 'a4'].map(id => mol.atoms.get(id));
    for (let i = 0; i < terminals.length; i++) {
      for (let j = i + 1; j < terminals.length; j++) {
        const d = Math.hypot(
          terminals[i].x - terminals[j].x,
          terminals[i].y - terminals[j].y
        );
        assert.ok(d > 0.5, `terminals ${i} and ${j} overlap (d=${d.toFixed(4)})`);
      }
    }
  });

  it('custom bondLength=2.0 applies to all 4 bonds', () => {
    const mol = neopentane();
    generateCoords(mol, { bondLength: 2.0 });
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 2.0) < 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// Long-chain internal angles
// ---------------------------------------------------------------------------

describe('generateCoords — long-chain bond angles', () => {
  it('10-atom chain: all interior bond angles are 120°', () => {
    const mol = linearChain(10);
    generateCoords(mol);
    for (let i = 1; i <= 8; i++) {
      const prev = mol.atoms.get(`a${i - 1}`);
      const cur  = mol.atoms.get(`a${i}`);
      const next = mol.atoms.get(`a${i + 1}`);
      const v1 = { x: prev.x - cur.x, y: prev.y - cur.y };
      const v2 = { x: next.x - cur.x, y: next.y - cur.y };
      const cos = (v1.x * v2.x + v1.y * v2.y) /
                  (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
      const angleDeg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      assert.ok(Math.abs(angleDeg - 120) < 1, `atom ${i}: angle=${angleDeg.toFixed(2)}°`);
    }
  });

  it('10-atom chain: no two atoms lie at the same position', () => {
    const mol = linearChain(10);
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(
          atoms[i].x - atoms[j].x,
          atoms[i].y - atoms[j].y
        );
        assert.ok(d > 0.1, `atoms a${i} and a${j} overlap (d=${d.toFixed(4)})`);
      }
    }
  });

  it('all bonds in a 10-atom chain have length 1.5', () => {
    const mol = linearChain(10);
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.5) < 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// bondLength option scales ring geometry
// ---------------------------------------------------------------------------

describe('generateCoords — bondLength option scales ring circumradius', () => {
  it('cyclohexane bondLength=2.0: all bonds length 2.0', () => {
    const mol = cyclohexane();
    generateCoords(mol, { bondLength: 2.0 });
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 2.0) < 1e-9);
    }
  });

  it('cyclohexane bondLength=2.0: all atoms at circumradius 2.0 from centroid', () => {
    const mol = cyclohexane();
    generateCoords(mol, { bondLength: 2.0 });
    const atoms = [...mol.atoms.values()];
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 6;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 6;
    // For a regular hexagon, circumradius == side length
    const radii = atoms.map(a => Math.hypot(a.x - cx, a.y - cy));
    for (const r of radii) {
      assert.ok(Math.abs(r - 2.0) < 1e-9, `radius ${r.toFixed(6)} != 2.0`);
    }
  });

  it('cyclopentane bondLength=1.0: all bonds length 1.0', () => {
    const mol = cyclopentane();
    generateCoords(mol, { bondLength: 1.0 });
    for (const bond of mol.bonds.values()) {
      assert.ok(Math.abs(bondLengthOf(mol, bond) - 1.0) < 1e-9);
    }
  });

  it('cyclopentane bondLength=1.0: all atoms equidistant from centroid', () => {
    const mol = cyclopentane();
    generateCoords(mol, { bondLength: 1.0 });
    const atoms = [...mol.atoms.values()];
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 5;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 5;
    const radii = atoms.map(a => Math.hypot(a.x - cx, a.y - cy));
    for (const r of radii) {
      assert.ok(Math.abs(r - radii[0]) < 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// Disconnected molecule: component tiling
// ---------------------------------------------------------------------------

describe('generateCoords — disconnected molecule tiling', () => {
  it('all atoms receive finite coordinates', () => {
    const mol = benzeneAndN();
    generateCoords(mol);
    for (const atom of mol.atoms.values()) {
      assert.ok(isFinite(atom.x), `${atom.id} x not finite`);
      assert.ok(isFinite(atom.y), `${atom.id} y not finite`);
    }
  });

  it('isolated atom is placed to the right of the ring component', () => {
    const mol = benzeneAndN();
    generateCoords(mol);
    const ringMaxX = Math.max(...[...Array(6).keys()].map(i => mol.atoms.get(`a${i}`).x));
    const nX = mol.atoms.get('n0').x;
    assert.ok(nX > ringMaxX, `isolated atom x (${nX.toFixed(3)}) should exceed ring maxX (${ringMaxX.toFixed(3)})`);
  });

  it('returned map size equals total atom count', () => {
    const mol = benzeneAndN();
    const result = generateCoords(mol);
    assert.equal(result.size, mol.atomCount);
  });

  it('two disconnected linear chains are horizontally separated', () => {
    const mol = new Molecule();
    // Chain A: a0-a1-a2
    mol.addAtom('a0', 'C'); mol.addAtom('a1', 'C'); mol.addAtom('a2', 'C');
    mol.addBond('bA0', 'a0', 'a1', {}, false); mol.addBond('bA1', 'a1', 'a2', {}, false);
    // Chain B: b0-b1-b2
    mol.addAtom('b0', 'C'); mol.addAtom('b1', 'C'); mol.addAtom('b2', 'C');
    mol.addBond('bB0', 'b0', 'b1', {}, false); mol.addBond('bB1', 'b1', 'b2', {}, false);
    generateCoords(mol);
    const aMaxX = Math.max(mol.atoms.get('a0').x, mol.atoms.get('a1').x, mol.atoms.get('a2').x);
    const bMinX = Math.min(mol.atoms.get('b0').x, mol.atoms.get('b1').x, mol.atoms.get('b2').x);
    assert.ok(bMinX > aMaxX, `chain B (minX=${bMinX.toFixed(3)}) should start right of chain A (maxX=${aMaxX.toFixed(3)})`);
  });
});

// ---------------------------------------------------------------------------
// Fused 5+6 ring (indane)
// ---------------------------------------------------------------------------

describe('generateCoords — indane (5+6 fused ring system)', () => {
  it('all 9 atoms receive finite coordinates', () => {
    const mol = indane();
    generateCoords(mol);
    for (const atom of mol.atoms.values()) {
      assert.ok(isFinite(atom.x), `${atom.id} x not finite`);
      assert.ok(isFinite(atom.y), `${atom.id} y not finite`);
    }
  });

  it('returned map has 9 entries', () => {
    const mol = indane();
    const result = generateCoords(mol);
    assert.equal(result.size, 9);
  });

  it('no two atoms occupy the same position', () => {
    const mol = indane();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(
          atoms[i].x - atoms[j].x,
          atoms[i].y - atoms[j].y
        );
        assert.ok(d > 0.1, `atoms ${atoms[i].id} and ${atoms[j].id} overlap (d=${d.toFixed(4)})`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Naphthalene with methyl substituent
// ---------------------------------------------------------------------------

describe('generateCoords — naphthalene + methyl substituent', () => {
  it('all 11 atoms have finite coordinates', () => {
    const mol = naphthaleneMethyl();
    generateCoords(mol);
    for (const atom of mol.atoms.values()) {
      assert.ok(isFinite(atom.x));
      assert.ok(isFinite(atom.y));
    }
  });

  it('all 12 bonds have length 1.5', () => {
    const mol = naphthaleneMethyl();
    generateCoords(mol);
    for (const bond of mol.bonds.values()) {
      const d = bondLengthOf(mol, bond);
      assert.ok(Math.abs(d - 1.5) < 1e-9, `bond ${bond.id} length ${d.toFixed(6)}`);
    }
  });

  it('no two atoms overlap', () => {
    const mol = naphthaleneMethyl();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(
          atoms[i].x - atoms[j].x,
          atoms[i].y - atoms[j].y
        );
        assert.ok(d > 0.5, `atoms ${atoms[i].id} and ${atoms[j].id} overlap (d=${d.toFixed(4)})`);
      }
    }
  });

  it('methyl carbon (a10) is not at the same position as any ring atom', () => {
    const mol = naphthaleneMethyl();
    generateCoords(mol);
    const methyl = mol.atoms.get('a10');
    for (let i = 0; i < 10; i++) {
      const ring = mol.atoms.get(`a${i}`);
      const d = Math.hypot(methyl.x - ring.x, methyl.y - ring.y);
      assert.ok(d > 0.5, `methyl overlaps ring atom a${i} (d=${d.toFixed(4)})`);
    }
  });
});

// ---------------------------------------------------------------------------
// Ring orientation: flat-top hexagon and principal-axis normalization
// ---------------------------------------------------------------------------

describe('generateCoords — flat-top hexagon orientation', () => {
  it('benzene: no atom is at the very top or bottom (flat-top convention)', () => {
    const mol = benzene();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 6;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 6;
    // Flat-top: no atom should be directly above or below the center (within 2°).
    for (const a of atoms) {
      const angle = Math.atan2(a.y - cy, a.x - cx);
      const distFromVertical = Math.min(
        Math.abs(angle - Math.PI / 2),
        Math.abs(angle + Math.PI / 2),
        Math.abs(angle - Math.PI / 2 + 2 * Math.PI),
        Math.abs(angle + Math.PI / 2 - 2 * Math.PI)
      );
      assert.ok(distFromVertical > 0.03,
        `atom ${a.id} is too close to vertical (angle=${(angle * 180 / Math.PI).toFixed(1)}°) — expected flat-top`);
    }
  });

  it('cyclohexane: no atom is at the very top or bottom (flat-top convention)', () => {
    const mol = cyclohexane();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 6;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 6;
    for (const a of atoms) {
      const angle = Math.atan2(a.y - cy, a.x - cx);
      const distFromVertical = Math.min(
        Math.abs(angle - Math.PI / 2),
        Math.abs(angle + Math.PI / 2),
        Math.abs(angle - Math.PI / 2 + 2 * Math.PI),
        Math.abs(angle + Math.PI / 2 - 2 * Math.PI)
      );
      assert.ok(distFromVertical > 0.03,
        `atom ${a.id} angle ${(angle * 180 / Math.PI).toFixed(1)}° is too close to vertical — expected flat-top`);
    }
  });
});

describe('generateCoords — principal-axis orientation (naphthalene)', () => {
  it('naphthalene bounding box is wider than tall (long axis horizontal)', () => {
    const mol = naphthalene();
    generateCoords(mol);
    const atoms = [...mol.atoms.values()];
    const xs = atoms.map(a => a.x), ys = atoms.map(a => a.y);
    const width  = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    assert.ok(width > height,
      `naphthalene should be wider than tall after orientation: width=${width.toFixed(3)}, height=${height.toFixed(3)}`);
  });
});

// ---------------------------------------------------------------------------
// Barbiturate regression — ring-atom substituents must point outward
// Regression for: "methyl group going inside ring" reported for
// N1([C@H](C)C)C(=O)N(C)C(=O)C(C)(C)C1=O
// ---------------------------------------------------------------------------

describe('generateCoords — barbiturate substituent direction', () => {
  function barbiturate() {
    return parseSMILES('N1([C@H](C)C)C(=O)N(C)C(=O)C(C)(C)C1=O');
  }

  it('all ring-atom heavy substituents point outward (diff < 90° from ring-outward direction)', () => {
    const mol = barbiturate();
    generateCoords(mol, { bondLength: 1.5 });

    const ring6 = mol.getRings().find(r => r.length === 6);
    assert.ok(ring6, 'Expected a 6-membered ring');
    const ringSet = new Set(ring6);

    // Ring centroid
    const cx = ring6.reduce((s, id) => s + mol.atoms.get(id).x, 0) / ring6.length;
    const cy = ring6.reduce((s, id) => s + mol.atoms.get(id).y, 0) / ring6.length;

    for (const rid of ringSet) {
      const rpos = mol.atoms.get(rid);
      const outward = Math.atan2(rpos.y - cy, rpos.x - cx) * 180 / Math.PI;

      for (const nbId of mol.getNeighbors(rid)) {
        if (ringSet.has(nbId)) {
          continue;
        }
        const nb = mol.atoms.get(nbId);
        if (!nb || nb.name === 'H') {
          continue;
        }

        const angle = Math.atan2(nb.y - rpos.y, nb.x - rpos.x) * 180 / Math.PI;
        const diff  = ((angle - outward + 540) % 360) - 180; // signed, in (-180, 180]
        assert.ok(
          Math.abs(diff) < 90,
          `Substituent ${rid}→${nbId} points inward: angle=${angle.toFixed(1)}°, outward=${outward.toFixed(1)}°, diff=${diff.toFixed(1)}°`
        );
      }
    }
  });

  it('no two heavy atoms overlap', () => {
    const mol = barbiturate();
    generateCoords(mol, { bondLength: 1.5 });
    const atoms = [...mol.atoms.values()].filter(a => a.name !== 'H' && a.x != null);
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y);
        assert.ok(d > 0.5, `atoms ${atoms[i].id}(${atoms[i].name}) and ${atoms[j].id}(${atoms[j].name}) overlap (d=${d.toFixed(4)})`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tetracyanoethylene (TCNE) — sp and sp2 geometry regression
// Regression for: "geometry coming off of the alkynes is incorrect"
// N#CC(C#N)=C(C#N)C#N: sp2 centres should be 120°, sp (C≡N) should be 180°
// ---------------------------------------------------------------------------

describe('generateCoords — TCNE sp/sp2 geometry', () => {
  it('all C≡N carbons are linear (bond angle 180°)', () => {
    const mol = parseSMILES('N#CC(C#N)=C(C#N)C#N');
    generateCoords(mol, { bondLength: 1.5 });

    for (const [id, atom] of mol.atoms) {
      if (atom.name === 'H' || atom.x == null) {
        continue;
      }
      // sp carbon: has a triple-bond neighbour
      const hasTriple = atom.bonds.some(bId => {
        const b = mol.bonds.get(bId);
        return b && (b.properties.order ?? 1) === 3;
      });
      if (!hasTriple) {
        continue;
      }

      const nbs = mol.getNeighbors(id).filter(n => mol.atoms.get(n)?.x != null);
      if (nbs.length < 2) {
        continue;
      } // terminal N — skip

      for (let i = 0; i < nbs.length; i++) {
        for (let j = i + 1; j < nbs.length; j++) {
          const a = mol.atoms.get(nbs[i]), b = mol.atoms.get(nbs[j]);
          const ux = a.x - atom.x, uy = a.y - atom.y;
          const vx = b.x - atom.x, vy = b.y - atom.y;
          const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) || 1e-9) * (Math.hypot(vx, vy) || 1e-9));
          const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
          assert.ok(
            Math.abs(ang - 180) < 1,
            `sp carbon ${id}: angle ${nbs[i]}-${id}-${nbs[j]} = ${ang.toFixed(1)}° (expected 180°)`
          );
        }
      }
    }
  });

  it('sp2 carbons at central C=C bond have 120° angles', () => {
    const mol = parseSMILES('N#CC(C#N)=C(C#N)C#N');
    generateCoords(mol, { bondLength: 1.5 });

    for (const [id, atom] of mol.atoms) {
      if (atom.name !== 'C' || atom.x == null) {
        continue;
      }
      // sp2 carbon: has a double-bond, no triple bond
      const hasDouble = atom.bonds.some(bId => (mol.bonds.get(bId)?.properties.order ?? 1) === 2);
      const hasTriple = atom.bonds.some(bId => (mol.bonds.get(bId)?.properties.order ?? 1) === 3);
      if (!hasDouble || hasTriple) {
        continue;
      }

      const nbs = mol.getNeighbors(id).filter(n => mol.atoms.get(n)?.x != null);
      for (let i = 0; i < nbs.length; i++) {
        for (let j = i + 1; j < nbs.length; j++) {
          const a = mol.atoms.get(nbs[i]), b = mol.atoms.get(nbs[j]);
          const ux = a.x - atom.x, uy = a.y - atom.y;
          const vx = b.x - atom.x, vy = b.y - atom.y;
          const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) || 1e-9) * (Math.hypot(vx, vy) || 1e-9));
          const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
          assert.ok(
            Math.abs(ang - 120) < 1,
            `sp2 carbon ${id}: angle ${nbs[i]}-${id}-${nbs[j]} = ${ang.toFixed(1)}° (expected 120°)`
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Three-ring linker molecule — inter-ring chain spanning > 4 hops
// Regression for: pyridine+morpholine connected to trimethoxybenzene via a
// 5-atom linker chain (benzene-C5→C13→C14→N16→C17→pyridine-C19) used to
// exceed MAX_HOPS=4 causing pyridine to be placed via the disconnected
// fallback (far right), while the morpholine chain placed C14 on the left —
// producing an 8 Å C14-N16 bond and multiple bond crossings.
// ---------------------------------------------------------------------------
describe('generateCoords — three-ring linker (pyridine+morpholine off trimethoxybenzene)', () => {
  const SMILES = 'COC1=CC(=CC(=C1OC)OC)C[C@H](NC(=O)C2=CN=CC=C2)C(=O)N3CCOCC3';

  it('all heavy-atom bond lengths are in [1.0, 2.5] Å', () => {
    const mol = parseSMILES(SMILES);
    generateCoords(mol, { bondLength: 1.5 });

    for (const [, bond] of mol.bonds) {
      const a1 = mol.atoms.get(bond.atoms[0]);
      const a2 = mol.atoms.get(bond.atoms[1]);
      if (!a1 || !a2 || a1.x == null || a2.x == null) {
        continue;
      }
      if (a1.name === 'H' || a2.name === 'H') {
        continue;
      }
      const d = Math.hypot(a1.x - a2.x, a1.y - a2.y);
      assert.ok(
        d >= 1.0 && d <= 2.5,
        `bond ${bond.atoms[0]}(${a1.name})-${bond.atoms[1]}(${a2.name}): length ${d.toFixed(3)} Å out of [1.0, 2.5]`
      );
    }
  });

  it('no heavy-atom overlaps (< 0.5 Å)', () => {
    const mol = parseSMILES(SMILES);
    generateCoords(mol, { bondLength: 1.5 });

    const atoms = [...mol.atoms.entries()].filter(([, a]) => a.name !== 'H' && a.x != null);
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const [id1, a1] = atoms[i], [id2, a2] = atoms[j];
        const d = Math.hypot(a1.x - a2.x, a1.y - a2.y);
        assert.ok(
          d >= 0.5,
          `atoms ${id1}(${a1.name}) and ${id2}(${a2.name}) overlap: d = ${d.toFixed(3)} Å`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Highly-branched tert-butyl chain — H-atom ghost blocking regression
// Regression for: "one of the tert butyl groups in this molecule are not
// rendering correctly: CC(C)(C(C)(C(C)(C)C)C)C"
// SMILES has 3 consecutive quaternary carbons (trimethyl-substituted), and
// each carries 3 methyl branches.  Before the fix, the explicit H atoms added
// by parseSMILES were placed into the spatial grid during Phase-C layout.
// One H atom of the root methyl (C1) happened to land at the ideal position
// for the next quaternary carbon (C4), forcing a 30° rotation that left C4
// only ~30° away from C1, causing C9-C10 and C10-C11 to overlap at 0.78 Å.
// ---------------------------------------------------------------------------
describe('generateCoords — three-adjacent-tBu groups (H ghost blocking fix)', () => {
  const SMILES = 'CC(C)(C(C)(C(C)(C)C)C)C';

  it('all heavy-atom bond lengths are exactly 1.5 Å', () => {
    const mol = parseSMILES(SMILES);
    generateCoords(mol, { suppressH: true, bondLength: 1.5 });

    for (const [, bond] of mol.bonds) {
      const a1 = mol.atoms.get(bond.atoms[0]);
      const a2 = mol.atoms.get(bond.atoms[1]);
      if (!a1 || !a2 || a1.name === 'H' || a2.name === 'H') {
        continue;
      }
      const d = Math.hypot(a1.x - a2.x, a1.y - a2.y);
      assert.ok(
        Math.abs(d - 1.5) < 1e-6,
        `bond ${bond.atoms[0]}(${a1.name})-${bond.atoms[1]}(${a2.name}): length ${d.toFixed(4)} Å`
      );
    }
  });

  it('no heavy-atom overlaps (< 0.5 Å)', () => {
    const mol = parseSMILES(SMILES);
    generateCoords(mol, { suppressH: true, bondLength: 1.5 });

    const atoms = [...mol.atoms.entries()].filter(([, a]) => a.name !== 'H' && a.x != null);
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const [id1, a1] = atoms[i], [id2, a2] = atoms[j];
        const d = Math.hypot(a1.x - a2.x, a1.y - a2.y);
        assert.ok(
          d >= 0.5,
          `atoms ${id1}(${a1.name}) and ${id2}(${a2.name}) overlap: d = ${d.toFixed(3)} Å`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Bridged bicyclic with two 9-membered rings sharing a 4-atom bridge.
// The arc-side direction was previously determined from the pre-placed-atom
// centroid, which landed on the wrong side of the bridgehead chord and
// collapsed ring-2 on top of ring-1, causing the force-field to stretch the
// C11-C12 bond to ~9 Å.  The fix uses curCenter as the primary signal.
// ---------------------------------------------------------------------------
describe('generateCoords — bridged bicyclic (two fused 9-rings, 4-atom bridge)', () => {
  const SMILES = 'N%10CCOCC%11NCCOCC%10CC%11';

  it('all bonds are within 1.5× the standard bond length (no blown-up bonds)', () => {
    const mol = parseSMILES(SMILES);
    const coords = generateCoords(mol, { suppressH: true, bondLength: 1.5 });

    for (const [, bond] of mol.bonds) {
      const [id1, id2] = bond.atoms;
      const p1 = coords.get(id1) ?? mol.atoms.get(id1);
      const p2 = coords.get(id2) ?? mol.atoms.get(id2);
      if (!p1 || !p2) {
        continue;
      }
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      assert.ok(
        d <= 1.5 * 1.5,
        `bond ${id1}-${id2}: ${d.toFixed(3)} Å exceeds 1.5×BL`
      );
    }
  });

  it('no heavy-atom overlaps (< 0.5 Å)', () => {
    const mol = parseSMILES(SMILES);
    const coords = generateCoords(mol, { suppressH: true, bondLength: 1.5 });

    const entries = [...mol.atoms.entries()].filter(([, a]) => a.name !== 'H');
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [id1, a1] = entries[i], [id2, a2] = entries[j];
        const p1 = coords.get(id1) ?? a1;
        const p2 = coords.get(id2) ?? a2;
        if (!p1 || !p2) {
          continue;
        }
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        assert.ok(
          d >= 0.5,
          `atoms ${id1}(${a1.name}) and ${id2}(${a2.name}) overlap: d = ${d.toFixed(3)} Å`
        );
      }
    }
  });
});

describe('generateCoords — parser-independent branch ordering', () => {
  const SMILES = 'C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN';
  const INCHI = 'InChI=1S/C14H24N6O4/c15-4-2-1-3-10(14(23)24)20-13(22)11(19-12(21)6-16)5-9-7-17-8-18-9/h7-8,10-11H,1-6,15-16H2,(H,17,18)(H,19,21)(H,20,22)(H,23,24)/t10-,11?/m0/s1';

  it('SMILES and InChI layouts match for the same peptide graph', () => {
    const smilesMol = parseSMILES(SMILES);
    const inchiMol = parseINCHI(INCHI);

    generateCoords(smilesMol, { suppressH: true, bondLength: 1.5 });
    generateCoords(inchiMol, { suppressH: true, bondLength: 1.5 });

    assert.equal(heavyDistanceSignature(smilesMol), heavyDistanceSignature(inchiMol));
  });

  it('keeps the peptide-like non-ring backbone extended', () => {
    const mol = parseINCHI(INCHI);
    generateCoords(mol, { suppressH: true, bondLength: 1.5 });

    const path = preferredBackbonePath(mol);
    assert.ok(path.length >= 12, `expected a long preferred backbone, got ${path.length} atoms`);
    const xValues = path.map(id => mol.atoms.get(id)?.x ?? NaN);

    for (let i = 1; i < xValues.length; i++) {
      assert.ok(
        xValues[i] > xValues[i - 1],
        `backbone x-order regressed at ${path[i - 1]} -> ${path[i]}: ${xValues[i - 1]} !< ${xValues[i]}`
      );
    }

    const start = mol.atoms.get(path[0]);
    const end = mol.atoms.get(path[path.length - 1]);
    assert.ok(start && end, 'expected backbone endpoints');
    const endToEnd = Math.hypot(end.x - start.x, end.y - start.y);
    assert.ok(endToEnd >= 14.5, `backbone not sufficiently extended: ${endToEnd.toFixed(3)} Å`);
  });
});

describe('generateCoords — bond-to-label crowding', () => {
  const SMILES = 'C(CC(N)C(O)=O)CN=C(N)N';

  it('separates the imine branch from the carbonyl group', () => {
    const mol = parseSMILES(SMILES);
    generateCoords(mol, { suppressH: true, bondLength: 1.5 });

    const imineN = mol.atoms.get('N9');
    const imineC = mol.atoms.get('C10');
    const carbonylO = mol.atoms.get('O7');
    const carbonylC = mol.atoms.get('C5');

    assert.ok(imineN && imineC && carbonylO && carbonylC, 'expected named atoms from parser');

    const dist = pointToSegmentDistance(carbonylO, imineN, imineC);
    const branchSep = Math.hypot(carbonylC.x - imineC.x, carbonylC.y - imineC.y);
    assert.ok(
      dist >= 0.7,
      `imine bond crowds carbonyl oxygen: segment distance ${dist.toFixed(3)} Å`
    );
    assert.ok(
      branchSep >= 1.2,
      `imine carbon folds into carbonyl carbon: distance ${branchSep.toFixed(3)} Å`
    );
  });
});

describe('generateCoords — extended chain spread', () => {
  const SMILES = 'OC[C@H]1O[C@@H](O[C@H]2[C@@H](O)[C@H](O)[C@@H](CO)O[C@H]2O)[C@H](O)[C@@H](O)[C@@H]1OC(=O)CCCCCC';

  it('keeps the ester alkyl tail from curling back into the carbonyl region', () => {
    const mol = parseSMILES(SMILES);
    generateCoords(mol, { suppressH: true, bondLength: 1.5 });

    const carbonylO = mol.atoms.get('O33');
    const tailCarbon = mol.atoms.get('C40');
    const tailStart = mol.atoms.get('C34');
    const tailEnd = mol.atoms.get('C41');

    assert.ok(carbonylO && tailCarbon && tailStart && tailEnd, 'expected stable ester-tail atom ids');

    const oxygenClearance = Math.hypot(carbonylO.x - tailCarbon.x, carbonylO.y - tailCarbon.y);
    const tailExtent = Math.hypot(tailEnd.x - tailStart.x, tailEnd.y - tailStart.y);

    assert.ok(
      oxygenClearance >= 2.0,
      `alkyl tail curls back toward carbonyl oxygen: clearance ${oxygenClearance.toFixed(3)} Å`
    );
    assert.ok(
      tailExtent >= 5.5,
      `alkyl tail not sufficiently extended: end-to-end ${tailExtent.toFixed(3)} Å`
    );

    const tailAngles = [
      angleDeg(mol.atoms.get('C34'), mol.atoms.get('C36'), mol.atoms.get('C37')),
      angleDeg(mol.atoms.get('C36'), mol.atoms.get('C37'), mol.atoms.get('C38')),
      angleDeg(mol.atoms.get('C37'), mol.atoms.get('C38'), mol.atoms.get('C39')),
      angleDeg(mol.atoms.get('C38'), mol.atoms.get('C39'), mol.atoms.get('C40')),
      angleDeg(mol.atoms.get('C39'), mol.atoms.get('C40'), mol.atoms.get('C41'))
    ];
    for (const ang of tailAngles) {
      assert.ok(
        approx(ang, 120, 1e-6),
        `alkyl tail bond angle drifted from zigzag geometry: ${ang.toFixed(3)}°`
      );
    }
  });
});

describe('generateCoords — alkene substituent geometry', () => {
  it('keeps single-bond substituents on an alkene carbon at trigonal angles', () => {
    const mol = parseSMILES('F/C=C/F');
    generateCoords(mol, { suppressH: true, bondLength: 1.5 });

    const carbon1 = mol.atoms.get('C2');
    const carbon2 = mol.atoms.get('C3');
    const fluorine1 = mol.atoms.get('F1');
    const fluorine2 = mol.atoms.get('F4');

    assert.ok(carbon1 && carbon2 && fluorine1 && fluorine2, 'expected stable difluoroethene atom ids');
    assert.ok(
      approx(angleDeg(fluorine1, carbon1, carbon2), 120, 1e-6),
      `left alkene substituent angle drifted: ${angleDeg(fluorine1, carbon1, carbon2).toFixed(3)}°`
    );
    assert.ok(
      approx(angleDeg(carbon1, carbon2, fluorine2), 120, 1e-6),
      `right alkene substituent angle drifted: ${angleDeg(carbon1, carbon2, fluorine2).toFixed(3)}°`
    );
  });
});

describe('getAtomLabel — charged carbons', () => {
  it('shows a label for substituted carbons with formal charge', () => {
    const mol = parseSMILES('C1=CC=[C-]C=C1.[Li+]');
    const chargedCarbon = [...mol.atoms.values()].find(
      atom => atom.name === 'C' && (atom.properties.charge ?? 0) === -1
    );

    assert.ok(chargedCarbon, 'expected a negatively charged carbon');
    assert.equal(
      getAtomLabel(chargedCarbon, new Map(), () => ({ x: 0, y: 0 }), mol),
      'C'
    );
  });

  it('keeps neutral substituted carbons unlabeled', () => {
    const mol = parseSMILES('CC');
    const neutralCarbon = [...mol.atoms.values()].find(
      atom =>
        atom.name === 'C' &&
        (atom.properties.charge ?? 0) === 0 &&
        atom.getNeighbors(mol).some(nb => nb.name !== 'H')
    );

    assert.ok(neutralCarbon, 'expected a neutral substituted carbon');
    assert.equal(
      getAtomLabel(neutralCarbon, new Map(), () => ({ x: 0, y: 0 }), mol),
      null
    );
  });
});

describe('refineExistingCoords — standalone cleanup', () => {
  it('rotates a rotatable subtree away from an atom overlap', () => {
    const mol = parseSMILES('CCOC');
    const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
    const [c1, c2, o3, c4] = heavyAtoms;

    c1.x = 0;   c1.y = 0;
    c2.x = 1.5; c2.y = 0;
    o3.x = 3.0; o3.y = 0;
    c4.x = 1.5; c4.y = 0;

    const beforeOverlap = Math.hypot(c2.x - c4.x, c2.y - c4.y);
    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 4 });
    const afterOverlap = Math.hypot(c2.x - c4.x, c2.y - c4.y);
    const terminalBond = Math.hypot(o3.x - c4.x, o3.y - c4.y);

    assert.ok(beforeOverlap < 1e-9, 'expected the terminal carbon to start overlapped');
    assert.ok(afterOverlap > 1.0, `expected overlap to be resolved, got ${afterOverlap.toFixed(3)} Å`);
    assert.ok(approx(terminalBond, 1.5, 1e-6), `rotated bond length drifted: ${terminalBond.toFixed(3)} Å`);
  });

  it('leaves a clean rotatable chain unchanged', () => {
    const mol = parseSMILES('CCOC');
    const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
    generateCoords(mol);

    const before = heavyAtoms.map(atom => ({ x: atom.x, y: atom.y }));
    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 4 });
    const after = heavyAtoms.map(atom => ({ x: atom.x, y: atom.y }));

    for (let i = 0; i < before.length; i++) {
      assert.ok(approx(after[i].x, before[i].x, 1e-9), `atom ${i} x changed unexpectedly`);
      assert.ok(approx(after[i].y, before[i].y, 1e-9), `atom ${i} y changed unexpectedly`);
    }
  });

  it('pulls a displaced terminal atom back toward the expected bond length', () => {
    const mol = parseSMILES('CCOC');
    const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
    const [, , o3, c4] = heavyAtoms;

    generateCoords(mol);
    c4.x = 7.5;
    c4.y = 0;

    const beforeBond = Math.hypot(o3.x - c4.x, o3.y - c4.y);
    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 4 });
    const afterBond = Math.hypot(o3.x - c4.x, o3.y - c4.y);

    assert.ok(beforeBond > 3.0, `expected a badly stretched bond, got ${beforeBond.toFixed(3)} Å`);
    assert.ok(approx(afterBond, 1.5, 1e-6), `expected stretched bond to be restored, got ${afterBond.toFixed(3)} Å`);
  });

  it('restores a dragged sp3 chain segment to zigzag geometry', () => {
    const mol = parseSMILES('CCCC');
    const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
    const [c1, c2, c3] = heavyAtoms;

    generateCoords(mol);
    const dx = c2.x - c1.x;
    const dy = c2.y - c1.y;
    const len = Math.hypot(dx, dy);
    c3.x = c2.x + (dx / len) * 1.5;
    c3.y = c2.y + (dy / len) * 1.5;

    const beforeAngle = (() => {
      const v1x = c1.x - c2.x;
      const v1y = c1.y - c2.y;
      const v2x = c3.x - c2.x;
      const v2y = c3.y - c2.y;
      const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
      return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    })();

    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 6 });

    const afterAngle = (() => {
      const v1x = c1.x - c2.x;
      const v1y = c1.y - c2.y;
      const v2x = c3.x - c2.x;
      const v2y = c3.y - c2.y;
      const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
      return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    })();
    const restoredBond = Math.hypot(c3.x - c2.x, c3.y - c2.y);

    assert.ok(beforeAngle > 170, `expected a badly straightened chain, got ${beforeAngle.toFixed(2)}°`);
    assert.ok(Math.abs(afterAngle - 120) < 3, `expected restored zigzag angle near 120°, got ${afterAngle.toFixed(2)}°`);
    assert.ok(approx(restoredBond, 1.5, 1e-6), `expected restored bond length 1.5 Å, got ${restoredBond.toFixed(3)} Å`);
  });

  it('prefers an extended zigzag over a curled alkyl chain', () => {
    const mol = parseSMILES('CCCCCC');
    const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
    const [c1, c2, c3, c4, c5, c6] = heavyAtoms;

    c1.x = 0.0;  c1.y = 0.0;
    c2.x = 1.5;  c2.y = 0.0;
    c3.x = 2.25; c3.y = 1.2990381057;
    c4.x = 1.5;  c4.y = 2.5980762114;
    c5.x = 0.0;  c5.y = 2.5980762114;
    c6.x = -0.75; c6.y = 1.2990381057;

    const beforeEndToEnd = Math.hypot(c6.x - c1.x, c6.y - c1.y);
    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 6 });
    const afterEndToEnd = Math.hypot(c6.x - c1.x, c6.y - c1.y);

    const internalAngles = [
      angleDeg(c1, c2, c3),
      angleDeg(c2, c3, c4),
      angleDeg(c3, c4, c5),
      angleDeg(c4, c5, c6)
    ];

    assert.ok(beforeEndToEnd < 2.0, `expected a compact curled chain before refine, got ${beforeEndToEnd.toFixed(3)} Å`);
    assert.ok(afterEndToEnd > 3.0, `expected a more extended chain after refine, got ${afterEndToEnd.toFixed(3)} Å`);
    for (const angle of internalAngles) {
      assert.ok(Math.abs(angle - 120) < 3, `expected preserved zigzag bond angles near 120°, got ${angle.toFixed(2)}°`);
    }
    for (let i = 0; i < heavyAtoms.length - 1; i++) {
      const len = Math.hypot(heavyAtoms[i + 1].x - heavyAtoms[i].x, heavyAtoms[i + 1].y - heavyAtoms[i].y);
      assert.ok(approx(len, 1.5, 1e-6), `expected chain bond length 1.5 Å, got ${len.toFixed(3)} Å`);
    }
  });

  it('restores trigonal geometry around a distorted sp2 center', () => {
    const mol = parseSMILES('CC(=O)N');
    generateCoords(mol);

    const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
    const carbonylCarbon = heavyAtoms.find(atom =>
      atom.name === 'C' &&
      atom.getNeighbors(mol).filter(nb => nb.name !== 'H').length === 3 &&
      atom.bonds.some(bondId => (mol.bonds.get(bondId)?.properties.order ?? 1) === 2)
    );
    const oxygen = carbonylCarbon.getNeighbors(mol).find(nb =>
      nb.name === 'O' && (mol.getBond(carbonylCarbon.id, nb.id)?.properties.order ?? 1) === 2
    );
    const nitrogen = carbonylCarbon.getNeighbors(mol).find(nb => nb.name === 'N');
    const carbon = carbonylCarbon.getNeighbors(mol).find(nb => nb.name === 'C');

    {
      const dx = oxygen.x - carbonylCarbon.x;
      const dy = oxygen.y - carbonylCarbon.y;
      const len = Math.hypot(dx, dy);
      nitrogen.x = carbonylCarbon.x + (dx / len) * 1.5;
      nitrogen.y = carbonylCarbon.y + (dy / len) * 1.5;
    }

    const beforeAngles = [
      angleDeg(oxygen, carbonylCarbon, nitrogen),
      angleDeg(carbon, carbonylCarbon, nitrogen)
    ];

    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 6 });

    const afterAngles = [
      angleDeg(oxygen, carbonylCarbon, nitrogen),
      angleDeg(carbon, carbonylCarbon, nitrogen),
      angleDeg(oxygen, carbonylCarbon, carbon)
    ];
    const cnBond = Math.hypot(nitrogen.x - carbonylCarbon.x, nitrogen.y - carbonylCarbon.y);

    assert.ok(beforeAngles.some(angle => Math.abs(angle - 120) > 20), `expected badly distorted sp2 angles, got ${beforeAngles.map(a => a.toFixed(2)).join(', ')}`);
    for (const angle of afterAngles) {
      assert.ok(Math.abs(angle - 120) < 4, `expected restored trigonal angle near 120°, got ${angle.toFixed(2)}°`);
    }
    assert.ok(approx(cnBond, 1.5, 1e-6), `expected restored C-N bond length 1.5 Å, got ${cnBond.toFixed(3)} Å`);
  });

  it('snaps a displaced carbonyl oxygen back onto the trigonal geometry', () => {
    const mol = parseSMILES('CC(=O)N');
    generateCoords(mol);

    const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
    const carbonylCarbon = heavyAtoms.find(atom =>
      atom.name === 'C' &&
      atom.getNeighbors(mol).filter(nb => nb.name !== 'H').length === 3 &&
      atom.bonds.some(bondId => (mol.bonds.get(bondId)?.properties.order ?? 1) === 2)
    );
    const oxygen = carbonylCarbon.getNeighbors(mol).find(nb =>
      nb.name === 'O' && (mol.getBond(carbonylCarbon.id, nb.id)?.properties.order ?? 1) === 2
    );
    const nitrogen = carbonylCarbon.getNeighbors(mol).find(nb => nb.name === 'N');
    const carbon = carbonylCarbon.getNeighbors(mol).find(nb => nb.name === 'C');

    oxygen.x = carbonylCarbon.x + 3.5;
    oxygen.y = carbonylCarbon.y + 1.8;

    const beforeBond = Math.hypot(oxygen.x - carbonylCarbon.x, oxygen.y - carbonylCarbon.y);
    const beforeAngles = [
      angleDeg(oxygen, carbonylCarbon, nitrogen),
      angleDeg(oxygen, carbonylCarbon, carbon)
    ];

    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 6 });

    const afterBond = Math.hypot(oxygen.x - carbonylCarbon.x, oxygen.y - carbonylCarbon.y);
    const afterAngles = [
      angleDeg(oxygen, carbonylCarbon, nitrogen),
      angleDeg(oxygen, carbonylCarbon, carbon),
      angleDeg(nitrogen, carbonylCarbon, carbon)
    ];

    assert.ok(beforeBond > 3.0, `expected a badly displaced carbonyl oxygen, got ${beforeBond.toFixed(3)} Å`);
    assert.ok(beforeAngles.some(angle => Math.abs(angle - 120) > 20), `expected distorted carbonyl angles, got ${beforeAngles.map(a => a.toFixed(2)).join(', ')}`);
    assert.ok(approx(afterBond, 1.5, 1e-6), `expected restored C=O bond length 1.5 Å, got ${afterBond.toFixed(3)} Å`);
    for (const angle of afterAngles) {
      assert.ok(Math.abs(angle - 120) < 4, `expected restored trigonal angle near 120°, got ${angle.toFixed(2)}°`);
    }
  });

  it('snaps a displaced ring atom back to the ring geometry', () => {
    const mol = benzene();
    generateCoords(mol);

    const ringAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
    const displaced = ringAtoms[0];
    const original = ringAtoms.map(atom => ({ id: atom.id, x: atom.x, y: atom.y }));

    displaced.x += 2.0;
    displaced.y += 1.25;

    const beforeDrift = Math.hypot(displaced.x - original[0].x, displaced.y - original[0].y);
    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 6 });
    const afterDrift = Math.hypot(displaced.x - original[0].x, displaced.y - original[0].y);

    const cx = ringAtoms.reduce((sum, atom) => sum + atom.x, 0) / ringAtoms.length;
    const cy = ringAtoms.reduce((sum, atom) => sum + atom.y, 0) / ringAtoms.length;
    const radii = ringAtoms.map(atom => Math.hypot(atom.x - cx, atom.y - cy));
    const r0 = radii[0];

    assert.ok(afterDrift < beforeDrift * 0.35, `expected ring atom to move back toward ring geometry, got ${afterDrift.toFixed(3)} Å drift`);
    for (const bond of mol.bonds.values()) {
      const [a1, a2] = bond.getAtomObjects(mol);
      if (a1?.name === 'H' || a2?.name === 'H') {
        continue;
      }
      const len = Math.hypot(a1.x - a2.x, a1.y - a2.y);
      assert.ok(approx(len, 1.5, 1e-6), `expected ring bond length 1.5 Å, got ${len.toFixed(3)} Å`);
    }
    for (const radius of radii) {
      assert.ok(Math.abs(radius - r0) < 1e-6, `expected regular ring radius, got ${radius} vs ${r0}`);
    }
  });

  it('reprojects a ring substituent so it points outward from the ring vertex', () => {
    const mol = parseSMILES('Cc1ccccc1');
    generateCoords(mol, { bondLength: 1.5 });

    const ring = mol.getRings().find(r => r.length === 6);
    assert.ok(ring, 'expected a six-membered ring');
    const ringSet = new Set(ring);
    const ringAtom = ring
      .map(id => mol.atoms.get(id))
      .find(atom => atom.getNeighbors(mol).some(nb => !ringSet.has(nb.id) && nb.name !== 'H'));
    const substituent = ringAtom.getNeighbors(mol).find(nb => !ringSet.has(nb.id) && nb.name !== 'H');

    const cx = ring.reduce((sum, id) => sum + mol.atoms.get(id).x, 0) / ring.length;
    const cy = ring.reduce((sum, id) => sum + mol.atoms.get(id).y, 0) / ring.length;
    const inwardAngle = Math.atan2(cy - ringAtom.y, cx - ringAtom.x);
    substituent.x = ringAtom.x + Math.cos(inwardAngle) * 1.5;
    substituent.y = ringAtom.y + Math.sin(inwardAngle) * 1.5;

    const beforeAngle = Math.atan2(substituent.y - ringAtom.y, substituent.x - ringAtom.x);
    const beforeOutward = Math.atan2(ringAtom.y - cy, ringAtom.x - cx);
    const beforeDiff = Math.abs(((beforeAngle - beforeOutward + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 6 });

    const afterCx = ring.reduce((sum, id) => sum + mol.atoms.get(id).x, 0) / ring.length;
    const afterCy = ring.reduce((sum, id) => sum + mol.atoms.get(id).y, 0) / ring.length;
    const afterAngle = Math.atan2(substituent.y - ringAtom.y, substituent.x - ringAtom.x);
    const afterOutward = Math.atan2(ringAtom.y - afterCy, ringAtom.x - afterCx);
    const afterDiff = Math.abs(((afterAngle - afterOutward + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const bondLen = Math.hypot(substituent.x - ringAtom.x, substituent.y - ringAtom.y);

    assert.ok(beforeDiff > Math.PI / 2, `expected inward-pointing substituent before refine, got ${beforeDiff * 180 / Math.PI}°`);
    assert.ok(afterDiff < 25 * Math.PI / 180, `expected outward ring substituent after refine, got ${afterDiff * 180 / Math.PI}°`);
    assert.ok(approx(bondLen, 1.5, 1e-6), `expected restored aryl-substituent bond length 1.5 Å, got ${bondLen.toFixed(3)} Å`);
  });

  it('restores a displaced terminal alkene carbon in an alkene side chain', () => {
    const mol = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C');
    generateCoords(mol, { bondLength: 1.5 });

    const dblBond = [...mol.bonds.values()].find(bond =>
      (bond.properties.order ?? 1) === 2 && bond.getAtomObjects(mol).every(atom => atom.name === 'C')
    );
    const [a, b] = dblBond.getAtomObjects(mol);
    const terminal = [a, b].find(atom => atom.getNeighbors(mol).filter(nb => nb.name !== 'H').length === 1);
    const internal = a.id === terminal.id ? b : a;
    const prev = internal.getNeighbors(mol).find(nb => nb.name !== 'H' && nb.id !== terminal.id);

    terminal.x += 3.0;
    terminal.y += 2.0;

    const beforeLen = Math.hypot(internal.x - terminal.x, internal.y - terminal.y);
    const _beforeAngle = angleDeg(prev, internal, terminal);

    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 6 });

    const afterLen = Math.hypot(internal.x - terminal.x, internal.y - terminal.y);
    const afterAngle = angleDeg(prev, internal, terminal);

    assert.ok(beforeLen > 3.0, `expected badly stretched alkene bond before refine, got ${beforeLen.toFixed(3)} Å`);
    assert.ok(Math.abs(afterLen - 1.5) < 1e-6, `expected restored alkene bond length 1.5 Å, got ${afterLen.toFixed(3)} Å`);
    assert.ok(Math.abs(afterAngle - 120) < 4, `expected restored alkene angle near 120°, got ${afterAngle.toFixed(2)}°`);
  });

  it('restores a displaced internal alkene carbon together with its terminal alkene partner', () => {
    const mol = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C');
    generateCoords(mol, { bondLength: 1.5 });

    const dblBond = [...mol.bonds.values()].find(bond =>
      (bond.properties.order ?? 1) === 2 && bond.getAtomObjects(mol).every(atom => atom.name === 'C')
    );
    const [a, b] = dblBond.getAtomObjects(mol);
    const terminal = [a, b].find(atom => atom.getNeighbors(mol).filter(nb => nb.name !== 'H').length === 1);
    const internal = a.id === terminal.id ? b : a;
    const prev = internal.getNeighbors(mol).find(nb => nb.name !== 'H' && nb.id !== terminal.id);

    internal.x += 3.0;
    internal.y += 2.0;

    const beforeSingle = Math.hypot(prev.x - internal.x, prev.y - internal.y);
    const beforeDouble = Math.hypot(internal.x - terminal.x, internal.y - terminal.y);
    const _beforeAngle = angleDeg(prev, internal, terminal);

    refineExistingCoords(mol, { bondLength: 1.5, maxPasses: 6 });

    const afterSingle = Math.hypot(prev.x - internal.x, prev.y - internal.y);
    const afterDouble = Math.hypot(internal.x - terminal.x, internal.y - terminal.y);
    const afterAngle = angleDeg(prev, internal, terminal);

    assert.ok(beforeSingle > 2.0 || beforeDouble > 2.0, `expected distorted alkene geometry before refine, got single=${beforeSingle.toFixed(3)} Å double=${beforeDouble.toFixed(3)} Å`);
    assert.ok(Math.abs(afterSingle - 1.5) < 1e-6, `expected restored allylic bond length 1.5 Å, got ${afterSingle.toFixed(3)} Å`);
    assert.ok(Math.abs(afterDouble - 1.5) < 1e-6, `expected restored alkene bond length 1.5 Å, got ${afterDouble.toFixed(3)} Å`);
    assert.ok(Math.abs(afterAngle - 120) < 4, `expected restored alkene angle near 120°, got ${afterAngle.toFixed(2)}°`);
  });
});
