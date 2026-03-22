import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseINCHI, toInChI, parseSMILES } from '../../src/io/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count atoms of a given element in the molecule. */
function countElement(mol, symbol) {
  let n = 0;
  for (const atom of mol.atoms.values()) {
    if (atom.name === symbol) {
      n++;
    }
  }
  return n;
}

/** Return heavy-atom bonds (both endpoints non-H). */
function heavyBonds(mol) {
  return [...mol.bonds.values()].filter(b => {
    const a = mol.atoms.get(b.atoms[0]);
    const c = mol.atoms.get(b.atoms[1]);
    return a?.name !== 'H' && c?.name !== 'H';
  });
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('parseINCHI — input validation', () => {
  it('throws on empty string',   () => assert.throws(() => parseINCHI(''),        /non-empty/));
  it('throws on non-string',     () => assert.throws(() => parseINCHI(null),      /non-empty/));
  it('throws without InChI= prefix', () => assert.throws(() => parseINCHI('1S/C6H6'), /InChI=/));
  it('throws on missing formula',    () => assert.throws(() => parseINCHI('InChI=1S'), /formula/));
  it('throws when the /c layer leaves a heavy atom disconnected', () => {
    assert.throws(
      () => parseINCHI('InChI=1S/C4H4O/c1-2-4-3-1/h1-4H'),
      /leaves heavy atom\(s\) unconnected: 5 \(O\)/
    );
  });
});

// ---------------------------------------------------------------------------
// Formula parsing — single atoms / simple molecules
// ---------------------------------------------------------------------------

describe('parseINCHI — methane InChI=1S/CH4/h1H4', () => {
  const mol = parseINCHI('InChI=1S/CH4/h1H4');

  it('has 1 C and 4 H atoms', () => {
    assert.equal(countElement(mol, 'C'), 1);
    assert.equal(countElement(mol, 'H'), 4);
  });

  it('has 4 C-H bonds, all order 1', () => {
    assert.equal(mol.bondCount, 4);
    for (const b of mol.bonds.values()) {
      assert.equal(b.properties.order, 1);
    }
  });

  it('formula is { C: 1, H: 4 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 1, H: 4 });
  });
});

describe('parseINCHI — hydrogen chloride plus ammonia InChI=1S/ClH.H3N/h1H;1H3', () => {
  const mol = parseINCHI('InChI=1S/ClH.H3N/h1H;1H3');

  it('parses as two disconnected heavy-atom components', () => {
    assert.equal(heavyBonds(mol).length, 0);
    assert.deepEqual(mol.getFormula(), { Cl: 1, H: 4, N: 1 });
  });

  it('assigns one H to Cl and three H to N', () => {
    const chlorine = [...mol.atoms.values()].find(a => a.name === 'Cl');
    const nitrogen = [...mol.atoms.values()].find(a => a.name === 'N');
    assert.ok(chlorine);
    assert.ok(nitrogen);
    assert.equal(chlorine.getHydrogenNeighbors(mol).length, 1);
    assert.equal(nitrogen.getHydrogenNeighbors(mol).length, 3);
  });
});

describe('parseINCHI — fixed-H ammonium chloride InChI=1/ClH.H3N/h1H;1H3/fCl.H4N/h1h;1H/q-1;+1', () => {
  const mol = parseINCHI('InChI=1/ClH.H3N/h1H;1H3/fCl.H4N/h1h;1H/q-1;+1');

  it('parses as chloride and ammonium', () => {
    assert.equal(heavyBonds(mol).length, 0);
    assert.deepEqual(mol.getFormula(), { Cl: 1, H: 4, N: 1 });
  });

  it('assigns formal charges and hydrogens correctly', () => {
    const chlorine = [...mol.atoms.values()].find(a => a.name === 'Cl');
    const nitrogen = [...mol.atoms.values()].find(a => a.name === 'N');
    assert.ok(chlorine);
    assert.ok(nitrogen);
    assert.equal(chlorine.getHydrogenNeighbors(mol).length, 0);
    assert.equal(nitrogen.getHydrogenNeighbors(mol).length, 4);
    assert.equal(chlorine.properties.charge, -1);
    assert.equal(nitrogen.properties.charge, 1);
    assert.equal(mol.properties.charge, 0);
  });
});

describe('parseINCHI — sulfamide mobile hydrogens InChI=1S/H4N2O2S/c1-5(2,3)4/h(H4,1,2,3,4)', () => {
  const mol = parseINCHI('InChI=1S/H4N2O2S/c1-5(2,3)4/h(H4,1,2,3,4)');

  it('prefers two S=O bonds over O-H placement', () => {
    const nitrogens = [...mol.atoms.values()].filter(a => a.name === 'N');
    const oxygens = [...mol.atoms.values()].filter(a => a.name === 'O');
    const sulfur = [...mol.atoms.values()].find(a => a.name === 'S');
    const soDoubles = heavyBonds(mol).filter(bond => {
      const [aId, bId] = bond.atoms;
      const a = mol.atoms.get(aId);
      const b = mol.atoms.get(bId);
      return bond.properties.order === 2 &&
        ((a?.name === 'S' && b?.name === 'O') || (a?.name === 'O' && b?.name === 'S'));
    });

    assert.equal(nitrogens.length, 2);
    assert.equal(oxygens.length, 2);
    assert.ok(sulfur);
    assert.deepEqual(nitrogens.map(a => a.getHydrogenNeighbors(mol).length).sort((a, b) => a - b), [2, 2]);
    assert.deepEqual(oxygens.map(a => a.getHydrogenNeighbors(mol).length).sort((a, b) => a - b), [0, 0]);
    assert.equal(soDoubles.length, 2);
  });
});

describe('parseINCHI — hydrogen isotopes from /i layer', () => {
  const mol = parseINCHI('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3/i2D2,3D');

  it('preserves deuterium atoms on the correct parents', () => {
    const deuteriums = [...mol.atoms.values()].filter(atom =>
      atom.name === 'H' && Math.round(atom.properties.neutrons ?? 0) === 1
    );
    const protiums = [...mol.atoms.values()].filter(atom =>
      atom.name === 'H' && Math.round(atom.properties.neutrons ?? 0) === 0
    );
    const oxygen = [...mol.atoms.values()].find(atom => atom.name === 'O');
    const carbonWithTwoD = [...mol.atoms.values()].find(atom =>
      atom.name === 'C' &&
      atom.getHydrogenNeighbors(mol).filter(h => Math.round(h.properties.neutrons ?? 0) === 1).length === 2
    );

    assert.equal(deuteriums.length, 3);
    assert.equal(protiums.length, 3);
    assert.ok(oxygen);
    assert.ok(carbonWithTwoD);
    assert.equal(
      oxygen.getHydrogenNeighbors(mol).filter(h => Math.round(h.properties.neutrons ?? 0) === 1).length,
      1
    );
  });
});

describe('parseINCHI — iron bis(benzoate) InChI=1S/2C7H6O2.Fe/c2*8-7(9)6-4-2-1-3-5-6;/h2*1-5H,(H,8,9);/q;;+2/p-2', () => {
  const mol = parseINCHI('InChI=1S/2C7H6O2.Fe/c2*8-7(9)6-4-2-1-3-5-6;/h2*1-5H,(H,8,9);/q;;+2/p-2');

  it('parses repeated components and proton removal correctly', () => {
    assert.deepEqual(mol.getFormula(), { C: 14, H: 10, O: 4, Fe: 1 });
    assert.equal(mol.properties.charge, 0);
    assert.equal(countElement(mol, 'Fe'), 1);
  });

  it('assigns Fe2+ and two benzoate oxygens as O-', () => {
    const iron = [...mol.atoms.values()].find(a => a.name === 'Fe');
    const oxygens = [...mol.atoms.values()].filter(a => a.name === 'O');
    assert.ok(iron);
    assert.equal(iron.properties.charge, 2);
    assert.equal(oxygens.filter(o => o.properties.charge === -1).length, 2);
  });
});

describe('parseINCHI — tetrahedral stereochemistry', () => {
  it('uses /t and /m to distinguish enantiomers', () => {
    const rMol = parseINCHI('InChI=1S/C8H9NO2/c9-7(8(10)11)6-4-2-1-3-5-6/h1-5,7H,9H2,(H,10,11)/t7-/m1/s1');
    const sMol = parseINCHI('InChI=1S/C8H9NO2/c9-7(8(10)11)6-4-2-1-3-5-6/h1-5,7H,9H2,(H,10,11)/t7-/m0/s1');
    const rCenter = [...rMol.atoms.values()].find(a => a.properties.chirality);
    const sCenter = [...sMol.atoms.values()].find(a => a.properties.chirality);
    assert.ok(rCenter);
    assert.ok(sCenter);
    assert.equal(rCenter.properties.chirality, 'R');
    assert.equal(sCenter.properties.chirality, 'S');
  });

  it('handles acyclic quaternary centers with no hydrogens', () => {
    const mol = parseINCHI('InChI=1S/CBrClFI/c2-1(3,4)5/t1-/m1/s1');
    const center = [...mol.atoms.values()].find(a => a.properties.chirality);
    assert.ok(center);
    assert.equal(center.properties.chirality, 'S');
  });
});

describe('parseINCHI — double-bond stereochemistry', () => {
  it('/b plus gives E', () => {
    const mol = parseINCHI('InChI=1S/C2H2F2/c3-1-2-4/h1-2H/b2-1+');
    const dbl = [...mol.bonds.values()].find(b => b.properties.order === 2);
    assert.ok(dbl);
    assert.equal(mol.getEZStereo(dbl.id), 'E');
  });

  it('/b minus gives Z', () => {
    const mol = parseINCHI('InChI=1S/C2H2F2/c3-1-2-4/h1-2H/b2-1-');
    const dbl = [...mol.bonds.values()].find(b => b.properties.order === 2);
    assert.ok(dbl);
    assert.equal(mol.getEZStereo(dbl.id), 'Z');
  });
});

describe('parseINCHI — charged heteroaromatic ring', () => {
  const mol = parseINCHI('InChI=1S/C3H3N2/c1-2-5-3-4-1/h1-3H/q-1');

  it('retains the net -1 charge on the aromatic ring', () => {
    assert.equal(mol.properties.charge, -1);
    assert.equal(
      [...mol.atoms.values()].filter(atom => (atom.properties.charge ?? 0) === -1 && atom.name === 'N').length,
      1
    );
  });
});

describe('parseINCHI — guanidine mobile hydrogens prefer terminal imine', () => {
  const mol = parseINCHI('InChI=1S/C6H14N4O2/c7-4(5(11)12)2-1-3-10-6(8)9/h4H,1-3,7H2,(H,11,12)(H4,8,9,10)');

  it('keeps the side-chain nitrogen single-bonded to the guanidino carbon', () => {
    const nitrogens = [...mol.atoms.values()].filter(atom => atom.name === 'N');
    const internalNitrogen = nitrogens.find(atom =>
      atom.getHeavyNeighbors(mol).some(nb => nb.name === 'C') &&
      atom.getHeavyNeighbors(mol).filter(nb => nb.name === 'C').length === 2
    );
    assert.ok(internalNitrogen);
    const doubleBonds = internalNitrogen.bonds
      .map(bondId => mol.bonds.get(bondId))
      .filter(Boolean)
      .filter(bond => (bond.properties.order ?? 1) === 2);
    assert.equal(doubleBonds.length, 0);
  });
});

describe('parseINCHI — fused aza aromaticity matches SMILES perception', () => {
  const smiles = parseSMILES('N1C=NC2=C1N=CN2[C@H]3C[C@H](O)[C@@H](CO)O3');
  const inchi = parseINCHI('InChI=1S/C9H12N4O3/c14-2-6-5(15)1-7(16-6)13-4-12-8-9(13)11-3-10-8/h3-7,14-15H,1-2H2,(H,10,11)/t5-,6+,7+/m0/s1');

  function bondSignature(mol) {
    return heavyBonds(mol)
      .map(bond => {
        const names = bond.atoms.map(id => mol.atoms.get(id)?.name).sort();
        return JSON.stringify({
          atoms: names,
          order: bond.properties.order,
          aromatic: !!bond.properties.aromatic
        });
      })
      .sort();
  }

  it('keeps the same aromatic/non-aromatic heavy-bond pattern as SMILES', () => {
    assert.deepEqual(bondSignature(inchi), bondSignature(smiles));
  });
});

// ---------------------------------------------------------------------------
// Simple chain molecules
// ---------------------------------------------------------------------------

describe('parseINCHI — ethane InChI=1S/C2H6/c1-2/h1-2H3', () => {
  const mol = parseINCHI('InChI=1S/C2H6/c1-2/h1-2H3');

  it('formula C2H6', () => assert.deepEqual(mol.getFormula(), { C: 2, H: 6 }));

  it('has exactly 1 heavy-atom bond (C-C single)', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 1);
    assert.equal(hb[0].properties.order, 1);
  });
});

describe('parseINCHI — propane InChI=1S/C3H8/c1-3-2/h1-2H3,3H2', () => {
  const mol = parseINCHI('InChI=1S/C3H8/c1-3-2/h1-2H3,3H2');

  it('formula C3H8', () => assert.deepEqual(mol.getFormula(), { C: 3, H: 8 }));
  it('2 heavy-atom bonds, both C-C single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 2);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('middle C has 2 heavy neighbors', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const middle  = carbons.find(c => c.getHeavyNeighbors(mol).length === 2);
    assert.ok(middle, 'a middle carbon should exist');
    assert.equal(middle.getHydrogenNeighbors(mol).length, 2);
  });
});

describe('parseINCHI — isobutane InChI=1S/C4H10/c1-4(2)3/h4H,1-3H3', () => {
  const mol = parseINCHI('InChI=1S/C4H10/c1-4(2)3/h4H,1-3H3');

  it('formula C4H10', () => assert.deepEqual(mol.getFormula(), { C: 4, H: 10 }));
  it('3 heavy-atom bonds (star graph), all single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 3);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('central C has 3 heavy neighbors and 1 H', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const centre  = carbons.find(c => c.getHeavyNeighbors(mol).length === 3);
    assert.ok(centre);
    assert.equal(centre.getHydrogenNeighbors(mol).length, 1);
  });
});

describe('parseINCHI — neopentane InChI=1S/C5H12/c1-5(2,3)4/h1-4H3', () => {
  const mol = parseINCHI('InChI=1S/C5H12/c1-5(2,3)4/h1-4H3');

  it('formula C5H12', () => assert.deepEqual(mol.getFormula(), { C: 5, H: 12 }));
  it('4 heavy-atom bonds (K1,4 star), all single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 4);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('central C has 4 heavy neighbors and 0 H', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const centre  = carbons.find(c => c.getHeavyNeighbors(mol).length === 4);
    assert.ok(centre);
    assert.equal(centre.getHydrogenNeighbors(mol).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Heteroatoms
// ---------------------------------------------------------------------------

describe('parseINCHI — ethanol InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3', () => {
  const mol = parseINCHI('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');

  it('formula C2H6O', () => assert.deepEqual(mol.getFormula(), { C: 2, H: 6, O: 1 }));
  it('2 heavy-atom bonds: C-C and C-O', () => {
    assert.equal(heavyBonds(mol).length, 2);
  });
  it('O atom has 1 H neighbor', () => {
    const o = [...mol.atoms.values()].find(a => a.name === 'O');
    assert.ok(o);
    assert.equal(o.getHydrogenNeighbors(mol).length, 1);
  });
});

describe('parseINCHI — methylamine InChI=1S/CH5N/c1-2/h2H2,1H3', () => {
  const mol = parseINCHI('InChI=1S/CH5N/c1-2/h2H2,1H3');

  it('formula CH5N', () => assert.deepEqual(mol.getFormula(), { C: 1, H: 5, N: 1 }));
  it('1 heavy bond (C-N), single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 1);
    assert.equal(hb[0].properties.order, 1);
  });
  it('N has 2 H, C has 3 H', () => {
    const n = [...mol.atoms.values()].find(a => a.name === 'N');
    const c = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.equal(n.getHydrogenNeighbors(mol).length, 2);
    assert.equal(c.getHydrogenNeighbors(mol).length, 3);
  });
});

// ---------------------------------------------------------------------------
// Bond order inference — unsaturated molecules
// ---------------------------------------------------------------------------

describe('parseINCHI — ethylene InChI=1S/C2H4/c1-2/h1-2H2', () => {
  const mol = parseINCHI('InChI=1S/C2H4/c1-2/h1-2H2');

  it('formula C2H4', () => assert.deepEqual(mol.getFormula(), { C: 2, H: 4 }));
  it('C=C bond is order 2', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 1);
    assert.equal(hb[0].properties.order, 2);
  });
});

describe('parseINCHI — acetylene InChI=1S/C2H2/c1-2/h1-2H', () => {
  const mol = parseINCHI('InChI=1S/C2H2/c1-2/h1-2H');

  it('formula C2H2', () => assert.deepEqual(mol.getFormula(), { C: 2, H: 2 }));
  it('C≡C bond is order 3', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 1);
    assert.equal(hb[0].properties.order, 3);
  });
});

// ---------------------------------------------------------------------------
// Ring systems
// ---------------------------------------------------------------------------

describe('parseINCHI — cyclohexane InChI=1S/C6H12/c1-2-3-4-5-6-1/h1-6H2', () => {
  const mol = parseINCHI('InChI=1S/C6H12/c1-2-3-4-5-6-1/h1-6H2');

  it('formula C6H12', () => assert.deepEqual(mol.getFormula(), { C: 6, H: 12 }));
  it('6 heavy-atom bonds, all single (saturated)', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 6);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
      assert.equal(b.properties.aromatic, false);
    }
  });
  it('every C is in a ring', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    for (const c of carbons) {
      assert.equal(mol.isAtomInRing(c.id), true);
    }
  });
});

describe('parseINCHI — benzene InChI=1S/C6H6/c1-2-3-4-5-6-1/h1-6H', () => {
  const mol = parseINCHI('InChI=1S/C6H6/c1-2-3-4-5-6-1/h1-6H');

  it('formula C6H6', () => assert.deepEqual(mol.getFormula(), { C: 6, H: 6 }));
  it('6 heavy-atom bonds, all aromatic', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 6);
    for (const b of hb) {
      assert.equal(b.properties.aromatic, true);
      assert.equal(b.properties.order, 1.5);
    }
  });
  it('every C is in a ring', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    for (const c of carbons) {
      assert.equal(mol.isAtomInRing(c.id), true);
    }
  });
});

describe('parseINCHI — naphthalene InChI=1S/C10H8/c1-2-6-10-8-4-3-7-9(10)5-1/h1-8H', () => {
  const mol = parseINCHI('InChI=1S/C10H8/c1-2-6-10-8-4-3-7-9(10)5-1/h1-8H');

  it('formula C10H8', () => assert.deepEqual(mol.getFormula(), { C: 10, H: 8 }));
  it('11 heavy-atom bonds (fused bicyclic)', () => {
    assert.equal(heavyBonds(mol).length, 11);
  });
  it('all heavy-atom bonds are aromatic', () => {
    for (const b of heavyBonds(mol)) {
      assert.equal(b.properties.aromatic, true);
    }
  });
  it('all C atoms are in a ring', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    for (const c of carbons) {
      assert.equal(mol.isAtomInRing(c.id), true);
    }
  });
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe('parseINCHI — options', () => {
  it('addHydrogens: false returns H-suppressed graph', () => {
    const mol = parseINCHI('InChI=1S/C2H6/c1-2/h1-2H3', { addHydrogens: false });
    assert.equal(countElement(mol, 'H'), 0);
    assert.equal(countElement(mol, 'C'), 2);
    assert.equal(mol.bondCount, 1);
  });

  it('inferBondOrders: false leaves all bonds as order 1', () => {
    const mol = parseINCHI('InChI=1S/C6H6/c1-2-3-4-5-6-1/h1-6H', { inferBondOrders: false });
    for (const b of heavyBonds(mol)) {
      assert.equal(b.properties.order, 1);
      assert.equal(b.properties.aromatic, false);
    }
  });

  it('inferBondOrders: false + addHydrogens: false gives bare skeleton', () => {
    const mol = parseINCHI('InChI=1S/C6H6/c1-2-3-4-5-6-1/h1-6H', {
      inferBondOrders: false, addHydrogens: false
    });
    assert.equal(mol.atomCount, 6);
    assert.equal(mol.bondCount, 6);
  });
});

// ---------------------------------------------------------------------------
// Charge layer
// ---------------------------------------------------------------------------

describe('parseINCHI — charge /q layer', () => {
  it('positively charged molecule has correct charge', () => {
    // Ammonium ion: InChI=1S/H3N/h1H3/p+1 ... but /q is simpler to test
    // Use a custom InChI with /q+1 directly
    const mol = parseINCHI('InChI=1S/CH4/h1H4/q+1');
    assert.equal(mol.properties.charge, 1);
  });

  it('negatively charged molecule /q-1 has charge -1', () => {
    const mol = parseINCHI('InChI=1S/C2H6/c1-2/h1-2H3/q-1');
    assert.equal(mol.properties.charge, -1);
  });
});

// ---------------------------------------------------------------------------
// Longer alkane chains
// ---------------------------------------------------------------------------

describe('parseINCHI — n-butane InChI=1S/C4H10/c1-2-3-4/h1,4H3,2-3H2', () => {
  const mol = parseINCHI('InChI=1S/C4H10/c1-2-3-4/h1,4H3,2-3H2');

  it('formula C4H10', () => assert.deepEqual(mol.getFormula(), { C: 4, H: 10 }));
  it('3 heavy-atom bonds (C-C chain), all single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 3);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('terminal carbons have 1 heavy neighbor, interior carbons have 2', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const terminals = carbons.filter(c => c.getHeavyNeighbors(mol).length === 1);
    const interior  = carbons.filter(c => c.getHeavyNeighbors(mol).length === 2);
    assert.equal(terminals.length, 2);
    assert.equal(interior.length,  2);
  });
});

describe('parseINCHI — n-pentane InChI=1S/C5H12/c1-2-3-4-5/h1,5H3,2-4H2', () => {
  const mol = parseINCHI('InChI=1S/C5H12/c1-2-3-4-5/h1,5H3,2-4H2');

  it('formula C5H12', () => assert.deepEqual(mol.getFormula(), { C: 5, H: 12 }));
  it('4 heavy-atom bonds (C-C chain), all single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 4);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('middle carbon has 2 heavy neighbors and 2 H', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const middle  = carbons.find(c => c.getHeavyNeighbors(mol).length === 2
                                   && c.getHydrogenNeighbors(mol).length === 2);
    assert.ok(middle, 'expected a central CH2 carbon');
  });
});

// ---------------------------------------------------------------------------
// Carbonyl compounds — C=O bond inference
// ---------------------------------------------------------------------------

describe('parseINCHI — formaldehyde InChI=1S/CH2O/c1-2/h1H2', () => {
  const mol = parseINCHI('InChI=1S/CH2O/c1-2/h1H2');

  it('formula { C:1, H:2, O:1 }', () => assert.deepEqual(mol.getFormula(), { C: 1, H: 2, O: 1 }));
  it('C=O heavy bond is order 2', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 1);
    assert.equal(hb[0].properties.order, 2);
  });
  it('carbon has 2 hydrogen neighbors', () => {
    const c = [...mol.atoms.values()].find(a => a.name === 'C');
    assert.equal(c.getHydrogenNeighbors(mol).length, 2);
  });
});

describe('parseINCHI — acetaldehyde InChI=1S/C2H4O/c1-2-3/h2H,1H3', () => {
  const mol = parseINCHI('InChI=1S/C2H4O/c1-2-3/h2H,1H3');

  it('formula { C:2, H:4, O:1 }', () => assert.deepEqual(mol.getFormula(), { C: 2, H: 4, O: 1 }));
  it('2 heavy-atom bonds: C-C single, C=O double', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 2);
    const orders = hb.map(b => b.properties.order).sort((a, b) => a - b);
    assert.deepEqual(orders, [1, 2]);
  });
  it('aldehyde C has exactly 1 H neighbor', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const aldC    = carbons.find(c => c.getHeavyNeighbors(mol).some(n => n.name === 'O'));
    assert.ok(aldC);
    assert.equal(aldC.getHydrogenNeighbors(mol).length, 1);
  });
});

describe('parseINCHI — acetone InChI=1S/C3H6O/c1-3(2)4/h1-2H3', () => {
  const mol = parseINCHI('InChI=1S/C3H6O/c1-3(2)4/h1-2H3');

  it('formula { C:3, H:6, O:1 }', () => assert.deepEqual(mol.getFormula(), { C: 3, H: 6, O: 1 }));
  it('3 heavy-atom bonds: 2 C-C single and 1 C=O double', () => {
    const hb     = heavyBonds(mol);
    assert.equal(hb.length, 3);
    const singles = hb.filter(b => b.properties.order === 1);
    const doubles = hb.filter(b => b.properties.order === 2);
    assert.equal(singles.length, 2);
    assert.equal(doubles.length, 1);
  });
  it('carbonyl C has no H neighbors', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const carbonyl = carbons.find(c => c.getHeavyNeighbors(mol).some(n => n.name === 'O'));
    assert.ok(carbonyl);
    assert.equal(carbonyl.getHydrogenNeighbors(mol).length, 0);
  });
});

describe('parseINCHI — urea InChI=1S/CH4N2O/c2-1(3)4/h(H4,2,3,4)', () => {
  const mol = parseINCHI('InChI=1S/CH4N2O/c2-1(3)4/h(H4,2,3,4)');

  it('formula { C:1, H:4, N:2, O:1 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 1, H: 4, N: 2, O: 1 });
  });
  it('oxygen has 0 H and 1 heavy neighbor', () => {
    const oxygen = [...mol.atoms.values()].find(a => a.name === 'O');
    assert.ok(oxygen);
    assert.equal(oxygen.getHydrogenNeighbors(mol).length, 0);
    assert.equal(oxygen.getHeavyNeighbors(mol).length, 1);
  });
  it('each nitrogen has 2 H and 1 heavy neighbor', () => {
    const nitrogens = [...mol.atoms.values()].filter(a => a.name === 'N');
    assert.equal(nitrogens.length, 2);
    for (const n of nitrogens) {
      assert.equal(n.getHydrogenNeighbors(mol).length, 2);
      assert.equal(n.getHeavyNeighbors(mol).length, 1);
    }
  });
  it('has one C=O bond and two C-N single bonds', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 3);
    assert.equal(hb.filter(b => b.properties.order === 2).length, 1);
    assert.equal(hb.filter(b => b.properties.order === 1).length, 2);
  });
});

// ---------------------------------------------------------------------------
// Halogen
// ---------------------------------------------------------------------------

describe('parseINCHI — chloromethane InChI=1S/CH3Cl/c1-2/h1H3', () => {
  const mol = parseINCHI('InChI=1S/CH3Cl/c1-2/h1H3');

  it('formula { C:1, H:3, Cl:1 }', () => assert.deepEqual(mol.getFormula(), { C: 1, H: 3, Cl: 1 }));
  it('1 heavy bond C-Cl, order 1', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 1);
    assert.equal(hb[0].properties.order, 1);
  });
  it('carbon has 3 H neighbors, chlorine has 0 H neighbors', () => {
    const c  = [...mol.atoms.values()].find(a => a.name === 'C');
    const cl = [...mol.atoms.values()].find(a => a.name === 'Cl');
    assert.equal(c.getHydrogenNeighbors(mol).length, 3);
    assert.equal(cl.getHydrogenNeighbors(mol).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Sulfur
// ---------------------------------------------------------------------------

describe('parseINCHI — methanethiol InChI=1S/CH4S/c1-2/h2H,1H3', () => {
  const mol = parseINCHI('InChI=1S/CH4S/c1-2/h2H,1H3');

  it('formula { C:1, H:4, S:1 }', () => assert.deepEqual(mol.getFormula(), { C: 1, H: 4, S: 1 }));
  it('1 heavy bond C-S, order 1', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 1);
    assert.equal(hb[0].properties.order, 1);
  });
  it('C has 3 H, S has 1 H', () => {
    const c = [...mol.atoms.values()].find(a => a.name === 'C');
    const s = [...mol.atoms.values()].find(a => a.name === 'S');
    assert.equal(c.getHydrogenNeighbors(mol).length, 3);
    assert.equal(s.getHydrogenNeighbors(mol).length, 1);
  });
});

// ---------------------------------------------------------------------------
// Nitrile — C≡N triple bond inference
// ---------------------------------------------------------------------------

describe('parseINCHI — acetonitrile InChI=1S/C2H3N/c1-2-3/h1H3', () => {
  const mol = parseINCHI('InChI=1S/C2H3N/c1-2-3/h1H3');

  it('formula { C:2, H:3, N:1 }', () => assert.deepEqual(mol.getFormula(), { C: 2, H: 3, N: 1 }));
  it('2 heavy-atom bonds: C-C single and C≡N triple', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 2);
    const triple = hb.find(b => b.properties.order === 3);
    const single = hb.find(b => b.properties.order === 1);
    assert.ok(triple, 'expected a triple bond');
    assert.ok(single, 'expected a single bond');
  });
  it('nitrile N has 0 H neighbors', () => {
    const n = [...mol.atoms.values()].find(a => a.name === 'N');
    assert.equal(n.getHydrogenNeighbors(mol).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Ring with double bond
// ---------------------------------------------------------------------------

describe('parseINCHI — cyclohexene InChI=1S/C6H10/c1-2-3-4-5-6-1/h1-2H,3-6H2', () => {
  const mol = parseINCHI('InChI=1S/C6H10/c1-2-3-4-5-6-1/h1-2H,3-6H2');

  it('formula C6H10', () => assert.deepEqual(mol.getFormula(), { C: 6, H: 10 }));
  it('6 heavy-atom bonds forming a ring', () => {
    assert.equal(heavyBonds(mol).length, 6);
  });
  it('exactly 1 double bond and 5 single bonds', () => {
    const hb      = heavyBonds(mol);
    const doubles = hb.filter(b => b.properties.order === 2);
    const singles = hb.filter(b => b.properties.order === 1);
    assert.equal(doubles.length, 1);
    assert.equal(singles.length, 5);
  });
  it('all carbons are in a ring', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    for (const c of carbons) {
      assert.equal(mol.isAtomInRing(c.id), true);
    }
  });
});

// ---------------------------------------------------------------------------
// Aromatic nitrogen ring
// ---------------------------------------------------------------------------

describe('parseINCHI — pyridine InChI=1S/C5H5N/c1-2-4-6-5-3-1/h1-5H', () => {
  const mol = parseINCHI('InChI=1S/C5H5N/c1-2-4-6-5-3-1/h1-5H');

  it('formula { C:5, H:5, N:1 }', () => assert.deepEqual(mol.getFormula(), { C: 5, H: 5, N: 1 }));
  it('6 heavy-atom bonds', () => assert.equal(heavyBonds(mol).length, 6));
  it('all heavy-atom bonds are aromatic', () => {
    for (const b of heavyBonds(mol)) {
      assert.equal(b.properties.aromatic, true);
    }
  });
  it('all atoms are in a ring', () => {
    for (const atom of mol.atoms.values()) {
      if (atom.name === 'H') {
        continue;
      }
      assert.equal(mol.isAtomInRing(atom.id), true);
    }
  });
  it('nitrogen has 0 H neighbors', () => {
    const n = [...mol.atoms.values()].find(a => a.name === 'N');
    assert.equal(n.getHydrogenNeighbors(mol).length, 0);
  });
});

describe('parseINCHI — furan InChI=1S/C4H4O/c1-2-4-5-3-1/h1-4H', () => {
  const mol = parseINCHI('InChI=1S/C4H4O/c1-2-4-5-3-1/h1-4H');

  it('formula { C:4, H:4, O:1 }', () => assert.deepEqual(mol.getFormula(), { C: 4, H: 4, O: 1 }));
  it('5 heavy-atom bonds, all aromatic', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 5);
    for (const b of hb) {
      assert.equal(b.properties.aromatic, true);
      assert.equal(b.properties.order, 1.5);
    }
  });
  it('oxygen is in the ring and has two heavy neighbors', () => {
    const oxygen = [...mol.atoms.values()].find(a => a.name === 'O');
    assert.ok(oxygen);
    assert.equal(oxygen.getHeavyNeighbors(mol).length, 2);
    assert.equal(mol.isAtomInRing(oxygen.id), true);
  });
});

// ---------------------------------------------------------------------------
// Benzene ring with substituent
// ---------------------------------------------------------------------------

describe('parseINCHI — toluene InChI=1S/C7H8/c1-7-5-3-2-4-6-7/h2-6H,1H3', () => {
  const mol = parseINCHI('InChI=1S/C7H8/c1-7-5-3-2-4-6-7/h2-6H,1H3');

  it('formula { C:7, H:8 }', () => assert.deepEqual(mol.getFormula(), { C: 7, H: 8 }));
  it('7 heavy-atom bonds total (6 ring + 1 methyl)', () => {
    assert.equal(heavyBonds(mol).length, 7);
  });
  it('6 ring bonds are aromatic', () => {
    const aromatic = heavyBonds(mol).filter(b => b.properties.aromatic);
    assert.equal(aromatic.length, 6);
  });
  it('1 non-aromatic C-C bond (methyl attachment)', () => {
    const nonAromatic = heavyBonds(mol).filter(b => !b.properties.aromatic);
    assert.equal(nonAromatic.length, 1);
    assert.equal(nonAromatic[0].properties.order, 1);
  });
  it('methyl carbon has 3 H and 1 heavy neighbor', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const methyl  = carbons.find(c => c.getHydrogenNeighbors(mol).length === 3);
    assert.ok(methyl);
    assert.equal(methyl.getHeavyNeighbors(mol).length, 1);
  });
});

// ---------------------------------------------------------------------------
// Branched alcohol
// ---------------------------------------------------------------------------

describe('parseINCHI — isopropanol InChI=1S/C3H8O/c1-3(2)4/h3-4H,1-2H3', () => {
  const mol = parseINCHI('InChI=1S/C3H8O/c1-3(2)4/h3-4H,1-2H3');

  it('formula { C:3, H:8, O:1 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 3, H: 8, O: 1 });
  });
  it('3 heavy-atom bonds, all single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 3);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('no aromatic bonds', () => {
    assert.equal(heavyBonds(mol).filter(b => b.properties.aromatic).length, 0);
  });
  it('central carbon (CH) has 3 heavy neighbors and 1 H', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const center  = carbons.find(c => c.getHydrogenNeighbors(mol).length === 1);
    assert.ok(center);
    assert.equal(center.getHeavyNeighbors(mol).length, 3);
  });
  it('two methyl carbons each have 3 H', () => {
    const carbons  = [...mol.atoms.values()].filter(a => a.name === 'C');
    const methyls  = carbons.filter(c => c.getHydrogenNeighbors(mol).length === 3);
    assert.equal(methyls.length, 2);
  });
  it('oxygen has 1 H (hydroxyl)', () => {
    const o = [...mol.atoms.values()].find(a => a.name === 'O');
    assert.equal(o.getHydrogenNeighbors(mol).length, 1);
  });
});

// ---------------------------------------------------------------------------
// Ether linkage (C-O-C)
// ---------------------------------------------------------------------------

describe('parseINCHI — diethyl ether InChI=1S/C4H10O/c1-3-5-4-2/h3-4H2,1-2H3', () => {
  const mol = parseINCHI('InChI=1S/C4H10O/c1-3-5-4-2/h3-4H2,1-2H3');

  it('formula { C:4, H:10, O:1 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 4, H: 10, O: 1 });
  });
  it('4 heavy-atom bonds, all single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 4);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('oxygen has 2 heavy (carbon) neighbors and 0 H', () => {
    const o = [...mol.atoms.values()].find(a => a.name === 'O');
    assert.equal(o.getHeavyNeighbors(mol).length, 2);
    assert.equal(o.getHydrogenNeighbors(mol).length, 0);
  });
  it('two methylene carbons each have 2 H', () => {
    const carbons    = [...mol.atoms.values()].filter(a => a.name === 'C');
    const methylenes = carbons.filter(c => c.getHydrogenNeighbors(mol).length === 2);
    assert.equal(methylenes.length, 2);
  });
  it('two methyl carbons each have 3 H', () => {
    const carbons  = [...mol.atoms.values()].filter(a => a.name === 'C');
    const methyls  = carbons.filter(c => c.getHydrogenNeighbors(mol).length === 3);
    assert.equal(methyls.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Ring ketone
// ---------------------------------------------------------------------------

describe('parseINCHI — cyclohexanone InChI=1S/C6H10O/c7-6-4-2-1-3-5-6/h1-5H2', () => {
  const mol = parseINCHI('InChI=1S/C6H10O/c7-6-4-2-1-3-5-6/h1-5H2');

  it('formula { C:6, H:10, O:1 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 6, H: 10, O: 1 });
  });
  it('7 heavy-atom bonds total', () => {
    assert.equal(heavyBonds(mol).length, 7);
  });
  it('exactly 1 C=O double bond', () => {
    const doubles = heavyBonds(mol).filter(b => b.properties.order === 2);
    assert.equal(doubles.length, 1);
    const atoms   = doubles[0].atoms.map(id => mol.atoms.get(id).name).sort();
    assert.deepEqual(atoms, ['C', 'O']);
  });
  it('6 single bonds (5 C-C ring bonds + 1 more)', () => {
    const singles = heavyBonds(mol).filter(b => b.properties.order === 1);
    assert.equal(singles.length, 6);
  });
  it('no aromatic bonds', () => {
    assert.equal(heavyBonds(mol).filter(b => b.properties.aromatic).length, 0);
  });
  it('carbonyl carbon has 0 H and 3 heavy neighbors', () => {
    const carbons  = [...mol.atoms.values()].filter(a => a.name === 'C');
    const carbonyl = carbons.find(c => c.getHydrogenNeighbors(mol).length === 0);
    assert.ok(carbonyl);
    assert.equal(carbonyl.getHeavyNeighbors(mol).length, 3);
  });
  it('all ring carbons are in a ring', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    for (const c of carbons) {
      assert.equal(mol.isAtomInRing(c.id), true);
    }
  });
});

describe('parseINCHI — quinone-like dione InChI=1S/C10H12O2/c1-10(2,3)7-4-5-8(11)9(12)6-7/h4-6H,1-3H3', () => {
  const mol = parseINCHI('InChI=1S/C10H12O2/c1-10(2,3)7-4-5-8(11)9(12)6-7/h4-6H,1-3H3');

  it('has two C=O double bonds', () => {
    const carbonyls = heavyBonds(mol).filter(b => {
      const names = b.atoms.map(id => mol.atoms.get(id)?.name).sort();
      return b.properties.order === 2 && names[0] === 'C' && names[1] === 'O';
    });
    assert.equal(carbonyls.length, 2);
  });
  it('is not marked as a fully aromatic ring', () => {
    const aromaticRingBonds = heavyBonds(mol).filter(b => b.properties.aromatic);
    assert.ok(aromaticRingBonds.length < 6);
  });
});

// ---------------------------------------------------------------------------
// Internal alkyne
// ---------------------------------------------------------------------------

describe('parseINCHI — 2-butyne InChI=1S/C4H6/c1-3-4-2/h1-2H3', () => {
  const mol = parseINCHI('InChI=1S/C4H6/c1-3-4-2/h1-2H3');

  it('formula { C:4, H:6 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 4, H: 6 });
  });
  it('3 heavy-atom bonds', () => {
    assert.equal(heavyBonds(mol).length, 3);
  });
  it('exactly 1 triple bond', () => {
    const triples = heavyBonds(mol).filter(b => b.properties.order === 3);
    assert.equal(triples.length, 1);
  });
  it('2 single bonds flanking the triple bond', () => {
    const singles = heavyBonds(mol).filter(b => b.properties.order === 1);
    assert.equal(singles.length, 2);
  });
  it('triple-bond carbons have 0 H', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const sp      = carbons.filter(c => c.getHydrogenNeighbors(mol).length === 0);
    assert.equal(sp.length, 2);
  });
  it('methyl carbons have 3 H each', () => {
    const carbons  = [...mol.atoms.values()].filter(a => a.name === 'C');
    const methyls  = carbons.filter(c => c.getHydrogenNeighbors(mol).length === 3);
    assert.equal(methyls.length, 2);
  });
});

describe('parseINCHI — tetracyanoethylene InChI=1S/C6N4/c7-1-5(2-8)6(3-9)4-10', () => {
  const mol = parseINCHI('InChI=1S/C6N4/c7-1-5(2-8)6(3-9)4-10');

  it('formula { C:6, N:4 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 6, N: 4 });
  });
  it('has four nitrile triple bonds', () => {
    const triples = heavyBonds(mol).filter(b => {
      const names = b.atoms.map(id => mol.atoms.get(id)?.name).sort();
      return b.properties.order === 3 && names[0] === 'C' && names[1] === 'N';
    });
    assert.equal(triples.length, 4);
  });
  it('has one central C=C double bond', () => {
    const ccDoubles = heavyBonds(mol).filter(b => {
      const names = b.atoms.map(id => mol.atoms.get(id)?.name);
      return b.properties.order === 2 && names.every(name => name === 'C');
    });
    assert.equal(ccDoubles.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Aromatic ring with amino substituent
// ---------------------------------------------------------------------------

describe('parseINCHI — aniline InChI=1S/C6H7N/c7-6-4-2-1-3-5-6/h1-5H,7H2', () => {
  const mol = parseINCHI('InChI=1S/C6H7N/c7-6-4-2-1-3-5-6/h1-5H,7H2');

  it('formula { C:6, H:7, N:1 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 6, H: 7, N: 1 });
  });
  it('7 heavy-atom bonds total', () => {
    assert.equal(heavyBonds(mol).length, 7);
  });
  it('6 aromatic bonds (benzene ring)', () => {
    const aromatic = heavyBonds(mol).filter(b => b.properties.aromatic);
    assert.equal(aromatic.length, 6);
  });
  it('1 non-aromatic C-N single bond', () => {
    const nonAromatic = heavyBonds(mol).filter(b => !b.properties.aromatic);
    assert.equal(nonAromatic.length, 1);
    const atomNames   = nonAromatic[0].atoms.map(id => mol.atoms.get(id).name).sort();
    assert.deepEqual(atomNames, ['C', 'N']);
  });
  it('nitrogen has 2 H neighbors (NH2)', () => {
    const n = [...mol.atoms.values()].find(a => a.name === 'N');
    assert.equal(n.getHydrogenNeighbors(mol).length, 2);
  });
  it('ipso carbon (bonded to N) has 0 H', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const ipso    = carbons.find(c => c.getHeavyNeighbors(mol).some(nb => nb.name === 'N'));
    assert.ok(ipso);
    assert.equal(ipso.getHydrogenNeighbors(mol).length, 0);
  });
  it('aromatic ring preserves localized bond orders for rendering', () => {
    const ringBonds = heavyBonds(mol).filter(b => b.properties.aromatic);
    assert.equal(ringBonds.length, 6);
    assert.equal(ringBonds.filter(b => b.properties.localizedOrder === 2).length, 3);
    assert.equal(ringBonds.filter(b => b.properties.localizedOrder === 1).length, 3);
  });
});

// ---------------------------------------------------------------------------
// Aromatic ring with hydroxyl substituent
// ---------------------------------------------------------------------------

describe('parseINCHI — phenol InChI=1S/C6H6O/c7-6-4-2-1-3-5-6/h1-5,7H', () => {
  const mol = parseINCHI('InChI=1S/C6H6O/c7-6-4-2-1-3-5-6/h1-5,7H');

  it('formula { C:6, H:6, O:1 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 6, H: 6, O: 1 });
  });
  it('7 heavy-atom bonds total', () => {
    assert.equal(heavyBonds(mol).length, 7);
  });
  it('6 aromatic bonds (benzene ring)', () => {
    const aromatic = heavyBonds(mol).filter(b => b.properties.aromatic);
    assert.equal(aromatic.length, 6);
  });
  it('1 non-aromatic C-O single bond', () => {
    const nonAromatic = heavyBonds(mol).filter(b => !b.properties.aromatic);
    assert.equal(nonAromatic.length, 1);
    const atomNames   = nonAromatic[0].atoms.map(id => mol.atoms.get(id).name).sort();
    assert.deepEqual(atomNames, ['C', 'O']);
  });
  it('oxygen has 1 H (hydroxyl)', () => {
    const o = [...mol.atoms.values()].find(a => a.name === 'O');
    assert.equal(o.getHydrogenNeighbors(mol).length, 1);
  });
  it('ipso carbon (bonded to O) has 0 H', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const ipso    = carbons.find(c => c.getHeavyNeighbors(mol).some(nb => nb.name === 'O'));
    assert.ok(ipso);
    assert.equal(ipso.getHydrogenNeighbors(mol).length, 0);
  });
});

describe('parseINCHI — phenyllithium InChI=1S/C6H5.Li/c1-2-4-6-5-3-1;/h1-5H;/q-1;+1', () => {
  const mol = parseINCHI('InChI=1S/C6H5.Li/c1-2-4-6-5-3-1;/h1-5H;/q-1;+1');

  it('formula { C:6, H:5, Li:1 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 6, H: 5, Li: 1 });
  });
  it('has a lithium cation and one carbanionic ring carbon with no hydrogens', () => {
    const lithium = [...mol.atoms.values()].find(a => a.name === 'Li');
    const ringAnion = [...mol.atoms.values()].find(a =>
      a.name === 'C' &&
      a.properties.charge === -1 &&
      a.getHydrogenNeighbors(mol).length === 0
    );
    assert.ok(lithium);
    assert.equal(lithium.properties.charge, 1);
    assert.ok(ringAnion);
  });
  it('keeps the phenyl ring as alternating single and double bonds', () => {
    const ringBonds = heavyBonds(mol).filter(b => {
      const names = b.atoms.map(id => mol.atoms.get(id)?.name);
      return names[0] === 'C' && names[1] === 'C';
    });
    const orders = ringBonds.map(b => b.properties.order).sort((a, b) => a - b);
    assert.deepEqual(orders, [1, 1, 1, 2, 2, 2]);
    assert.equal(ringBonds.filter(b => b.properties.aromatic).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Vicinal dihalide
// ---------------------------------------------------------------------------

describe('parseINCHI — 1,2-dichloroethane InChI=1S/C2H4Cl2/c3-1-2-4/h1-2H2', () => {
  const mol = parseINCHI('InChI=1S/C2H4Cl2/c3-1-2-4/h1-2H2');

  it('formula { C:2, H:4, Cl:2 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 2, H: 4, Cl: 2 });
  });
  it('3 heavy-atom bonds, all single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 3);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('no aromatic bonds', () => {
    assert.equal(heavyBonds(mol).filter(b => b.properties.aromatic).length, 0);
  });
  it('each carbon has 2 H and 2 heavy neighbors', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    assert.equal(carbons.length, 2);
    for (const c of carbons) {
      assert.equal(c.getHydrogenNeighbors(mol).length, 2);
      assert.equal(c.getHeavyNeighbors(mol).length, 2);
    }
  });
  it('two chlorine atoms each bonded to one carbon', () => {
    const chlorines = [...mol.atoms.values()].filter(a => a.name === 'Cl');
    assert.equal(chlorines.length, 2);
    for (const cl of chlorines) {
      assert.equal(cl.getHeavyNeighbors(mol).length, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Polyol (three hydroxyl groups)
// ---------------------------------------------------------------------------

describe('parseINCHI — glycerol InChI=1S/C3H8O3/c4-1-3(6)2-5/h3-6H,1-2H2', () => {
  const mol = parseINCHI('InChI=1S/C3H8O3/c4-1-3(6)2-5/h3-6H,1-2H2');

  it('formula { C:3, H:8, O:3 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 3, H: 8, O: 3 });
  });
  it('5 heavy-atom bonds, all single', () => {
    const hb = heavyBonds(mol);
    assert.equal(hb.length, 5);
    for (const b of hb) {
      assert.equal(b.properties.order, 1);
    }
  });
  it('no aromatic bonds', () => {
    assert.equal(heavyBonds(mol).filter(b => b.properties.aromatic).length, 0);
  });
  it('three oxygen atoms each with 1 H (hydroxyl groups)', () => {
    const oxygens = [...mol.atoms.values()].filter(a => a.name === 'O');
    assert.equal(oxygens.length, 3);
    for (const o of oxygens) {
      assert.equal(o.getHydrogenNeighbors(mol).length, 1);
    }
  });
  it('central carbon has 1 H, 2 carbon neighbors and 1 oxygen neighbor', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const central = carbons.find(c => c.getHydrogenNeighbors(mol).length === 1);
    assert.ok(central);
    const heavyNbs = central.getHeavyNeighbors(mol);
    assert.equal(heavyNbs.filter(a => a.name === 'C').length, 2);
    assert.equal(heavyNbs.filter(a => a.name === 'O').length, 1);
  });
  it('terminal carbons each have 2 H and are each bonded to one oxygen', () => {
    const carbons  = [...mol.atoms.values()].filter(a => a.name === 'C');
    const terminal = carbons.filter(c => c.getHydrogenNeighbors(mol).length === 2);
    assert.equal(terminal.length, 2);
    for (const c of terminal) {
      assert.equal(c.getHeavyNeighbors(mol).filter(a => a.name === 'O').length, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Vinyl nitrile (double + single + triple bonds)
// ---------------------------------------------------------------------------

describe('parseINCHI — acrylonitrile InChI=1S/C3H3N/c1-2-3-4/h1H2,2H', () => {
  const mol = parseINCHI('InChI=1S/C3H3N/c1-2-3-4/h1H2,2H');

  it('formula { C:3, H:3, N:1 }', () => {
    assert.deepEqual(mol.getFormula(), { C: 3, H: 3, N: 1 });
  });
  it('3 heavy-atom bonds', () => {
    assert.equal(heavyBonds(mol).length, 3);
  });
  it('one C=C double bond', () => {
    const doubles = heavyBonds(mol).filter(b => b.properties.order === 2);
    assert.equal(doubles.length, 1);
    const atomNames = doubles[0].atoms.map(id => mol.atoms.get(id).name).sort();
    assert.deepEqual(atomNames, ['C', 'C']);
  });
  it('one C≡N triple bond', () => {
    const triples = heavyBonds(mol).filter(b => b.properties.order === 3);
    assert.equal(triples.length, 1);
    const atomNames = triples[0].atoms.map(id => mol.atoms.get(id).name).sort();
    assert.deepEqual(atomNames, ['C', 'N']);
  });
  it('one C-C single bond linking the vinyl and nitrile', () => {
    const singles = heavyBonds(mol).filter(b => b.properties.order === 1);
    assert.equal(singles.length, 1);
    const atomNames = singles[0].atoms.map(id => mol.atoms.get(id).name).sort();
    assert.deepEqual(atomNames, ['C', 'C']);
  });
  it('no aromatic bonds', () => {
    assert.equal(heavyBonds(mol).filter(b => b.properties.aromatic).length, 0);
  });
  it('nitrogen has 0 H', () => {
    const n = [...mol.atoms.values()].find(a => a.name === 'N');
    assert.equal(n.getHydrogenNeighbors(mol).length, 0);
  });
  it('sp-carbon (nitrile end) has 0 H', () => {
    const carbons = [...mol.atoms.values()].filter(a => a.name === 'C');
    const nitrileC = carbons.find(c =>
      c.getHeavyNeighbors(mol).some(nb => nb.name === 'N')
    );
    assert.ok(nitrileC);
    assert.equal(nitrileC.getHydrogenNeighbors(mol).length, 0);
  });
});

// ---------------------------------------------------------------------------
// toInChI
// ---------------------------------------------------------------------------

function roundTrip(smiles) {
  const mol = parseSMILES(smiles);
  const inchi = toInChI(mol);
  const mol2 = parseINCHI(inchi);
  assert.deepEqual(mol.getFormula(), mol2.getFormula(), `formula mismatch for ${smiles}: ${inchi}`);
  const hb1 = [...mol.bonds.values()].filter(b =>
    mol.atoms.get(b.atoms[0])?.name !== 'H' && mol.atoms.get(b.atoms[1])?.name !== 'H'
  ).length;
  const hb2 = [...mol2.bonds.values()].filter(b =>
    mol2.atoms.get(b.atoms[0])?.name !== 'H' && mol2.atoms.get(b.atoms[1])?.name !== 'H'
  ).length;
  assert.equal(hb1, hb2, `heavy bond count mismatch for ${smiles}: ${inchi}`);
  return inchi;
}

describe('toInChI — format', () => {
  it('starts with InChI=1S/', () => {
    assert.match(toInChI(parseSMILES('C')), /^InChI=1S\//);
  });

  it('methane — no /c layer', () => {
    const inchi = toInChI(parseSMILES('C'));
    assert.equal(inchi, 'InChI=1S/CH4/h1H4');
    assert.ok(!inchi.includes('/c'));
  });

  it('water — no /c layer', () => {
    assert.equal(toInChI(parseSMILES('O')), 'InChI=1S/H2O/h1H2');
  });

  it('CO2 — no /h layer', () => {
    const inchi = toInChI(parseSMILES('O=C=O'));
    assert.ok(inchi.startsWith('InChI=1S/CO2'));
    assert.ok(!inchi.includes('/h'));
  });

  it('argon — formula only', () => {
    assert.equal(toInChI(parseSMILES('[Ar]')), 'InChI=1S/Ar');
  });

  it('oxide dianion — charge layer q-2, no /h', () => {
    const inchi = toInChI(parseSMILES('[O-2]'));
    assert.ok(inchi.includes('/q-2'));
    assert.ok(!inchi.includes('/h'));
  });

  it('ammonium — charge layer q+1', () => {
    const inchi = toInChI(parseSMILES('[NH4+]'));
    assert.ok(inchi.includes('/q+1'));
  });

  it('neutral molecule — no /q layer', () => {
    assert.ok(!toInChI(parseSMILES('c1ccccc1')).includes('/q'));
  });

  it('disconnected components — dot-separated formula', () => {
    const inchi = toInChI(parseSMILES('C.N'));
    const formula = inchi.match(/InChI=1S\/([^/]+)/)?.[1];
    assert.ok(formula?.includes('.'), `expected dot in formula: ${formula}`);
  });

  it('disconnected components — semicolon-separated /h layer', () => {
    const inchi = toInChI(parseSMILES('C.N'));
    const hLayer = inchi.match(/\/h([^/]+)/)?.[1];
    assert.ok(hLayer?.includes(';'), `expected semicolon in /h: ${hLayer}`);
  });
});

describe('toInChI — H layer grouping', () => {
  it('benzene: all 6 atoms in one range', () => {
    const hLayer = toInChI(parseSMILES('c1ccccc1')).match(/\/h([^/]+)/)?.[1];
    assert.match(hLayer, /\d-\dH/);
  });

  it('cyclohexane: H2 per carbon', () => {
    const hLayer = toInChI(parseSMILES('C1CCCCC1')).match(/\/h([^/]+)/)?.[1];
    assert.ok(hLayer?.includes('H2'));
  });

  it('acetic acid: OH and CH3 separated', () => {
    const inchi = toInChI(parseSMILES('CC(=O)O'));
    const hLayer = inchi.match(/\/h([^/]+)/)?.[1];
    assert.ok(hLayer?.includes('H,') || hLayer?.includes(','), `h layer: ${hLayer}`);
  });
});

describe('toInChI — round-trip (formula + heavy bond count)', () => {
  it('methane',      () => roundTrip('C'));
  it('ethane',       () => roundTrip('CC'));
  it('propane',      () => roundTrip('CCC'));
  it('isobutane',    () => roundTrip('CC(C)C'));
  it('neopentane',   () => roundTrip('CC(C)(C)C'));
  it('benzene',      () => roundTrip('c1ccccc1'));
  it('cyclohexane',  () => roundTrip('C1CCCCC1'));
  it('cyclopentane', () => roundTrip('C1CCCC1'));
  it('naphthalene',  () => roundTrip('c1ccc2ccccc2c1'));
  it('acetic acid',  () => roundTrip('CC(=O)O'));
  it('ethanol',      () => roundTrip('CCO'));
  it('pyridine',     () => roundTrip('c1ccncc1'));
  it('water',        () => roundTrip('O'));
  it('ammonia',      () => roundTrip('N'));
  it('HCN',          () => roundTrip('C#N'));
  it('CO2',          () => roundTrip('O=C=O'));
  it('methane+ammonia (disconnected)', () => roundTrip('C.N'));
});

describe('toInChI — idempotence', () => {
  const molecules = ['C', 'CC', 'c1ccccc1', 'CC(=O)O', 'C1CCCCC1', 'c1ccncc1'];
  for (const smi of molecules) {
    it(`${smi}`, () => {
      const mol = parseSMILES(smi);
      const i1 = toInChI(mol);
      const i2 = toInChI(parseINCHI(i1));
      assert.equal(i1, i2, `not idempotent: first=${i1}, second=${i2}`);
    });
  }
});
