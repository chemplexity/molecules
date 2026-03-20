/**
 * SMILES corpus accuracy suite — ported from v1 test/test.js
 *
 * Tests both molecular formula and mass for each entry in the corpus.
 * Mass tolerance: ±0.01 g/mol.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/index.js';
import { molecularFormula, molecularMass } from '../../src/descriptors/molecular.js';

const EPS = 0.01; // g/mol tolerance

function formula(mol) {
  return molecularFormula(mol);
}

function assertMass(smiles, expected) {
  const mol = parseSMILES(smiles);
  assert.ok(
    Math.abs(molecularMass(mol) - expected) < EPS,
    `mass of ${smiles}: expected ≈${expected}, got ${molecularMass(mol)}`
  );
}

describe('SMILES corpus — Alkanes', () => {
  it('n-pentane CCCCC: C5H12', () => {
    assert.deepEqual(formula(parseSMILES('CCCCC')), { C: 5, H: 12 });
    assertMass('CCCCC', 72.151);
  });

  it('isopentane CC(C)CC: C5H12', () => {
    assert.deepEqual(formula(parseSMILES('CC(C)CC')), { C: 5, H: 12 });
    assertMass('CC(C)CC', 72.151);
  });

  it('neopentane CC(C)(C)C: C5H12', () => {
    assert.deepEqual(formula(parseSMILES('CC(C)(C)C')), { C: 5, H: 12 });
    assertMass('CC(C)(C)C', 72.151);
  });
});

describe('SMILES corpus — Alkenes', () => {
  it('2-butene CC=CC: C4H8', () => {
    assert.deepEqual(formula(parseSMILES('CC=CC')), { C: 4, H: 8 });
    assertMass('CC=CC', 56.108);
  });

  it('1-butene C=CCC: C4H8', () => {
    assert.deepEqual(formula(parseSMILES('C=CCC')), { C: 4, H: 8 });
    assertMass('C=CCC', 56.108);
  });

  it('cis-2-butene C/C=C\\C: C4H8', () => {
    assert.deepEqual(formula(parseSMILES('C/C=C\\C')), { C: 4, H: 8 });
    assertMass('C/C=C\\C', 56.108);
  });

  it('trans-2-butene C/C=C/C: C4H8', () => {
    assert.deepEqual(formula(parseSMILES('C/C=C/C')), { C: 4, H: 8 });
    assertMass('C/C=C/C', 56.108);
  });

  it('1,3-butadiene C=CC=C: C4H6', () => {
    assert.deepEqual(formula(parseSMILES('C=CC=C')), { C: 4, H: 6 });
    assertMass('C=CC=C', 54.092);
  });

  it('allene C=C=CC: C4H6', () => {
    assert.deepEqual(formula(parseSMILES('C=C=CC')), { C: 4, H: 6 });
    assertMass('C=C=CC', 54.092);
  });
});

describe('SMILES corpus — Alkynes', () => {
  it('2-butyne CC#CC: C4H6', () => {
    assert.deepEqual(formula(parseSMILES('CC#CC')), { C: 4, H: 6 });
    assertMass('CC#CC', 54.092);
  });

  it('1-butyne C#CCC: C4H6', () => {
    assert.deepEqual(formula(parseSMILES('C#CCC')), { C: 4, H: 6 });
    assertMass('C#CCC', 54.092);
  });
});

describe('SMILES corpus — Alcohols', () => {
  it('1-butanol OCCCC: C4H10O', () => {
    assert.deepEqual(formula(parseSMILES('OCCCC')), { C: 4, H: 10, O: 1 });
    assertMass('OCCCC', 74.123);
  });

  it('2-butanol CC(O)CC: C4H10O', () => {
    assert.deepEqual(formula(parseSMILES('CC(O)CC')), { C: 4, H: 10, O: 1 });
    assertMass('CC(O)CC', 74.123);
  });

  it('2-methyl-2-propanol CC(O)(C)C: C4H10O', () => {
    assert.deepEqual(formula(parseSMILES('CC(O)(C)C')), { C: 4, H: 10, O: 1 });
    assertMass('CC(O)(C)C', 74.123);
  });
});

describe('SMILES corpus — Carbonyls', () => {
  it('butanal C(=O)CCC: C4H8O', () => {
    assert.deepEqual(formula(parseSMILES('C(=O)CCC')), { C: 4, H: 8, O: 1 });
    assertMass('C(=O)CCC', 72.107);
  });

  it('butanone CC(=O)CC: C4H8O', () => {
    assert.deepEqual(formula(parseSMILES('CC(=O)CC')), { C: 4, H: 8, O: 1 });
    assertMass('CC(=O)CC', 72.107);
  });

  it('butyric acid OC(CCC)=O: C4H8O2', () => {
    assert.deepEqual(formula(parseSMILES('OC(CCC)=O')), { C: 4, H: 8, O: 2 });
    assertMass('OC(CCC)=O', 88.106);
  });

  it('methyl propanoate O=C(CC)OC: C4H8O2', () => {
    assert.deepEqual(formula(parseSMILES('O=C(CC)OC')), { C: 4, H: 8, O: 2 });
    assertMass('O=C(CC)OC', 88.106);
  });

  it('butyramide NC(CCC)=O: C4H9NO', () => {
    assert.deepEqual(formula(parseSMILES('NC(CCC)=O')), { C: 4, H: 9, N: 1, O: 1 });
    assertMass('NC(CCC)=O', 87.122);
  });

  it('peroxybutyric acid O=C(CCC)OO: C4H8O3', () => {
    assert.deepEqual(formula(parseSMILES('O=C(CCC)OO')), { C: 4, H: 8, O: 3 });
    assertMass('O=C(CCC)OO', 104.105);
  });

  it('butanoyl chloride ClC(CCC)=O: C4H7ClO', () => {
    assert.deepEqual(formula(parseSMILES('ClC(CCC)=O')), { C: 4, H: 7, Cl: 1, O: 1 });
    assertMass('ClC(CCC)=O', 106.549);
  });

  it('acetic propionic anhydride O=C(CC)OC(C)=O: C5H8O3', () => {
    assert.deepEqual(formula(parseSMILES('O=C(CC)OC(C)=O')), { C: 5, H: 8, O: 3 });
    assertMass('O=C(CC)OC(C)=O', 116.116);
  });
});

describe('SMILES corpus — Cycloalkanes', () => {
  it('cyclohexane C1CCCCC1: C6H12', () => {
    assert.deepEqual(formula(parseSMILES('C1CCCCC1')), { C: 6, H: 12 });
    assertMass('C1CCCCC1', 84.162);
  });

  it('bicyclohexyl C1CCCCC1C2CCCCC2: C12H22', () => {
    assert.deepEqual(formula(parseSMILES('C1CCCCC1C2CCCCC2')), { C: 12, H: 22 });
    assertMass('C1CCCCC1C2CCCCC2', 166.308);
  });

  it('spiro[5.5]undecane C12(CCCCC1)CCCCC2: C11H20', () => {
    assert.deepEqual(formula(parseSMILES('C12(CCCCC1)CCCCC2')), { C: 11, H: 20 });
    assertMass('C12(CCCCC1)CCCCC2', 152.281);
  });
});

describe('SMILES corpus — Cycloalkenes', () => {
  it('1,4-cyclohexadiene C1C=CCC=C1: C6H8', () => {
    assert.deepEqual(formula(parseSMILES('C1C=CCC=C1')), { C: 6, H: 8 });
    assertMass('C1C=CCC=C1', 80.130);
  });

  it('cyclooctatetraene [C@H]1=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H]1: C8H8', () => {
    assert.deepEqual(formula(parseSMILES('[C@H]1=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H]1')), { C: 8, H: 8 });
    assertMass('[C@H]1=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H]1', 104.152);
  });
});

describe('SMILES corpus — Aromatic', () => {
  it('benzene c1ccccc1: C6H6', () => {
    assert.deepEqual(formula(parseSMILES('c1ccccc1')), { C: 6, H: 6 });
    assertMass('c1ccccc1', 78.114);
  });

  it('benzyl alcohol OCc1ccccc1: C7H8O', () => {
    assert.deepEqual(formula(parseSMILES('OCc1ccccc1')), { C: 7, H: 8, O: 1 });
    assertMass('OCc1ccccc1', 108.140);
  });

  it('biphenyl c1ccccc1-c2ccccc2: C12H10', () => {
    assert.deepEqual(formula(parseSMILES('c1ccccc1-c2ccccc2')), { C: 12, H: 10 });
    assertMass('c1ccccc1-c2ccccc2', 154.212);
  });

  it('anthracene C12=CC=CC=C1C3=C(C=CC=C3)C=C2: C14H10', () => {
    assert.deepEqual(formula(parseSMILES('C12=CC=CC=C1C3=C(C=CC=C3)C=C2')), { C: 14, H: 10 });
    assertMass('C12=CC=CC=C1C3=C(C=CC=C3)C=C2', 178.223);
  });
});

describe('SMILES corpus — Heteroaromatic', () => {
  it('pyrrole C1=CC=CN1: C4H5N', () => {
    assert.deepEqual(formula(parseSMILES('C1=CC=CN1')), { C: 4, H: 5, N: 1 });
    assertMass('C1=CC=CN1', 67.091);
  });

  it('furan c1occc1: C4H4O', () => {
    assert.deepEqual(formula(parseSMILES('c1occc1')), { C: 4, H: 4, O: 1 });
    assertMass('c1occc1', 68.075);
  });

  it('thiophene c1sccc1: C4H4S', () => {
    assert.deepEqual(formula(parseSMILES('c1sccc1')), { C: 4, H: 4, S: 1 });
    assertMass('c1sccc1', 84.136);
  });
});

describe('SMILES corpus — Charged species', () => {
  it('methyl cation [CH3+]: C1H3', () => {
    assert.deepEqual(formula(parseSMILES('[CH3+]')), { C: 1, H: 3 });
    assertMass('[CH3+]', 15.036);
  });

  it('methyl anion [CH3-]: C1H3', () => {
    assert.deepEqual(formula(parseSMILES('[CH3-]')), { C: 1, H: 3 });
    assertMass('[CH3-]', 15.036);
  });
});

describe('SMILES corpus — Salts', () => {
  it('sodium chloride [Na+].[Cl-]: NaCl', () => {
    assert.deepEqual(formula(parseSMILES('[Na+].[Cl-]')), { Na: 1, Cl: 1 });
    assertMass('[Na+].[Cl-]', 58.440);
  });

  it('ammonium thiosulfate [NH4+].[NH4+].[O-]S(=O)(=O)[S-]: N2H8O3S2', () => {
    assert.deepEqual(formula(parseSMILES('[NH4+].[NH4+].[O-]S(=O)(=O)[S-]')), { N: 2, H: 8, O: 3, S: 2 });
    assertMass('[NH4+].[NH4+].[O-]S(=O)(=O)[S-]', 148.195);
  });
});

describe('SMILES corpus — Isotopes', () => {
  it('[13C] isobutane C[13CH](C)C: C4H10', () => {
    assert.deepEqual(formula(parseSMILES('C[13CH](C)C')), { C: 4, H: 10 });
    assertMass('C[13CH](C)C', 59.116);
  });

  it('[14C] isobutane C[14CH](C)C: C4H10', () => {
    assert.deepEqual(formula(parseSMILES('C[14CH](C)C')), { C: 4, H: 10 });
    assertMass('C[14CH](C)C', 60.116);
  });

  it('[14C] complex CCOC(Cl)C1C[14C](I)C1NOCC(C)CCC: C13H24ClINO2', () => {
    // [14C] has no explicit H in the bracket → 0 H per SMILES spec
    assert.deepEqual(
      formula(parseSMILES('CCOC(Cl)C1C[14C](I)C1NOCC(C)CCC')),
      { C: 13, H: 24, Cl: 1, I: 1, N: 1, O: 2 }
    );
    assertMass('CCOC(Cl)C1C[14C](I)C1NOCC(C)CCC', 390.686);
  });

  it('[13CH3] at chain start bonds to ring: [13CH3][C@H]1CC[C@@H](O)[C@H](C1)N: C7H15NO', () => {
    assert.deepEqual(
      formula(parseSMILES('[13CH3][C@H]1CC[C@@H](O)[C@H](C1)N')),
      { C: 7, H: 15, N: 1, O: 1 }
    );
  });

  it('[2H] at chain start bonds to next atom: [2H]OC([2H])([2H])C: C2H6O', () => {
    assert.deepEqual(
      formula(parseSMILES('[2H]OC([2H])([2H])C')),
      { C: 2, H: 6, O: 1 }
    );
  });

  it('[2H] as sole substituent: [2H]C: C1H4', () => {
    assert.deepEqual(
      formula(parseSMILES('[2H]C')),
      { C: 1, H: 4 }
    );
  });
});

describe('SMILES corpus — Chiral', () => {
  it('(R)-1-bromo-1-chloroethane C[C@@H](Br)Cl: C2H4BrCl', () => {
    assert.deepEqual(formula(parseSMILES('C[C@@H](Br)Cl')), { C: 2, H: 4, Br: 1, Cl: 1 });
    assertMass('C[C@@H](Br)Cl', 143.408);
  });

  it('(S)-1-bromo-1-chloroethane C[C@H](Br)Cl: C2H4BrCl', () => {
    assert.deepEqual(formula(parseSMILES('C[C@H](Br)Cl')), { C: 2, H: 4, Br: 1, Cl: 1 });
    assertMass('C[C@H](Br)Cl', 143.408);
  });

  it('glucose (chiral mixed): C6H12O6', () => {
    assert.deepEqual(
      formula(parseSMILES('O[C@@]([H])(O1)[C@@](O)([H])[C@@]([H])(O)[C@]1([C@@](CO)(O)[H])[H]')),
      { C: 6, H: 12, O: 6 }
    );
    assertMass('O[C@@]([H])(O1)[C@@](O)([H])[C@@]([H])(O)[C@]1([C@@](CO)(O)[H])[H]', 180.156);
  });
});

describe('SMILES corpus — Amino acids', () => {
  it('alanine NC(C)C(O)=O: C3H7NO2', () => {
    assert.deepEqual(formula(parseSMILES('NC(C)C(O)=O')), { C: 3, H: 7, N: 1, O: 2 });
    assertMass('NC(C)C(O)=O', 89.094);
  });

  it('arginine NC(CCCNC(N)=N)C(O)=O: C6H14N4O2', () => {
    assert.deepEqual(formula(parseSMILES('NC(CCCNC(N)=N)C(O)=O')), { C: 6, H: 14, N: 4, O: 2 });
    assertMass('NC(CCCNC(N)=N)C(O)=O', 174.204);
  });

  it('asparagine NC(CC(N)=O)C(O)=O: C4H8N2O3', () => {
    assert.deepEqual(formula(parseSMILES('NC(CC(N)=O)C(O)=O')), { C: 4, H: 8, N: 2, O: 3 });
    assertMass('NC(CC(N)=O)C(O)=O', 132.119);
  });

  it('aspartate NC(CC(O)=O)C(O)=O: C4H7NO4', () => {
    assert.deepEqual(formula(parseSMILES('NC(CC(O)=O)C(O)=O')), { C: 4, H: 7, N: 1, O: 4 });
    assertMass('NC(CC(O)=O)C(O)=O', 133.103);
  });

  it('cysteine NC(CS)C(O)=O: C3H7NO2S', () => {
    assert.deepEqual(formula(parseSMILES('NC(CS)C(O)=O')), { C: 3, H: 7, N: 1, O: 2, S: 1 });
    assertMass('NC(CS)C(O)=O', 121.154);
  });

  it('glutamate NC(CCC(O)=O)C(O)=O: C5H9NO4', () => {
    assert.deepEqual(formula(parseSMILES('NC(CCC(O)=O)C(O)=O')), { C: 5, H: 9, N: 1, O: 4 });
    assertMass('NC(CCC(O)=O)C(O)=O', 147.130);
  });

  it('glutamine NC(CCC(N)=O)C(O)=O: C5H10N2O3', () => {
    assert.deepEqual(formula(parseSMILES('NC(CCC(N)=O)C(O)=O')), { C: 5, H: 10, N: 2, O: 3 });
    assertMass('NC(CCC(N)=O)C(O)=O', 146.146);
  });

  it('glycine NC([H])C(O)=O: C2H5NO2', () => {
    assert.deepEqual(formula(parseSMILES('NC([H])C(O)=O')), { C: 2, H: 5, N: 1, O: 2 });
    assertMass('NC([H])C(O)=O', 75.067);
  });

  it('histidine NC(CC1=CNC=N1)C(O)=O: C6H9N3O2', () => {
    assert.deepEqual(formula(parseSMILES('NC(CC1=CNC=N1)C(O)=O')), { C: 6, H: 9, N: 3, O: 2 });
    assertMass('NC(CC1=CNC=N1)C(O)=O', 155.157);
  });

  it('isoleucine NC(C(CC)C)C(O)=O: C6H13NO2', () => {
    assert.deepEqual(formula(parseSMILES('NC(C(CC)C)C(O)=O')), { C: 6, H: 13, N: 1, O: 2 });
    assertMass('NC(C(CC)C)C(O)=O', 131.175);
  });
});

describe('SMILES corpus — Relaxed syntax', () => {
  it('ethanol with extra parens C((C))O: C2H6O', () => {
    assert.deepEqual(formula(parseSMILES('C((C))O')), { C: 2, H: 6, O: 1 });
    assertMass('C((C))O', 46.069);
  });

  it('piperidine with outer parens (N1CCCCC1): C5H11N', () => {
    assert.deepEqual(formula(parseSMILES('(N1CCCCC1)')), { C: 5, H: 11, N: 1 });
    assertMass('(N1CCCCC1)', 85.150);
  });

  it('deeply nested C22 chain: C22H46', () => {
    assert.deepEqual(
      formula(parseSMILES('C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C))))))))))))))))))))C')),
      { C: 22, H: 46 }
    );
    assertMass('C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C))))))))))))))))))))C', 310.5988);
  });
});

describe('SMILES corpus — Advanced / Other', () => {
  it('CC(=O)C(Cl)CC(C(C)C)C=C: C10H17ClO', () => {
    assert.deepEqual(formula(parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C')), { C: 10, H: 17, Cl: 1, O: 1 });
    assertMass('CC(=O)C(Cl)CC(C(C)C)C=C', 188.695);
  });

  it('C2C(=O)C1COCCC1CC2: C9H14O2', () => {
    assert.deepEqual(formula(parseSMILES('C2C(=O)C1COCCC1CC2')), { C: 9, H: 14, O: 2 });
    assertMass('C2C(=O)C1COCCC1CC2', 154.209);
  });

  it('CC(CC(Cl)CCO)C: C7H15ClO', () => {
    assert.deepEqual(formula(parseSMILES('CC(CC(Cl)CCO)C')), { C: 7, H: 15, Cl: 1, O: 1 });
    assertMass('CC(CC(Cl)CCO)C', 150.646);
  });

  it('CC1C(CC(CC1C)CCO)=O: C10H18O2', () => {
    assert.deepEqual(formula(parseSMILES('CC1C(CC(CC1C)CCO)=O')), { C: 10, H: 18, O: 2 });
    assertMass('CC1C(CC(CC1C)CCO)=O', 170.252);
  });

  it('isoleucine duplicate NC(C(CC)C)C(O)=O: C6H13NO2', () => {
    assert.deepEqual(formula(parseSMILES('NC(C(CC)C)C(O)=O')), { C: 6, H: 13, N: 1, O: 2 });
    assertMass('NC(C(CC)C)C(O)=O', 131.175);
  });
});

// ---------------------------------------------------------------------------
// Transition-metal / bracket-atom elements not in the organic grammar
// These were previously misidentified because sub-patterns inside [...]
// matched aromatic atom rules (e.g. 'n' in 'Zn' matched aromatic-N).
// ---------------------------------------------------------------------------
describe('SMILES corpus — Transition-metal bracket atoms', () => {
  it('zinc chloride [Zn+2].[Cl-].[Cl-]: ZnCl2', () => {
    const mol = parseSMILES('[Zn+2].[Cl-].[Cl-]');
    assert.deepEqual(formula(mol), { Zn: 1, Cl: 2 });
    assert.equal(mol.properties.charge, 0);
  });

  it('iron(III) chloride [Fe+3].[Cl-].[Cl-].[Cl-]: FeCl3', () => {
    const mol = parseSMILES('[Fe+3].[Cl-].[Cl-].[Cl-]');
    assert.deepEqual(formula(mol), { Fe: 1, Cl: 3 });
    assert.equal(mol.properties.charge, 0);
  });

  it('manganese(II) bromide [Mn+2].[Br-].[Br-]: MnBr2', () => {
    const mol = parseSMILES('[Mn+2].[Br-].[Br-]');
    assert.deepEqual(formula(mol), { Mn: 1, Br: 2 });
  });

  it('copper(I) iodide [Cu+].[I-]: CuI', () => {
    const mol = parseSMILES('[Cu+].[I-]');
    assert.deepEqual(formula(mol), { Cu: 1, I: 1 });
  });

  it('cobalt(II) chloride [Co+2].[Cl-].[Cl-]: CoCl2', () => {
    const mol = parseSMILES('[Co+2].[Cl-].[Cl-]');
    assert.deepEqual(formula(mol), { Co: 1, Cl: 2 });
  });

  it('calcium fluoride [Ca+2].[F-].[F-]: CaF2', () => {
    const mol = parseSMILES('[Ca+2].[F-].[F-]');
    assert.deepEqual(formula(mol), { Ca: 1, F: 2 });
    assert.equal(mol.properties.charge, 0);
  });

  it('palladium(II) chloride [Pd+2].[Cl-].[Cl-]: PdCl2', () => {
    const mol = parseSMILES('[Pd+2].[Cl-].[Cl-]');
    assert.deepEqual(formula(mol), { Pd: 1, Cl: 2 });
  });

  it('tin(IV) chloride [Sn+4].[Cl-].[Cl-].[Cl-].[Cl-]: SnCl4', () => {
    const mol = parseSMILES('[Sn+4].[Cl-].[Cl-].[Cl-].[Cl-]');
    assert.deepEqual(formula(mol), { Sn: 1, Cl: 4 });
  });
});
