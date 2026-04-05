import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule, Atom, Bond } from '../../src/core/index.js';
import { parseSMILES } from '../../src/io/index.js';
import { generateResonanceStructures } from '../../src/algorithms/resonance.js';

describe('Atom', () => {
  it('constructs with defaults', () => {
    const a = new Atom('a0', 'C');
    assert.equal(a.id, 'a0');
    assert.equal(a.name, 'C');
    assert.deepEqual(a.tags, []);
    assert.deepEqual(a.bonds, []);
  });

  it('getCharge returns the formal charge', () => {
    assert.equal(new Atom('a0', 'C').getCharge(), 0);
    assert.equal(new Atom('a1', 'N', { charge: 1 }).getCharge(), 1);
    assert.equal(new Atom('a2', 'O', { charge: -1 }).getCharge(), -1);
  });

  it('isAromatic() reflects the stored aromatic flag', () => {
    assert.equal(new Atom('a0', 'C').isAromatic(), false);
    assert.equal(new Atom('a1', 'C', { aromatic: true }).isAromatic(), true);
  });

  it('properties default to safe values when not provided', () => {
    const a = new Atom('a0', 'C');
    assert.equal(a.properties.charge, 0);
    assert.equal(a.properties.aromatic, false);
    assert.equal(a.properties.protons, undefined);
    assert.equal(a.properties.neutrons, undefined);
    assert.equal(a.properties.electrons, undefined);
    assert.equal(a.properties.group, 0);
    assert.equal(a.properties.period, 0);
    assert.deepEqual(a.properties.reaction, { atomMap: null });
    assert.equal(a.properties.radical, 0);
  });

  it('accepts properties via constructor', () => {
    const a = new Atom('a0', 'C', {
      protons: 6,
      neutrons: 6.0107,
      electrons: 6,
      group: 14,
      period: 2,
      charge: -1,
      aromatic: true,
      radical: 1,
      reaction: { atomMap: 7 }
    });
    assert.equal(a.properties.protons, 6);
    assert.equal(a.properties.neutrons, 6.0107);
    assert.equal(a.properties.electrons, 6);
    assert.equal(a.properties.group, 14);
    assert.equal(a.properties.period, 2);
    assert.equal(a.properties.charge, -1);
    assert.equal(a.properties.aromatic, true);
    assert.deepEqual(a.properties.reaction, { atomMap: 7 });
    assert.equal(a.properties.radical, 1);
  });

  it('uuid is a unique string per instance', () => {
    const a = new Atom('a0', 'C');
    const b = new Atom('a1', 'N');
    assert.equal(typeof a.uuid, 'string');
    assert.match(a.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(a.uuid, b.uuid);
  });

  it('tags defaults to independent [] per instance', () => {
    const a = new Atom('a0', 'C');
    const b = new Atom('a1', 'N');
    a.tags.push('test');
    assert.deepEqual(b.tags, []);
  });

  it('setCharge updates charge and derives electrons from protons', () => {
    const a = new Atom('a0', 'N', { protons: 7, electrons: 7 });
    a.setCharge(1);
    assert.equal(a.properties.charge, 1);
    assert.equal(a.properties.electrons, 6); // 7 - 1
    a.setCharge(-1);
    assert.equal(a.properties.charge, -1);
    assert.equal(a.properties.electrons, 8); // 7 - (-1)
  });

  it('setCharge leaves electrons unchanged when protons is not set', () => {
    const a = new Atom('a0', 'C'); // protons = undefined
    a.setCharge(1);
    assert.equal(a.properties.charge, 1);
    assert.equal(a.properties.electrons, undefined);
  });

  it('setCharge returns the atom for chaining', () => {
    const a = new Atom('a0', 'O', { protons: 8, electrons: 8 }).setCharge(-1);
    assert.equal(a.properties.charge, -1);
  });

  it('setAromatic stores the aromatic flag and returns the atom', () => {
    const a = new Atom('a0', 'C');
    const ret = a.setAromatic(true);
    assert.equal(a.isAromatic(), true);
    assert.equal(ret, a);
  });

  it('setAromatic rejects non-boolean values', () => {
    const a = new Atom('a0', 'C');
    assert.throws(() => a.setAromatic(1), TypeError);
    assert.throws(() => a.setAromatic('true'), TypeError);
  });

  it('getRadical returns the explicit radical count', () => {
    assert.equal(new Atom('a0', 'C').getRadical(), 0);
    assert.equal(new Atom('a1', 'C', { radical: 1 }).getRadical(), 1);
  });

  it('getHybridization returns the stored hybridization or null', () => {
    assert.equal(new Atom('a0', 'C').getHybridization(), null);
    assert.equal(new Atom('a1', 'C', {}).setHybridization('sp2').getHybridization(), 'sp2');
  });

  it('getAtomMap returns the stored reaction atom map or null', () => {
    assert.equal(new Atom('a0', 'C').getAtomMap(), null);
    assert.equal(new Atom('a1', 'C', { reaction: { atomMap: 3 } }).getAtomMap(), 3);
  });

  it('setRadical stores the radical count and returns the atom', () => {
    const a = new Atom('a0', 'C');
    const ret = a.setRadical(1);
    assert.equal(a.properties.radical, 1);
    assert.equal(ret, a);
  });

  it('setRadical rejects unsupported values', () => {
    const a = new Atom('a0', 'C');
    assert.throws(() => a.setRadical(-1), RangeError);
    assert.throws(() => a.setRadical(1.5), RangeError);
    assert.throws(() => a.setRadical(3), RangeError);
  });

  it('isRadical() reflects whether the atom carries explicit radicals', () => {
    const a = new Atom('a0', 'C');
    assert.equal(a.isRadical(), false);
    a.setRadical(1);
    assert.equal(a.isRadical(), true);
  });

  it('setHybridization stores the hybridization and returns the atom', () => {
    const a = new Atom('a0', 'C');
    const ret = a.setHybridization('sp3');
    assert.equal(a.getHybridization(), 'sp3');
    assert.equal(ret, a);
    a.setHybridization(null);
    assert.equal(a.getHybridization(), null);
  });

  it('setHybridization rejects unsupported values', () => {
    const a = new Atom('a0', 'C');
    assert.throws(() => a.setHybridization('sp4'), RangeError);
    assert.throws(() => a.setHybridization(1), RangeError);
  });

  it('setAtomMap stores the reaction atom map and returns the atom', () => {
    const a = new Atom('a0', 'C');
    const ret = a.setAtomMap(9);
    assert.deepEqual(a.properties.reaction, { atomMap: 9 });
    assert.equal(ret, a);
  });

  it('setAtomMap rejects unsupported values', () => {
    const a = new Atom('a0', 'C');
    assert.throws(() => a.setAtomMap(-1), RangeError);
    assert.throws(() => a.setAtomMap(1.5), RangeError);
  });

  it('resolveElement sets group, period, protons, neutrons, electrons from symbol', () => {
    const a = new Atom('a0', 'C');
    assert.equal(a.properties.group, 0); // not yet resolved
    a.resolveElement();
    assert.equal(a.properties.group, 14);
    assert.equal(a.properties.period, 2);
    assert.equal(a.properties.protons, 6);
    assert.equal(a.properties.electrons, 6);
  });

  it('resolveElement returns the atom for chaining', () => {
    const a = new Atom('a0', 'O').resolveElement();
    assert.equal(a.properties.group, 16);
  });

  it('resolveElement no-ops for unknown symbol', () => {
    const a = new Atom('a0', 'Xx').resolveElement();
    assert.equal(a.properties.group, 0);
  });

  it('computeCharge — p-block neutral atoms return 0', () => {
    // C group 14: neutral valence = 4 bonds
    assert.equal(new Atom('a', 'C', { group: 14 }).computeCharge(4), 0);
    // N group 15: neutral valence = 3 bonds
    assert.equal(new Atom('a', 'N', { group: 15 }).computeCharge(3), 0);
    // O group 16: neutral valence = 2 bonds
    assert.equal(new Atom('a', 'O', { group: 16 }).computeCharge(2), 0);
    // F group 17: neutral valence = 1 bond
    assert.equal(new Atom('a', 'F', { group: 17 }).computeCharge(1), 0);
  });

  it('computeCharge — p-block cations and anions', () => {
    // N with 4 bonds → NH4+ charge +1
    assert.equal(new Atom('a', 'N', { group: 15 }).computeCharge(4), +1);
    // N with 2 bonds → NH2- charge -1
    assert.equal(new Atom('a', 'N', { group: 15 }).computeCharge(2), -1);
    // O with 3 bonds → H3O+ charge +1
    assert.equal(new Atom('a', 'O', { group: 16 }).computeCharge(3), +1);
    // O with 1 bond → OH- charge -1
    assert.equal(new Atom('a', 'O', { group: 16 }).computeCharge(1), -1);
  });

  it('computeCharge — H (group 1) neutral at 1 bond', () => {
    assert.equal(new Atom('a', 'H', { group: 1 }).computeCharge(1), 0);
    assert.equal(new Atom('a', 'H', { group: 1 }).computeCharge(0), -1); // H-
  });

  it('computeCharge — transition metals return 0', () => {
    assert.equal(new Atom('a', 'Fe', { group: 8 }).computeCharge(3), 0);
  });

  it('computeCharge — no group set returns 0', () => {
    assert.equal(new Atom('a', 'C').computeCharge(2), 0);
  });

  it('parseSMILES sets element properties on atoms', () => {
    const mol = parseSMILES('C');
    const carbon = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.equal(carbon.properties.protons, 6);
    assert.equal(carbon.properties.electrons, 6);
    assert.equal(carbon.properties.group, 14);
    assert.equal(carbon.properties.period, 2);
  });

  it('isInRing — atom in a 3-membered ring returns true', () => {
    // Triangle: A-B-C-A
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    mol.addAtom('B', 'C');
    mol.addAtom('C', 'C');
    mol.addBond('b1', 'A', 'B');
    mol.addBond('b2', 'B', 'C');
    mol.addBond('b3', 'C', 'A');
    assert.equal(mol.atoms.get('A').isInRing(mol), true);
    assert.equal(mol.atoms.get('B').isInRing(mol), true);
  });

  it('isInRing — atom in a 6-membered ring returns true', () => {
    // Cyclohexane ring built manually
    const mol = new Molecule();
    for (let i = 0; i < 6; i++) {
      mol.addAtom(`C${i}`, 'C');
    }
    for (let i = 0; i < 6; i++) {
      mol.addBond(`b${i}`, `C${i}`, `C${(i + 1) % 6}`);
    }
    for (let i = 0; i < 6; i++) {
      assert.equal(mol.atoms.get(`C${i}`).isInRing(mol), true);
    }
  });

  it('isInRing — terminal atom in a chain returns false', () => {
    // Linear chain: A-B-C, end atoms A and C are not in a ring
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    mol.addAtom('B', 'C');
    mol.addAtom('C', 'C');
    mol.addBond('b1', 'A', 'B');
    mol.addBond('b2', 'B', 'C');
    assert.equal(mol.atoms.get('A').isInRing(mol), false);
    assert.equal(mol.atoms.get('C').isInRing(mol), false);
  });

  it('isInRing — middle atom in an open chain returns false', () => {
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    mol.addAtom('B', 'C');
    mol.addAtom('C', 'C');
    mol.addBond('b1', 'A', 'B');
    mol.addBond('b2', 'B', 'C');
    assert.equal(mol.atoms.get('B').isInRing(mol), false);
  });

  it('isInRing — isolated atom returns false', () => {
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    assert.equal(mol.atoms.get('A').isInRing(mol), false);
  });

  it('isInRing — degree-1 atom (pendant) returns false', () => {
    // Ring with one pendant: B-A-ring. B has degree 1.
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    mol.addAtom('B', 'C');
    mol.addAtom('C', 'C');
    mol.addAtom('D', 'C');
    mol.addBond('b1', 'A', 'C');
    mol.addBond('b2', 'C', 'D');
    mol.addBond('b3', 'D', 'A');
    mol.addBond('b4', 'A', 'B');
    assert.equal(mol.atoms.get('B').isInRing(mol), false);
    assert.equal(mol.atoms.get('A').isInRing(mol), true);
  });
});

describe('Molecule cloning', () => {
  it('preserves non-constructor atom and bond properties such as localized aromatic orders', () => {
    const mol = parseSMILES('C1=CC2=CC3=CC=CC=C3C=C2C=C1');
    const clone = mol.clone();

    const aromaticOrders = [...clone.bonds.values()].filter(bond => bond.properties.aromatic).map(bond => bond.properties.localizedOrder);
    assert.equal(aromaticOrders.length, 16);
    assert.ok(aromaticOrders.every(order => order === 1 || order === 2));
  });
});

describe('Bond', () => {
  it('constructs with defaults', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.equal(b.id, 'b0');
    assert.deepEqual(b.atoms, ['a0', 'a1']);
    assert.deepEqual(b.tags, []);
    assert.equal(b.properties.order, 1);
    assert.equal(b.properties.aromatic, false);
  });

  it('accepts properties via constructor', () => {
    const b = new Bond('b0', ['a0', 'a1'], { order: 2, aromatic: true });
    assert.equal(b.properties.order, 2);
    assert.equal(b.properties.aromatic, true);
  });

  it('getOrder returns bond order', () => {
    assert.equal(new Bond('b0', ['a0', 'a1']).getOrder(), 1);
    assert.equal(new Bond('b0', ['a0', 'a1'], { order: 2 }).getOrder(), 2);
  });

  it('getOtherAtom returns the opposite atom id', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.equal(b.getOtherAtom('a0'), 'a1');
    assert.equal(b.getOtherAtom('a1'), 'a0');
  });

  it('getOtherAtom returns null for unknown id', () => {
    assert.equal(new Bond('b0', ['a0', 'a1']).getOtherAtom('a99'), null);
  });

  it('connects returns true when bond links the two atoms (either order)', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.equal(b.connects('a0', 'a1'), true);
    assert.equal(b.connects('a1', 'a0'), true);
    assert.equal(b.connects('a0', 'a2'), false);
  });

  it('uuid is a unique string per instance', () => {
    const b1 = new Bond('b0', ['a0', 'a1']);
    const b2 = new Bond('b1', ['a1', 'a2']);
    assert.equal(typeof b1.uuid, 'string');
    assert.match(b1.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(b1.uuid, b2.uuid);
  });
});

describe('Atom – chirality helpers', () => {
  it('stores chirality passed to constructor', () => {
    const a = new Atom(null, 'C', { chirality: 'S' });
    assert.equal(a.properties.chirality, 'S');
  });

  it('defaults chirality to null', () => {
    const a = new Atom(null, 'C');
    assert.equal(a.properties.chirality, null);
  });

  it('getChirality() returns stored value', () => {
    const a = new Atom(null, 'C', { chirality: 'R' });
    assert.equal(a.getChirality(), 'R');
  });

  it('setChirality stores R and returns this', () => {
    const a = new Atom(null, 'C');
    const ret = a.setChirality('R');
    assert.equal(a.getChirality(), 'R');
    assert.equal(ret, a);
  });

  it('setChirality stores S', () => {
    const a = new Atom(null, 'C');
    a.setChirality('S');
    assert.equal(a.getChirality(), 'S');
  });

  it('setChirality(null) clears chirality', () => {
    const a = new Atom(null, 'C', { chirality: 'R' });
    a.setChirality(null);
    assert.equal(a.getChirality(), null);
  });

  it('setChirality throws RangeError for invalid value', () => {
    const a = new Atom(null, 'C');
    assert.throws(() => a.setChirality('@'), RangeError);
    assert.throws(() => a.setChirality('@@'), RangeError);
    assert.throws(() => a.setChirality('bad'), RangeError);
    assert.throws(() => a.setChirality(1), RangeError);
  });

  it('isChiralCenter() true when chirality is R or S', () => {
    assert.equal(new Atom(null, 'C', { chirality: 'R' }).isChiralCenter(), true);
    assert.equal(new Atom(null, 'C', { chirality: 'S' }).isChiralCenter(), true);
  });

  it('isChiralCenter() false when chirality is null', () => {
    assert.equal(new Atom(null, 'C').isChiralCenter(), false);
  });

  it('isChiralCenter() false after setChirality(null)', () => {
    const a = new Atom(null, 'C', { chirality: 'S' });
    a.setChirality(null);
    assert.equal(a.isChiralCenter(), false);
  });

  it('setChirality with eligible atom succeeds', () => {
    // C[CH](F)Cl — the central C has 4 distinct substituents
    const mol = parseSMILES('C[CH](F)Cl');
    const center = [...mol.atoms.values()].find(a => {
      if (a.name !== 'C') {
        return false;
      }
      const nbs = a.bonds.map(bId => mol.atoms.get(mol.bonds.get(bId)?.getOtherAtom(a.id))?.name);
      return nbs.includes('F') && nbs.includes('Cl');
    });
    assert.ok(center, 'central atom found');
    assert.doesNotThrow(() => center.setChirality('R', mol));
    assert.equal(center.getChirality(), 'R');
  });

  it('setChirality with ineligible atom (alkene carbon) throws', () => {
    const mol = parseSMILES('C=C');
    const atom = mol.atoms.values().next().value;
    assert.throws(() => atom.setChirality('R', mol), Error);
  });

  it('setChirality with ineligible atom (symmetric substituents) throws', () => {
    // CC(C)F — central C has two identical CH3 groups
    const mol = parseSMILES('CC(C)F');
    const center = [...mol.atoms.values()].find(a => {
      if (a.name !== 'C') {
        return false;
      }
      const nbs = a.bonds.map(bId => mol.atoms.get(mol.bonds.get(bId)?.getOtherAtom(a.id))?.name);
      return nbs.includes('F') && nbs.filter(n => n === 'C').length >= 2;
    });
    assert.ok(center, 'center atom found');
    assert.throws(() => center.setChirality('S', mol), Error);
  });

  it('setChirality(null, mol) clears designation even for ineligible atoms', () => {
    const mol = parseSMILES('C=C');
    const atom = mol.atoms.values().next().value;
    atom.properties.chirality = 'R'; // force-set bypassing the guard
    assert.doesNotThrow(() => atom.setChirality(null, mol));
    assert.equal(atom.getChirality(), null);
  });

  it('setChirality without mol skips eligibility check (backward compat)', () => {
    const mol = parseSMILES('C=C');
    const atom = mol.atoms.values().next().value;
    assert.doesNotThrow(() => atom.setChirality('R')); // no mol → no check
    assert.equal(atom.getChirality(), 'R');
  });
});

describe('Bond – stereo helpers', () => {
  it('hasStereo() true for / bond', () => {
    const b = new Bond(null, ['1', '2'], { stereo: '/' });
    assert.equal(b.hasStereo(), true);
  });

  it('hasStereo() false for plain bond', () => {
    const b = new Bond(null, ['1', '2']);
    assert.equal(b.hasStereo(), false);
  });

  it('getStereo() returns stored value', () => {
    const b = new Bond(null, ['1', '2'], { stereo: '\\' });
    assert.equal(b.getStereo(), '\\');
  });

  it('setStereo stores / and returns this', () => {
    const b = new Bond(null, ['1', '2']);
    const ret = b.setStereo('/');
    assert.equal(b.getStereo(), '/');
    assert.equal(ret, b);
  });

  it('setStereo stores \\', () => {
    const b = new Bond(null, ['1', '2']);
    b.setStereo('\\');
    assert.equal(b.getStereo(), '\\');
  });

  it('setStereo(null) clears stereo', () => {
    const b = new Bond(null, ['1', '2'], { stereo: '/' });
    b.setStereo(null);
    assert.equal(b.getStereo(), null);
    assert.equal(b.hasStereo(), false);
  });

  it('setStereo throws RangeError for invalid value', () => {
    const b = new Bond(null, ['1', '2']);
    assert.throws(() => b.setStereo('bad'), RangeError);
    assert.throws(() => b.setStereo('E'), RangeError);
    assert.throws(() => b.setStereo(1), RangeError);
  });
});

describe('Molecule', () => {
  it('uuid is a unique string per instance', () => {
    const m1 = new Molecule();
    const m2 = new Molecule();
    assert.equal(typeof m1.uuid, 'string');
    assert.match(m1.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(m1.uuid, m2.uuid);
  });

  it('starts empty with default id, name, tags, properties', () => {
    const mol = new Molecule();
    assert.ok(mol.id !== '' && mol.id !== null && mol.id !== undefined, 'id should be auto-generated');
    assert.equal(mol.name, '');
    assert.deepEqual(mol.tags, []);
    assert.deepEqual(mol.properties, {});
    assert.equal(mol.atomCount, 0);
    assert.equal(mol.bondCount, 0);
  });

  it('adds atoms', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'O');
    assert.equal(mol.atomCount, 2);
  });

  it('addAtom resolves periodic-table fields from the element name', () => {
    const mol = new Molecule();
    const atom = mol.addAtom('a0', 'N', { charge: 1 });
    assert.equal(atom.properties.group, 15);
    assert.equal(atom.properties.period, 2);
    assert.equal(atom.properties.protons, 7);
    assert.equal(atom.properties.neutrons, 7.0067);
    assert.equal(atom.properties.electrons, 6);
  });

  it('addAtom preserves explicitly provided element-property overrides', () => {
    const mol = new Molecule();
    const atom = mol.addAtom('a0', 'C', { neutrons: 7, electrons: 99, charge: -1 });
    assert.equal(atom.properties.protons, 6);
    assert.equal(atom.properties.neutrons, 7);
    assert.equal(atom.properties.electrons, 99);
    assert.equal(atom.properties.charge, -1);
  });

  it('auto-generated atom ids restart per molecule', () => {
    const mol1 = new Molecule();
    const mol2 = new Molecule();
    assert.equal(mol1.addAtom(null, 'C').id, '0');
    assert.equal(mol1.addAtom(null, 'O').id, '1');
    assert.equal(mol2.addAtom(null, 'N').id, '0');
    assert.equal(mol2.addAtom(null, 'S').id, '1');
  });

  it('throws when adding duplicate atom id', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    assert.throws(() => mol.addAtom('a0', 'N'), /already exists/);
  });

  it('adds bonds and updates atom.bonds', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    assert.equal(mol.bondCount, 1);
    assert.deepEqual(mol.atoms.get('a0').bonds, ['b0']);
    assert.deepEqual(mol.atoms.get('a1').bonds, ['b0']);
  });

  it('auto-generated bond ids restart per molecule', () => {
    const mol1 = new Molecule();
    const mol2 = new Molecule();
    mol1.addAtom('a0', 'C');
    mol1.addAtom('a1', 'C');
    mol1.addAtom('a2', 'O');
    mol2.addAtom('b0', 'N');
    mol2.addAtom('b1', 'N');
    mol2.addAtom('b2', 'O');

    assert.equal(mol1.addBond(null, 'a0', 'a1', {}, false).id, '0');
    assert.equal(mol1.addBond(null, 'a1', 'a2', {}, false).id, '1');
    assert.equal(mol2.addBond(null, 'b0', 'b1', {}, false).id, '0');
    assert.equal(mol2.addBond(null, 'b1', 'b2', {}, false).id, '1');
  });

  it('throws when adding duplicate bond id', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    assert.throws(() => mol.addBond('b0', 'a0', 'a1', {}, false), /already exists/);
  });

  it('throws on self-loop', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    assert.throws(() => mol.addBond('b0', 'a0', 'a0'), /Self-loop/);
  });

  it('throws on duplicate bond between same atom pair', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    assert.throws(() => mol.addBond('b1', 'a1', 'a0', {}, false), /already exists/);
  });

  it('throws when bonding unknown atoms', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    assert.throws(() => mol.addBond('b0', 'a0', 'a99'));
  });

  it('getNeighbors returns adjacent atom IDs', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    assert.deepEqual(mol.getNeighbors('a1').sort(), ['a0', 'a2']);
  });

  it('getDegree returns bond count', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a0', 'a2', {}, false);
    assert.equal(mol.getDegree('a0'), 2);
    assert.equal(mol.getDegree('a1'), 1);
  });

  it('computeAtomCharge — neutral atoms in bonds', () => {
    // Ethane: each C has 1 C-C bond (order 1) + 3 H bonds (order 1) = 4 total
    const mol = parseSMILES('CC');
    const carbon = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.equal(mol.computeAtomCharge(carbon.id), 0);
  });

  it('computeAtomCharge — returns 0 for unknown id', () => {
    const mol = new Molecule();
    assert.equal(mol.computeAtomCharge('nonexistent'), 0);
  });

  it('computeAtomCharge — double bond raises bond order', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'O', { group: 16 });
    mol.addAtom('a1', 'C', { group: 14 });
    mol.addBond('b0', 'a0', 'a1', { order: 2 }, false);
    // O: totalBondOrder=2, typicalBonds=2 → charge 0
    assert.equal(mol.computeAtomCharge('a0'), 0);
    // C: totalBondOrder=2, typicalBonds=4 → charge -2
    assert.equal(mol.computeAtomCharge('a1'), -2);
  });

  it('setAtomCharge updates atom charge, electrons, and molecular charge', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'N', { protons: 7, electrons: 7, charge: 0 });
    mol.setAtomCharge('a0', 1);
    assert.equal(mol.atoms.get('a0').properties.charge, 1);
    assert.equal(mol.atoms.get('a0').properties.electrons, 6);
    assert.equal(mol.properties.charge, 1);
  });

  it('setAtomCharge returns null for unknown atom', () => {
    assert.equal(new Molecule().setAtomCharge('x', 1), null);
  });

  it('setAtomRadical updates atom radicals and returns the atom', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    const atom = mol.setAtomRadical('a0', 1);
    assert.equal(atom, mol.atoms.get('a0'));
    assert.equal(mol.atoms.get('a0').properties.radical, 1);
  });

  it('setAtomRadical returns null for unknown atom', () => {
    assert.equal(new Molecule().setAtomRadical('x', 1), null);
  });

  it('getCharge returns 0 for neutral molecule', () => {
    const mol = parseSMILES('CC'); // ethane — no charges
    assert.equal(mol.getCharge(), 0);
    assert.equal(mol.properties.charge, 0);
  });

  it('getCharge sums atom charges — methyl cation [CH3+]', () => {
    const mol = parseSMILES('[CH3+]');
    assert.equal(mol.getCharge(), 1);
    assert.equal(mol.properties.charge, 1);
  });

  it('getCharge sums atom charges — sodium chloride [Na+].[Cl-]', () => {
    const mol = parseSMILES('[Na+].[Cl-]');
    assert.equal(mol.getCharge(), 0);
  });

  it('properties recompute automatically after addAtom', () => {
    const mol = new Molecule();
    assert.equal(mol.properties.charge, undefined);
    mol.addAtom('a0', 'C', { charge: 0 });
    assert.equal(mol.properties.charge, 0);
    assert.deepEqual(mol.properties.formula, { C: 1 });
    assert.equal(mol.name, 'C');
    mol.addAtom('a1', 'N', { charge: 1 });
    assert.equal(mol.properties.charge, 1);
    assert.deepEqual(mol.properties.formula, { C: 1, N: 1 });
    assert.equal(mol.name, 'CN');
  });

  it('properties recompute automatically after removeAtom', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C', { charge: 1 });
    mol.addAtom('a1', 'N', { charge: -1 });
    assert.equal(mol.properties.charge, 0);
    assert.deepEqual(mol.properties.formula, { C: 1, N: 1 });
    mol.removeAtom('a0');
    assert.equal(mol.properties.charge, -1);
    assert.deepEqual(mol.properties.formula, { N: 1 });
    assert.equal(mol.name, 'N');
  });

  it('getFormula returns element counts', () => {
    const mol = parseSMILES('c1ccccc1'); // benzene C6H6
    assert.deepEqual(mol.getFormula(), { C: 6, H: 6 });
  });

  it('getName returns CHNOPS-ordered formula string', () => {
    const mol = parseSMILES('c1ccccc1');
    assert.equal(mol.getName(), 'C6H6');
  });

  it('getFormula keys follow CHNOPS order', () => {
    // glycine NCC(=O)O → C2H5NO2: CHNOPS order = C, H, N, O
    const mol = parseSMILES('NCC(=O)O');
    const keys = Object.keys(mol.getFormula());
    assert.ok(keys.indexOf('C') < keys.indexOf('N'));
    assert.ok(keys.indexOf('H') < keys.indexOf('N'));
    assert.ok(keys.indexOf('N') < keys.indexOf('O'));
  });

  it('getName puts S after O (CHNOPS order)', () => {
    // methanethiol CCS → C2H6S: S comes after C and H
    const mol = parseSMILES('CCS');
    const keys = Object.keys(mol.getFormula());
    assert.ok(keys.indexOf('C') < keys.indexOf('S'));
    assert.ok(keys.indexOf('H') < keys.indexOf('S'));
  });

  it('getMass returns molecular mass', () => {
    const mol = parseSMILES('c1ccccc1'); // benzene ≈ 78.114
    assert.ok(Math.abs(mol.getMass() - 78.114) < 0.01);
  });

  it('parseSMILES populates mol.properties.formula, mol.properties.mass, mol.name', () => {
    const mol = parseSMILES('CCO'); // ethanol C2H6O
    assert.deepEqual(mol.properties.formula, { C: 2, H: 6, O: 1 });
    assert.ok(Math.abs(mol.properties.mass - 46.069) < 0.01);
    assert.equal(mol.name, 'C2H6O');
  });

  it('removeAtom deletes atom and its bonds', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.removeAtom('a0');
    assert.equal(mol.atomCount, 1);
    assert.equal(mol.bondCount, 0);
    assert.deepEqual(mol.atoms.get('a1').bonds, []);
  });

  it('removeBond prunes atoms that become isolated', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'O');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.removeBond('b0');
    assert.equal(mol.bondCount, 0);
    assert.equal(mol.atomCount, 0); // both atoms had only this bond
  });

  it('removeBond keeps atoms that still have other bonds', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'O');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    mol.removeBond('b0'); // a0 becomes isolated, a1 still has b1
    assert.equal(mol.atomCount, 2); // a1 and a2 remain
    assert.equal(mol.bondCount, 1);
    assert.equal(mol.atoms.has('a0'), false);
  });

  it('removeBond recomputes formula, mass, name, charge', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C', { group: 14 });
    mol.addAtom('a1', 'O', { group: 16 });
    mol.addBond('b0', 'a0', 'a1', {}, false);
    // after removal both atoms are isolated and get pruned
    mol.removeBond('b0');
    assert.equal(mol.atomCount, 0);
    assert.deepEqual(mol.properties.formula, {});
    assert.equal(mol.properties.mass, 0);
    assert.equal(mol.properties.charge, 0);
    assert.equal(mol.name, '');
  });

  it('repairImplicitHydrogens restores local valence without moving surviving heavy atoms', () => {
    const mol = parseSMILES('CCO');
    const oxygen = [...mol.atoms.values()].find(atom => atom.name === 'O');
    assert.ok(oxygen);

    const alcoholCarbon = oxygen.getNeighbors(mol).find(atom => atom.name === 'C');
    assert.ok(alcoholCarbon);
    const oxygenHydrogens = oxygen
      .getNeighbors(mol)
      .filter(atom => atom.name === 'H')
      .map(atom => atom.id);

    alcoholCarbon.x = 12;
    alcoholCarbon.y = -3;

    mol.removeAtom(oxygen.id);
    for (const hId of oxygenHydrogens) {
      mol.removeAtom(hId);
    }
    mol.repairImplicitHydrogens([alcoholCarbon.id]);

    assert.deepEqual(mol.getFormula(), { C: 2, H: 6 });
    assert.equal(alcoholCarbon.getNeighbors(mol).filter(atom => atom.name === 'H').length, 3);
    assert.equal(alcoholCarbon.x, 12);
    assert.equal(alcoholCarbon.y, -3);

    for (const hAtom of alcoholCarbon.getNeighbors(mol).filter(atom => atom.name === 'H' && atom.visible === false)) {
      assert.equal(hAtom.x, alcoholCarbon.x);
      assert.equal(hAtom.y, alcoholCarbon.y);
      assert.equal(hAtom.properties.protons, 1);
      assert.equal(hAtom.properties.electrons, 1);
    }
  });

  it('repairImplicitHydrogens respects explicit radical counts', () => {
    const mol = new Molecule();
    const carbon = mol.addAtom('c0', 'C');
    carbon.resolveElement();
    mol.setAtomRadical('c0', 1);

    mol.repairImplicitHydrogens(['c0']);

    const hydrogenNeighbors = carbon.getHydrogenNeighbors(mol);
    assert.equal(hydrogenNeighbors.length, 3);
    assert.equal(carbon.properties.radical, 1);
  });

  it('clearStereoAnnotations removes local atom and bond stereo metadata', () => {
    const chiralMol = parseSMILES('C[C@@H](F)Cl');
    const center = [...chiralMol.atoms.values()].find(atom => atom.properties.chirality);
    assert.ok(center);

    chiralMol.clearStereoAnnotations([center.id]);
    assert.equal(center.properties.chirality, null);
    assert.deepEqual(chiralMol.getChiralCenters(), []);

    const alkeneMol = parseSMILES('F/C=C/F');
    const stereoBondsBefore = [...alkeneMol.bonds.values()].filter(bond => bond.properties.stereo !== null);
    assert.ok(stereoBondsBefore.length > 0);

    const affectedAtomIds = new Set();
    for (const bond of stereoBondsBefore) {
      affectedAtomIds.add(bond.atoms[0]);
      affectedAtomIds.add(bond.atoms[1]);
    }

    alkeneMol.clearStereoAnnotations(affectedAtomIds);
    assert.equal([...alkeneMol.bonds.values()].filter(bond => bond.properties.stereo !== null).length, 0);
  });

  it('isAtomInRing — delegates to Atom#isInRing', () => {
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    mol.addAtom('B', 'C');
    mol.addAtom('C', 'C');
    mol.addBond('b1', 'A', 'B');
    mol.addBond('b2', 'B', 'C');
    mol.addBond('b3', 'C', 'A');
    assert.equal(mol.isAtomInRing('A'), true);
    assert.equal(mol.isAtomInRing('B'), true);
  });

  it('isAtomInRing — returns false for unknown atom id', () => {
    const mol = new Molecule();
    assert.equal(mol.isAtomInRing('nonexistent'), false);
  });

  it('isAtomInRing — benzene atoms (from parseSMILES) are all in ring', () => {
    const mol = parseSMILES('c1ccccc1');
    const carbonAtoms = [...mol.atoms.values()].filter(a => a.name === 'C');
    for (const atom of carbonAtoms) {
      assert.equal(mol.isAtomInRing(atom.id), true, `${atom.id} should be in a ring`);
    }
  });

  it('isAtomInRing — chain atoms (from parseSMILES propane) are not in ring', () => {
    const mol = parseSMILES('CCC');
    const carbonAtoms = [...mol.atoms.values()].filter(a => a.name === 'C');
    for (const atom of carbonAtoms) {
      assert.equal(mol.isAtomInRing(atom.id), false, `${atom.id} should not be in a ring`);
    }
  });
});

// ---------------------------------------------------------------------------
// Bond — new methods
// ---------------------------------------------------------------------------

describe('Bond#bondedTo', () => {
  it('returns true for either atom in the bond', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.equal(b.bondedTo('a0'), true);
    assert.equal(b.bondedTo('a1'), true);
  });

  it('returns false for an atom not in the bond', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.equal(b.bondedTo('a2'), false);
  });
});

describe('Bond#getPiOrder', () => {
  it('single bond → 0', () => assert.equal(new Bond('b', ['a', 'b'], { order: 1 }).getPiOrder(), 0));
  it('double bond → 1', () => assert.equal(new Bond('b', ['a', 'b'], { order: 2 }).getPiOrder(), 1));
  it('triple bond → 2', () => assert.equal(new Bond('b', ['a', 'b'], { order: 3 }).getPiOrder(), 2));
});

describe('Bond#isRotatable', () => {
  it('single bond between two internal carbons is rotatable (butane central bond)', () => {
    // CC-CC: central bond b1 between a1 and a2 — each has another heavy neighbor
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addAtom('a3', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    mol.addBond('b2', 'a2', 'a3', {}, false);
    assert.equal(mol.bonds.get('b1').isRotatable(mol), true);
  });

  it('terminal bond is not rotatable', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    assert.equal(mol.bonds.get('b0').isRotatable(mol), false);
  });

  it('double bond is not rotatable', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addAtom('a3', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', { order: 2 }, false);
    mol.addBond('b2', 'a2', 'a3', {}, false);
    assert.equal(mol.bonds.get('b1').isRotatable(mol), false);
  });

  it('aromatic bond is not rotatable', () => {
    const mol = parseSMILES('c1ccccc1');
    const aromaticBond = [...mol.bonds.values()].find(b => b.properties.aromatic);
    assert.equal(aromaticBond.isRotatable(mol), false);
  });

  it('C-H bond is not rotatable', () => {
    const mol = parseSMILES('CC');
    const chBond = [...mol.bonds.values()].find(b => {
      return mol.atoms.get(b.atoms[0])?.name === 'H' || mol.atoms.get(b.atoms[1])?.name === 'H';
    });
    assert.equal(chBond.isRotatable(mol), false);
  });
});

// ---------------------------------------------------------------------------
// Atom — new methods
// ---------------------------------------------------------------------------

describe('Atom#getValence', () => {
  it('single bond → 1', () => {
    const mol = parseSMILES('CC');
    const c = [...mol.atoms.values()].find(a => a.name === 'C');
    // Each C in ethane: 1 C-C + 3 C-H = 4
    assert.equal(c.getValence(mol), 4);
  });

  it('double bond contributes 2', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', { order: 2 }, false);
    assert.equal(mol.atoms.get('a0').getValence(mol), 2);
  });
});

describe('Atom#isSaturated', () => {
  it('methane C is saturated (valence 4 used)', () => {
    const mol = parseSMILES('C');
    const c = mol.atoms.values().next().value;
    assert.equal(c.isSaturated(mol), true);
  });

  it('ethylene C=C is not saturated (heavy bond order only 2 for C with valence 4)', () => {
    // C in CH2=CH2: C-C(order2) + 2 C-H = bond order 4 total → actually saturated by count
    // Test unsaturation via a bare C with one double bond and no H
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', { order: 2 }, false);
    // a0 has total bond order 2, neutral valence 4 → not saturated
    assert.equal(mol.atoms.get('a0').isSaturated(mol), false);
  });

  it('water O is saturated', () => {
    const mol = parseSMILES('O');
    const o = mol.atoms.values().next().value;
    assert.equal(o.isSaturated(mol), true);
  });
});

describe('Atom#implicitHydrogenCount', () => {
  it('bare C atom (no bonds) needs 4 H', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    assert.equal(mol.atoms.get('a0').implicitHydrogenCount(mol), 4);
  });

  it('C with one heavy neighbor needs 3 H', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    assert.equal(mol.atoms.get('a0').implicitHydrogenCount(mol), 3);
  });

  it('C with one double bond needs 2 H', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', { order: 2 }, false);
    assert.equal(mol.atoms.get('a0').implicitHydrogenCount(mol), 2);
  });

  it('O with no bonds needs 2 H', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'O');
    assert.equal(mol.atoms.get('a0').implicitHydrogenCount(mol), 2);
  });

  it('C with all H explicit shows 0 implicit H remaining', () => {
    // parseSMILES('CC') gives each C bonds: 1 C-C (order 1) + 3 C-H (order 1) = valence 4
    // neutral valence 4 − total valence 4 = 0 implicit H
    const mol = parseSMILES('CC');
    const c = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.equal(c.implicitHydrogenCount(mol), 0);
  });

  it('explicit radical count reduces the implicit hydrogen count', () => {
    const mol = new Molecule();
    const c = mol.addAtom('a0', 'C');
    c.resolveElement();
    c.setRadical(1);
    assert.equal(c.implicitHydrogenCount(mol), 3);
  });
});

describe('Atom#getHeavyNeighbors / getHydrogenNeighbors', () => {
  it('propane middle C has 2 heavy and 2 H neighbors', () => {
    const mol = parseSMILES('CCC');
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const middle = carbons.find(c => c.getHeavyNeighbors(mol).length === 2);
    assert.equal(middle.getHeavyNeighbors(mol).length, 2);
    assert.equal(middle.getHydrogenNeighbors(mol).length, 2);
    assert.ok(middle.getHeavyNeighbors(mol).every(a => a.name === 'C'));
    assert.ok(middle.getHydrogenNeighbors(mol).every(a => a.name === 'H'));
  });

  it('terminal C has 1 heavy and 3 H neighbors', () => {
    const mol = parseSMILES('CCC');
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const terminal = carbons.find(c => c.getHeavyNeighbors(mol).length === 1);
    assert.equal(terminal.getHeavyNeighbors(mol).length, 1);
    assert.equal(terminal.getHydrogenNeighbors(mol).length, 3);
  });
});

// ---------------------------------------------------------------------------
// Molecule — new methods
// ---------------------------------------------------------------------------

describe('Molecule#getBond', () => {
  it('returns the bond connecting two atoms', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    assert.equal(mol.getBond('a0', 'a1')?.id, 'b0');
    assert.equal(mol.getBond('a1', 'a0')?.id, 'b0'); // order-independent
  });

  it('returns null when no bond exists', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    assert.equal(mol.getBond('a0', 'a1'), null);
  });
});

describe('Molecule#updateBond', () => {
  it('changes bond order and recomputes properties', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    assert.equal(mol.bonds.get('b0').properties.order, 1);
    mol.updateBond('b0', { order: 2 });
    assert.equal(mol.bonds.get('b0').properties.order, 2);
  });

  it('returns null for unknown bond id', () => {
    assert.equal(new Molecule().updateBond('nope', { order: 2 }), null);
  });
});

describe('Molecule#getPath', () => {
  it('propane: path from end to end is [a0, a1, a2]', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    assert.deepEqual(mol.getPath('a0', 'a2'), ['a0', 'a1', 'a2']);
  });

  it('same atom returns single-element array', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    assert.deepEqual(mol.getPath('a0', 'a0'), ['a0']);
  });

  it('disconnected atoms return null', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    assert.equal(mol.getPath('a0', 'a1'), null);
  });

  it('unknown atom id returns null', () => {
    const mol = new Molecule();
    assert.equal(mol.getPath('x', 'y'), null);
  });
});

describe('Molecule#getRings', () => {
  it('propane (acyclic) has 0 rings', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    assert.equal(mol.getRings().length, 0);
  });

  it('cyclopropane has 1 ring of length 3', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    mol.addBond('b2', 'a2', 'a0', {}, false);
    const rings = mol.getRings();
    assert.equal(rings.length, 1);
    assert.equal(rings[0].length, 3);
  });

  it('benzene (from parseSMILES) has 1 fundamental ring of length 6', () => {
    const mol = parseSMILES('c1ccccc1');
    const rings = mol.getRings();
    assert.equal(rings.length, 1);
    assert.equal(rings[0].length, 6);
  });

  it('bicyclo[2.2.0] (two fused 4-rings) has 2 fundamental rings', () => {
    // Bicyclobutane: a0-a1-a2-a3-a0 and a0-a2 bridge
    const mol = new Molecule();
    for (const id of ['a0', 'a1', 'a2', 'a3']) {
      mol.addAtom(id, 'C');
    }
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    mol.addBond('b2', 'a2', 'a3', {}, false);
    mol.addBond('b3', 'a3', 'a0', {}, false);
    mol.addBond('b4', 'a0', 'a2', {}, false);
    assert.equal(mol.getRings().length, 2);
  });

  it('empty molecule has 0 rings', () => {
    assert.equal(new Molecule().getRings().length, 0);
  });
});

describe('Molecule#getSubgraph', () => {
  it('extracts a subset of atoms and their connecting bonds', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    const sub = mol.getSubgraph(['a0', 'a1']);
    assert.equal(sub.atomCount, 2);
    assert.equal(sub.bondCount, 1);
    assert.equal(sub.bonds.has('b0'), true);
  });

  it('preserves atom and bond IDs', () => {
    const mol = new Molecule();
    mol.addAtom('x', 'N');
    mol.addAtom('y', 'O');
    mol.addBond('bxy', 'x', 'y', {}, false);
    const sub = mol.getSubgraph(['x', 'y']);
    assert.ok(sub.atoms.has('x'));
    assert.ok(sub.bonds.has('bxy'));
  });

  it('boundary bonds are excluded', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    mol.addBond('b1', 'a1', 'a2', {}, false);
    const sub = mol.getSubgraph(['a0', 'a1']); // b1 connects a1→a2 which is outside
    assert.equal(sub.bonds.has('b1'), false);
    assert.equal(sub.atoms.get('a1').bonds.length, 1); // only b0
  });

  it('preserves atom coordinates and visibility', () => {
    const mol = new Molecule();
    const a0 = mol.addAtom('a0', 'C');
    const a1 = mol.addAtom('a1', 'O');
    mol.addBond('b0', 'a0', 'a1', {}, false);

    a0.x = 1.25;
    a0.y = -0.5;
    a0.z = 3;
    a0.visible = false;
    a1.x = -2;
    a1.y = 4.5;
    a1.z = 0;

    const sub = mol.getSubgraph(['a0', 'a1']);
    assert.equal(sub.atoms.get('a0').x, 1.25);
    assert.equal(sub.atoms.get('a0').y, -0.5);
    assert.equal(sub.atoms.get('a0').z, 3);
    assert.equal(sub.atoms.get('a0').visible, false);
    assert.equal(sub.atoms.get('a1').x, -2);
    assert.equal(sub.atoms.get('a1').y, 4.5);
    assert.equal(sub.atoms.get('a1').z, 0);
    assert.equal(sub.atoms.get('a1').visible, true);
  });

  it('retains duplicate-bond protection in the extracted molecule', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);

    const sub = mol.getSubgraph(['a0', 'a1']);
    assert.throws(() => sub.addBond('b1', 'a1', 'a0', {}, false), /already exists/);
  });

  it('does not leak top-level resonance metadata from the source molecule', () => {
    const mol = parseSMILES('c1ccccc1');
    generateResonanceStructures(mol);
    assert.equal(mol.resonanceCount, 2);

    const sub = mol.getSubgraph(['0', '1', '2']);
    assert.equal(sub.properties.resonance, undefined);
    assert.equal(sub.resonanceCount, 1);
  });
});

describe('Molecule#getComponents', () => {
  it('connected molecule returns one component', () => {
    const mol = parseSMILES('CCC');
    assert.equal(mol.getComponents().length, 1);
  });

  it('disconnected molecule splits into correct components', () => {
    // Build two separate C atoms with no bond between them
    const mol = new Molecule();
    mol.addAtom('c1', 'C');
    mol.addAtom('c2', 'C');
    const parts = mol.getComponents();
    assert.equal(parts.length, 2);
    for (const p of parts) {
      assert.equal(p.atomCount, 1);
    }
  });

  it('each component preserves its atoms and formula', () => {
    const mol = new Molecule();
    mol.addAtom('n1', 'N');
    mol.addAtom('o1', 'O');
    const parts = mol.getComponents();
    const names = parts.map(p => p.name).sort();
    assert.ok(names.includes('N'));
    assert.ok(names.includes('O'));
  });
});

describe('Molecule#clone', () => {
  it('produces an independent deep copy', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);
    const copy = mol.clone();
    assert.equal(copy.atomCount, mol.atomCount);
    assert.equal(copy.bondCount, mol.bondCount);
    // Mutating original does not affect clone
    mol.removeAtom('a0');
    assert.equal(copy.atomCount, 2);
  });

  it('preserves atom and bond IDs', () => {
    const mol = new Molecule();
    mol.addAtom('x', 'N');
    mol.addAtom('y', 'O');
    mol.addBond('bxy', 'x', 'y', {}, false);
    const copy = mol.clone();
    assert.ok(copy.atoms.has('x'));
    assert.ok(copy.bonds.has('bxy'));
  });

  it('preserves atom coordinates and visibility', () => {
    const mol = new Molecule();
    const x = mol.addAtom('x', 'N');
    const y = mol.addAtom('y', 'O');
    mol.addBond('bxy', 'x', 'y', {}, false);

    x.x = 10;
    x.y = 11;
    x.z = 12;
    x.visible = false;
    y.x = -1;
    y.y = -2;
    y.z = -3;

    const copy = mol.clone();
    assert.equal(copy.atoms.get('x').x, 10);
    assert.equal(copy.atoms.get('x').y, 11);
    assert.equal(copy.atoms.get('x').z, 12);
    assert.equal(copy.atoms.get('x').visible, false);
    assert.equal(copy.atoms.get('y').x, -1);
    assert.equal(copy.atoms.get('y').y, -2);
    assert.equal(copy.atoms.get('y').z, -3);
    assert.equal(copy.atoms.get('y').visible, true);
  });

  it('preserves explicit radical counts', () => {
    const mol = new Molecule();
    mol.addAtom('x', 'C', { radical: 1 });
    const copy = mol.clone();
    assert.equal(copy.atoms.get('x').properties.radical, 1);
  });

  it('retains duplicate-bond protection in the clone', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addBond('b0', 'a0', 'a1', {}, false);

    const copy = mol.clone();
    assert.throws(() => copy.addBond('b1', 'a0', 'a1', {}, false), /already exists/);
  });
});

describe('Molecule#merge', () => {
  it('combines two molecules into one disconnected graph', () => {
    const mol1 = new Molecule();
    mol1.addAtom('na', 'Na');
    const mol2 = new Molecule();
    mol2.addAtom('cl', 'Cl');
    const merged = mol1.merge(mol2);
    assert.equal(merged.atomCount, 2);
    assert.ok(merged.atoms.has('na'));
    assert.ok(merged.atoms.has('cl'));
  });

  it('remaps colliding atom IDs from the second molecule', () => {
    const mol1 = new Molecule();
    const atom1 = mol1.addAtom('a0', 'C');
    const mol2 = new Molecule();
    const atom2 = mol2.addAtom('a0', 'N');

    const merged = mol1.merge(mol2);
    assert.equal(merged.atomCount, 2);
    assert.ok(merged.atoms.has('a0'));
    assert.equal(merged.atoms.get('a0').uuid, atom1.uuid);

    const nitrogen = [...merged.atoms.values()].find(atom => atom.uuid === atom2.uuid);
    assert.ok(nitrogen);
    assert.equal(nitrogen.name, 'N');
    assert.notEqual(nitrogen.id, 'a0');
  });

  it('remaps colliding bond IDs from the second molecule and rewrites endpoints', () => {
    const mol1 = new Molecule();
    mol1.addAtom('a0', 'C');
    mol1.addAtom('a1', 'C');
    const bond1 = mol1.addBond('b0', 'a0', 'a1', {}, false);
    const mol2 = new Molecule();
    const atom2a = mol2.addAtom('a0', 'N');
    const atom2b = mol2.addAtom('a1', 'O');
    const bond2 = mol2.addBond('b0', 'a0', 'a1', {}, false);

    const merged = mol1.merge(mol2);
    assert.equal(merged.bondCount, 2);
    assert.ok(merged.bonds.has('b0'));
    assert.equal(merged.bonds.get('b0').uuid, bond1.uuid);

    const remappedBond = [...merged.bonds.values()].find(bond => bond.uuid === bond2.uuid);
    assert.ok(remappedBond);
    assert.notEqual(remappedBond.id, 'b0');

    const remappedA = [...merged.atoms.values()].find(atom => atom.uuid === atom2a.uuid);
    const remappedB = [...merged.atoms.values()].find(atom => atom.uuid === atom2b.uuid);
    assert.ok(remappedA);
    assert.ok(remappedB);
    assert.deepEqual(new Set(remappedBond.atoms), new Set([remappedA.id, remappedB.id]));
    assert.ok(merged.atoms.get(remappedA.id).bonds.includes(remappedBond.id));
    assert.ok(merged.atoms.get(remappedB.id).bonds.includes(remappedBond.id));
  });

  it('recomputes properties on the merged result', () => {
    const mol1 = new Molecule();
    mol1.addAtom('c1', 'C');
    const mol2 = new Molecule();
    mol2.addAtom('n1', 'N');
    const merged = mol1.merge(mol2);
    assert.deepEqual(merged.properties.formula, { C: 1, N: 1 });
  });

  it('preserves coordinates and visibility from both inputs', () => {
    const mol1 = new Molecule();
    const a0 = mol1.addAtom('a0', 'C');
    a0.x = 2;
    a0.y = 3;
    a0.visible = false;

    const mol2 = new Molecule();
    const b0 = mol2.addAtom('b0', 'N');
    b0.x = -4;
    b0.y = -5;
    b0.z = 6;

    const merged = mol1.merge(mol2);
    assert.equal(merged.atoms.get('a0').x, 2);
    assert.equal(merged.atoms.get('a0').y, 3);
    assert.equal(merged.atoms.get('a0').visible, false);
    assert.equal(merged.atoms.get('b0').x, -4);
    assert.equal(merged.atoms.get('b0').y, -5);
    assert.equal(merged.atoms.get('b0').z, 6);
    assert.equal(merged.atoms.get('b0').visible, true);
  });

  it('retains duplicate-bond protection for pre-existing merged bonds', () => {
    const mol1 = new Molecule();
    mol1.addAtom('a0', 'C');
    mol1.addAtom('a1', 'C');
    mol1.addBond('b0', 'a0', 'a1', {}, false);

    const mol2 = new Molecule();
    mol2.addAtom('b0', 'N');

    const merged = mol1.merge(mol2);
    assert.throws(() => merged.addBond('b1', 'a1', 'a0', {}, false), /already exists/);
  });

  it('retains duplicate-bond protection for remapped merged bonds', () => {
    const mol1 = new Molecule();
    mol1.addAtom('a0', 'C');
    mol1.addAtom('a1', 'C');

    const mol2 = new Molecule();
    const atomA = mol2.addAtom('a0', 'N');
    const atomB = mol2.addAtom('a1', 'O');
    mol2.addBond('b0', 'a0', 'a1', {}, false);

    const merged = mol1.merge(mol2);
    const remappedA = [...merged.atoms.values()].find(atom => atom.uuid === atomA.uuid);
    const remappedB = [...merged.atoms.values()].find(atom => atom.uuid === atomB.uuid);
    assert.ok(remappedA);
    assert.ok(remappedB);
    assert.throws(() => merged.addBond('b1', remappedA.id, remappedB.id, {}, false), /already exists/);
  });
});

// ---------------------------------------------------------------------------
// New method tests
// ---------------------------------------------------------------------------

describe('Atom – getNeighbors', () => {
  it('returns all neighbour Atom instances', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'N');
    mol.addAtom('c', 'O');
    mol.addBond('b1', 'a', 'b', {}, false);
    mol.addBond('b2', 'a', 'c', {}, false);
    const neighbors = mol.atoms.get('a').getNeighbors(mol);
    assert.equal(neighbors.length, 2);
    assert.ok(neighbors.every(n => n instanceof Atom));
    const ids = neighbors.map(n => n.id).sort();
    assert.deepEqual(ids, ['b', 'c']);
  });

  it('returns empty array for an isolated atom', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    assert.deepEqual(mol.atoms.get('a').getNeighbors(mol), []);
  });

  it('returns a single neighbour for a terminal atom', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'C');
    mol.addBond('b1', 'a', 'b', {}, false);
    const neighbors = mol.atoms.get('a').getNeighbors(mol);
    assert.equal(neighbors.length, 1);
    assert.equal(neighbors[0].id, 'b');
  });
});

describe('Atom – getDegree', () => {
  it('returns 0 for an isolated atom', () => {
    const a = new Atom('a', 'C');
    assert.equal(a.getDegree(), 0);
  });

  it('returns the number of bonds', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'C');
    mol.addAtom('c', 'C');
    mol.addBond('b1', 'a', 'b', {}, false);
    mol.addBond('b2', 'a', 'c', {}, false);
    assert.equal(mol.atoms.get('a').getDegree(), 2);
    assert.equal(mol.atoms.get('b').getDegree(), 1);
  });
});

describe('Atom – isTerminal', () => {
  it('returns false for an isolated atom (degree 0)', () => {
    const a = new Atom('a', 'C');
    assert.equal(a.isTerminal(), false);
  });

  it('returns true for an atom with exactly one bond', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'C');
    mol.addBond('b1', 'a', 'b', {}, false);
    assert.equal(mol.atoms.get('a').isTerminal(), true);
    assert.equal(mol.atoms.get('b').isTerminal(), true);
  });

  it('returns false for an atom with two or more bonds', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'C');
    mol.addAtom('c', 'C');
    mol.addBond('b1', 'a', 'b', {}, false);
    mol.addBond('b2', 'a', 'c', {}, false);
    assert.equal(mol.atoms.get('a').isTerminal(), false);
  });

  it('terminal atoms in a chain: first and last are terminal, middle is not', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'C');
    mol.addAtom('c', 'C');
    mol.addBond('b1', 'a', 'b', {}, false);
    mol.addBond('b2', 'b', 'c', {}, false);
    assert.equal(mol.atoms.get('a').isTerminal(), true);
    assert.equal(mol.atoms.get('b').isTerminal(), false);
    assert.equal(mol.atoms.get('c').isTerminal(), true);
  });
});

describe('Bond – isInRing', () => {
  it('returns true for a bond inside a 3-membered ring', () => {
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    mol.addAtom('B', 'C');
    mol.addAtom('C', 'C');
    mol.addBond('b1', 'A', 'B', {}, false);
    mol.addBond('b2', 'B', 'C', {}, false);
    mol.addBond('b3', 'C', 'A', {}, false);
    assert.equal(mol.bonds.get('b1').isInRing(mol), true);
    assert.equal(mol.bonds.get('b2').isInRing(mol), true);
    assert.equal(mol.bonds.get('b3').isInRing(mol), true);
  });

  it('returns true for all bonds in benzene (6-membered ring)', () => {
    const mol = new Molecule();
    for (let i = 0; i < 6; i++) {
      mol.addAtom(`C${i}`, 'C');
    }
    for (let i = 0; i < 6; i++) {
      mol.addBond(`b${i}`, `C${i}`, `C${(i + 1) % 6}`, {}, false);
    }
    for (let i = 0; i < 6; i++) {
      assert.equal(mol.bonds.get(`b${i}`).isInRing(mol), true);
    }
  });

  it('returns false for a bond in an open chain', () => {
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    mol.addAtom('B', 'C');
    mol.addAtom('C', 'C');
    mol.addBond('b1', 'A', 'B', {}, false);
    mol.addBond('b2', 'B', 'C', {}, false);
    assert.equal(mol.bonds.get('b1').isInRing(mol), false);
    assert.equal(mol.bonds.get('b2').isInRing(mol), false);
  });

  it('returns false for a pendant bond attached to a ring', () => {
    // 3-membered ring A-B-C-A with pendant D attached to A
    const mol = new Molecule();
    mol.addAtom('A', 'C');
    mol.addAtom('B', 'C');
    mol.addAtom('C', 'C');
    mol.addAtom('D', 'C');
    mol.addBond('ring1', 'A', 'B', {}, false);
    mol.addBond('ring2', 'B', 'C', {}, false);
    mol.addBond('ring3', 'C', 'A', {}, false);
    mol.addBond('pendant', 'A', 'D', {}, false);
    assert.equal(mol.bonds.get('pendant').isInRing(mol), false);
    assert.equal(mol.bonds.get('ring1').isInRing(mol), true);
  });
});

describe('Bond – getAtomObjects', () => {
  it('returns the two Atom instances for a bond', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'N');
    mol.addBond('b1', 'a', 'b', {}, false);
    const [atomA, atomB] = mol.bonds.get('b1').getAtomObjects(mol);
    assert.ok(atomA instanceof Atom);
    assert.ok(atomB instanceof Atom);
    assert.equal(atomA.id, 'a');
    assert.equal(atomB.id, 'b');
  });

  it('returns atoms with correct element names', () => {
    const mol = new Molecule();
    mol.addAtom('x', 'O');
    mol.addAtom('y', 'H');
    mol.addBond('b1', 'x', 'y', {}, false);
    const [o, h] = mol.bonds.get('b1').getAtomObjects(mol);
    assert.equal(o.name, 'O');
    assert.equal(h.name, 'H');
  });
});

describe('Bond – setOrder', () => {
  it('updates the bond order', () => {
    const b = new Bond('b0', ['a0', 'a1'], { order: 1 });
    b.setOrder(2);
    assert.equal(b.properties.order, 2);
  });

  it('returns the bond for chaining', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    const result = b.setOrder(3);
    assert.strictEqual(result, b);
    assert.equal(b.properties.order, 3);
  });

  it('throws RangeError for non-positive order', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.throws(() => b.setOrder(0), /RangeError|positive integer/);
    assert.throws(() => b.setOrder(-1), /RangeError|positive integer/);
  });

  it('throws RangeError for non-integer order', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.throws(() => b.setOrder(1.5), /RangeError|positive integer/);
    assert.throws(() => b.setOrder('2'), /RangeError|positive integer/);
  });

  it('clears aromatic flag when an integer order is set', () => {
    const b = new Bond('b0', ['a0', 'a1'], { order: 1.5, aromatic: true });
    b.setOrder(1);
    assert.equal(b.properties.aromatic, false);
    assert.equal(b.properties.order, 1);
  });
});

describe('Bond – setAromatic', () => {
  it('setAromatic(true) sets order to 1.5 and aromatic to true', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    b.setAromatic(true);
    assert.equal(b.properties.aromatic, true);
    assert.equal(b.properties.order, 1.5);
  });

  it('setAromatic(false) sets order to 1 and aromatic to false', () => {
    const b = new Bond('b0', ['a0', 'a1'], { order: 1.5, aromatic: true });
    b.setAromatic(false);
    assert.equal(b.properties.aromatic, false);
    assert.equal(b.properties.order, 1);
  });

  it('returns the bond for chaining', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.strictEqual(b.setAromatic(true), b);
  });

  it('throws TypeError for non-boolean value', () => {
    const b = new Bond('b0', ['a0', 'a1']);
    assert.throws(() => b.setAromatic(1), /TypeError|boolean/);
    assert.throws(() => b.setAromatic('yes'), /TypeError|boolean/);
    assert.throws(() => b.setAromatic(null), /TypeError|boolean/);
  });
});

describe('Molecule – findAtom', () => {
  it('returns the first matching atom', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'O');
    mol.addAtom('c', 'N');
    const result = mol.findAtom(a => a.name === 'O');
    assert.ok(result instanceof Atom);
    assert.equal(result.id, 'b');
  });

  it('returns null when no atom matches', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    assert.equal(
      mol.findAtom(a => a.name === 'Fe'),
      null
    );
  });

  it('returns null on an empty molecule', () => {
    assert.equal(
      new Molecule().findAtom(a => a.name === 'C'),
      null
    );
  });

  it('works with charge-based predicate', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C', { charge: 0 });
    mol.addAtom('b', 'N', { charge: 1 });
    const result = mol.findAtom(a => a.properties.charge === 1);
    assert.equal(result.id, 'b');
  });
});

describe('Molecule – findBond', () => {
  it('returns the first matching bond', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'C');
    mol.addAtom('c', 'C');
    mol.addBond('b1', 'a', 'b', { order: 1 }, false);
    mol.addBond('b2', 'b', 'c', { order: 2 }, false);
    const result = mol.findBond(b => b.properties.order === 2);
    assert.ok(result instanceof Bond);
    assert.equal(result.id, 'b2');
  });

  it('returns null when no bond matches', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'C');
    mol.addBond('b1', 'a', 'b', {}, false);
    assert.equal(
      mol.findBond(b => b.properties.order === 3),
      null
    );
  });

  it('returns null on a molecule with no bonds', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    assert.equal(
      mol.findBond(() => true),
      null
    );
  });
});

describe('Molecule – hideHydrogens', () => {
  it('marks all H atoms as not visible', () => {
    // Build CH4 manually (1 C + 4 H)
    const mol = new Molecule();
    mol.addAtom('C1', 'C');
    mol.addAtom('H1', 'H');
    mol.addAtom('H2', 'H');
    mol.addAtom('H3', 'H');
    mol.addAtom('H4', 'H');
    mol.addBond('b1', 'C1', 'H1', {}, false);
    mol.addBond('b2', 'C1', 'H2', {}, false);
    mol.addBond('b3', 'C1', 'H3', {}, false);
    mol.addBond('b4', 'C1', 'H4', {}, false);
    mol.hideHydrogens();
    for (const atom of mol.atoms.values()) {
      if (atom.name === 'H') {
        assert.equal(atom.visible, false);
      }
    }
  });

  it('does not remove atoms from the graph', () => {
    const mol = new Molecule();
    mol.addAtom('C1', 'C');
    mol.addAtom('H1', 'H');
    mol.addBond('b1', 'C1', 'H1', {}, false);
    mol.hideHydrogens();
    assert.equal(mol.atomCount, 2);
    assert.equal(mol.bondCount, 1);
  });

  it('returns this for chaining', () => {
    const mol = new Molecule();
    mol.addAtom('C1', 'C');
    assert.equal(mol.hideHydrogens(), mol);
  });

  it('leaves heavy atoms visible', () => {
    const mol = new Molecule();
    mol.addAtom('C1', 'C');
    mol.addAtom('N1', 'N');
    mol.addBond('b1', 'C1', 'N1', {}, false);
    mol.hideHydrogens();
    assert.equal(mol.atoms.get('C1').visible, true);
    assert.equal(mol.atoms.get('N1').visible, true);
  });
});

describe('Molecule – neutralizeCharge', () => {
  it('sets all atom charges to 0', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'N', { charge: 1, protons: 7, electrons: 6 });
    mol.addAtom('b', 'O', { charge: -1, protons: 8, electrons: 9 });
    mol.neutralizeCharge();
    for (const atom of mol.atoms.values()) {
      assert.equal(atom.properties.charge, 0);
    }
  });

  it('restores electrons to equal protons when protons are set', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'N', { charge: 1, protons: 7, electrons: 6 });
    mol.neutralizeCharge();
    assert.equal(mol.atoms.get('a').properties.electrons, 7);
  });

  it('neutralizeCharge restores electrons for auto-resolved atoms created by addAtom', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C', { charge: 1 });
    mol.neutralizeCharge();
    assert.equal(mol.atoms.get('a').properties.charge, 0);
    assert.equal(mol.atoms.get('a').properties.protons, 6);
    assert.equal(mol.atoms.get('a').properties.electrons, 6);
  });

  it('updates molecule-level charge property to 0', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'N', { charge: 1 });
    mol.addAtom('b', 'O', { charge: -1 });
    mol.neutralizeCharge();
    assert.equal(mol.properties.charge, 0);
  });

  it('returns the molecule for chaining', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    const result = mol.neutralizeCharge();
    assert.strictEqual(result, mol);
  });

  it('is a no-op on a molecule already at zero charge', () => {
    const mol = new Molecule();
    mol.addAtom('a', 'C');
    mol.addAtom('b', 'N');
    mol.neutralizeCharge();
    assert.equal(mol.properties.charge, 0);
  });
});

describe('CIP R/S — isotope mass tiebreaking (Task 3)', () => {
  it('[C@@]([13C])([12C])([2H])O — 4 distinct priorities, chirality assigned', () => {
    const mol = parseSMILES('[C@@]([13C])([12C])([2H])O');
    assert.equal(mol.getChiralCenters().length, 1, '[13C] vs [12C] and [2H] vs H should yield 4 distinct CIP priorities');
  });

  it('[C@@]([13C])([12C])([2H])O and [C@]([13C])([12C])([2H])O give opposite R/S', () => {
    const c1 = [...parseSMILES('[C@@]([13C])([12C])([2H])O').atoms.values()].find(a => a.isChiralCenter())?.getChirality();
    const c2 = [...parseSMILES('[C@]([13C])([12C])([2H])O').atoms.values()].find(a => a.isChiralCenter())?.getChirality();
    assert.ok(c1 && c2 && c1 !== c2, 'expected opposite chirality');
  });

  it('non-isotope chirality is unaffected — N[C@@H](C)C(=O)O still S', () => {
    const mol = parseSMILES('N[C@@H](C)C(=O)O');
    const c = [...mol.atoms.values()].find(a => a.isChiralCenter());
    assert.equal(c?.getChirality(), 'S');
  });

  it('non-isotope chirality is unaffected — F[C@@H](Cl)Br gives defined chirality', () => {
    const mol = parseSMILES('F[C@@H](Cl)Br');
    assert.equal(mol.getChiralCenters().length, 1);
  });
});

describe('Molecule.assignHybridizations', () => {
  const hyb = smiles => {
    const mol = parseSMILES(smiles);
    mol.assignHybridizations();
    return [...mol.atoms.values()].filter(a => a.name !== 'H').map(a => a.properties.hybridization);
  };

  it('sp3 for all carbons in ethane', () => {
    assert.deepEqual(hyb('CC'), ['sp3', 'sp3']);
  });

  it('sp2 for alkene carbons', () => {
    assert.deepEqual(hyb('C=C'), ['sp2', 'sp2']);
  });

  it('sp for alkyne carbons', () => {
    assert.deepEqual(hyb('C#C'), ['sp', 'sp']);
  });

  it('sp for allene center, sp2 for terminal carbons', () => {
    assert.deepEqual(hyb('C=C=C'), ['sp2', 'sp', 'sp2']);
  });

  it('sp2 for aromatic ring carbons', () => {
    const mol = parseSMILES('c1ccccc1');
    mol.assignHybridizations();
    const hybs = [...mol.atoms.values()].filter(a => a.name !== 'H').map(a => a.properties.hybridization);
    assert.ok(hybs.every(h => h === 'sp2'));
  });

  it('mixed: propan-2-one (acetone)', () => {
    // CC(=O)C → sp3, sp2, sp3 (ignoring O)
    const mol = parseSMILES('CC(=O)C');
    mol.assignHybridizations();
    const map = Object.fromEntries([...mol.atoms.values()].map(a => [a.name, a.properties.hybridization]));
    assert.equal(map['O'], 'sp2');
  });

  it('nitrile: sp nitrogen and sp carbon', () => {
    assert.deepEqual(hyb('C#N'), ['sp', 'sp']);
  });

  it('sp3 for H atoms', () => {
    const mol = parseSMILES('[H][H]');
    mol.assignHybridizations();
    assert.ok([...mol.atoms.values()].every(a => a.properties.hybridization === 'sp3'));
  });

  it('null for transition metals', () => {
    const mol = parseSMILES('[Fe]');
    mol.assignHybridizations();
    assert.equal([...mol.atoms.values()][0].properties.hybridization, null);
  });

  it('null for noble gases', () => {
    const mol = parseSMILES('[Ar]');
    mol.assignHybridizations();
    assert.equal([...mol.atoms.values()][0].properties.hybridization, null);
  });

  it('hybridization defaults to null before assignment', () => {
    const mol = parseSMILES('CC');
    assert.ok([...mol.atoms.values()].every(a => a.properties.hybridization === null));
  });

  it('returns the molecule for chaining', () => {
    const mol = parseSMILES('CC');
    assert.strictEqual(mol.assignHybridizations(), mol);
  });
});
