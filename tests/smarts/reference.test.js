import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { matchesSMARTS, functionalGroups } from '../../src/smarts/index.js';

const fg = functionalGroups;

function mol(smiles) {
  return parseSMILES(smiles).stripHydrogens();
}

// ---------------------------------------------------------------------------
// Hydrocarbons
// ---------------------------------------------------------------------------

describe('functionalGroups — hydrocarbons', () => {
  // X-based SMARTS count all bonds including H; use non-stripped molecules
  it('alkene found in ethene', () => assert.equal(matchesSMARTS(parseSMILES('C=C'), fg.alkene.smarts), true));
  it('alkene NOT found in ethane', () => assert.equal(matchesSMARTS(parseSMILES('CC'), fg.alkene.smarts), false));
  it('alkyne found in acetylene', () => assert.equal(matchesSMARTS(parseSMILES('C#C'), fg.alkyne.smarts), true));
  it('arene found in benzene', () => assert.equal(matchesSMARTS(mol('c1ccccc1'), fg.arene.smarts), true));
  it('arene NOT found in cyclohexane', () => assert.equal(matchesSMARTS(mol('C1CCCCC1'), fg.arene.smarts), false));
});

// ---------------------------------------------------------------------------
// Oxygen functional groups
// ---------------------------------------------------------------------------

describe('functionalGroups — oxygen groups', () => {
  it('alcohol found in ethanol', () => assert.equal(matchesSMARTS(parseSMILES('CCO'), fg.alcohol.smarts), true));
  it('alcohol NOT found in diethyl ether', () => assert.equal(matchesSMARTS(mol('CCOCC'), fg.alcohol.smarts), false));
  it('phenol found in phenol', () => assert.equal(matchesSMARTS(parseSMILES('Oc1ccccc1'), fg.phenol.smarts), true));
  it('ether found in dimethyl ether', () => assert.equal(matchesSMARTS(mol('COC'), fg.ether.smarts), true));
  it('aldehyde found in acetaldehyde', () => assert.equal(matchesSMARTS(parseSMILES('CC=O'), fg.aldehyde.smarts), true));
  it('ketone found in acetone', () => assert.equal(matchesSMARTS(mol('CC(=O)C'), fg.ketone.smarts), true));
  it('ketone NOT found in acetaldehyde', () => assert.equal(matchesSMARTS(mol('CC=O'), fg.ketone.smarts), false));
  it('carboxylicAcid found in acetic acid', () => assert.equal(matchesSMARTS(parseSMILES('CC(=O)O'), fg.carboxylicAcid.smarts), true));
  it('ester found in methyl acetate', () => assert.equal(matchesSMARTS(mol('CC(=O)OC'), fg.ester.smarts), true));
  it('ester NOT found in acetic acid', () => assert.equal(matchesSMARTS(parseSMILES('CC(=O)O'), fg.ester.smarts), false));
  it('carbonyl found in both aldehyde and ketone', () => {
    assert.equal(matchesSMARTS(parseSMILES('CC=O'), fg.carbonyl.smarts), true);
    assert.equal(matchesSMARTS(mol('CC(=O)C'), fg.carbonyl.smarts), true);
  });
  it('epoxide found in ethylene oxide', () => assert.equal(matchesSMARTS(mol('C1OC1'), fg.epoxide.smarts), true));
  it('epoxide NOT found in oxetane', () => assert.equal(matchesSMARTS(mol('C1COC1'), fg.epoxide.smarts), false));
  it('anhydride found in acetic anhydride', () => assert.equal(matchesSMARTS(mol('CC(=O)OC(=O)C'), fg.anhydride.smarts), true));
  it('acylHalide found in acetyl chloride', () => assert.equal(matchesSMARTS(mol('CC(=O)Cl'), fg.acylHalide.smarts), true));
  it('peroxide found in hydrogen peroxide', () => assert.equal(matchesSMARTS(parseSMILES('OO'), fg.peroxide.smarts), true));
});

// ---------------------------------------------------------------------------
// Nitrogen functional groups
// ---------------------------------------------------------------------------

describe('functionalGroups — nitrogen groups', () => {
  it('primaryAmine found in methylamine', () => assert.equal(matchesSMARTS(parseSMILES('CN'), fg.primaryAmine.smarts), true));
  it('secondaryAmine found in dimethylamine', () => assert.equal(matchesSMARTS(parseSMILES('CNC'), fg.secondaryAmine.smarts), true));
  it('tertiaryAmine found in trimethylamine', () => assert.equal(matchesSMARTS(mol('CN(C)C'), fg.tertiaryAmine.smarts), true));
  it('amide found in acetamide', () => assert.equal(matchesSMARTS(parseSMILES('CC(=O)N'), fg.amide.smarts), true));
  it('nitrile found in acetonitrile', () => assert.equal(matchesSMARTS(mol('CC#N'), fg.nitrile.smarts), true));
  it('nitro found in nitrobenzene (neutral form)', () => assert.equal(matchesSMARTS(mol('c1ccc([N+](=O)[O-])cc1'), fg.nitro.smarts), true));
  it('imine found in an imine', () => assert.equal(matchesSMARTS(parseSMILES('CC=NC'), fg.imine.smarts), true));
  it('urea found in urea', () => assert.equal(matchesSMARTS(parseSMILES('NC(=O)N'), fg.urea.smarts), true));
  it('isocyanate found in methyl isocyanate', () => assert.equal(matchesSMARTS(mol('CN=C=O'), fg.isocyanate.smarts), true));
  it('hydrazine found in hydrazine', () => assert.equal(matchesSMARTS(parseSMILES('NN'), fg.hydrazine.smarts), true));
});

// ---------------------------------------------------------------------------
// Sulfur functional groups
// ---------------------------------------------------------------------------

describe('functionalGroups — sulfur groups', () => {
  it('thiol found in methanethiol', () => assert.equal(matchesSMARTS(parseSMILES('CS'), fg.thiol.smarts), true));
  it('sulfide found in dimethyl sulfide', () => assert.equal(matchesSMARTS(mol('CSC'), fg.sulfide.smarts), true));
  it('disulfide found in dimethyl disulfide', () => assert.equal(matchesSMARTS(mol('CSSC'), fg.disulfide.smarts), true));
  it('sulfone found in DMSO2', () => assert.equal(matchesSMARTS(mol('CS(=O)(=O)C'), fg.sulfone.smarts), true));
  it('sulfonamide found in methanesulfonamide', () => assert.equal(matchesSMARTS(parseSMILES('CS(=O)(=O)N'), fg.sulfonamide.smarts), true));
});

// ---------------------------------------------------------------------------
// Halogens
// ---------------------------------------------------------------------------

describe('functionalGroups — halogens', () => {
  it('organofluoride found in fluoromethane', () => assert.equal(matchesSMARTS(mol('CF'), fg.organofluoride.smarts), true));
  it('organochloride found in chloromethane', () => assert.equal(matchesSMARTS(mol('CCl'), fg.organochloride.smarts), true));
  it('organobromide found in bromomethane', () => assert.equal(matchesSMARTS(mol('CBr'), fg.organobromide.smarts), true));
  it('organohalide found in any of the above', () => {
    assert.equal(matchesSMARTS(mol('CF'), fg.organohalide.smarts), true);
    assert.equal(matchesSMARTS(mol('CI'), fg.organohalide.smarts), true);
  });
  it('arylHalide found in chlorobenzene', () => assert.equal(matchesSMARTS(mol('c1ccccc1Cl'), fg.arylHalide.smarts), true));
  it('arylHalide NOT found in chloromethane', () => assert.equal(matchesSMARTS(mol('CCl'), fg.arylHalide.smarts), false));
});

// ---------------------------------------------------------------------------
// Aromatic heterocycles
// ---------------------------------------------------------------------------

describe('functionalGroups — aromatic heterocycles', () => {
  it('pyridine found in pyridine', () => assert.equal(matchesSMARTS(mol('c1ccncc1'), fg.pyridine.smarts), true));
  it('pyridine NOT found in benzene', () => assert.equal(matchesSMARTS(mol('c1ccccc1'), fg.pyridine.smarts), false));
  it('furan found in furan', () => assert.equal(matchesSMARTS(mol('c1ccoc1'), fg.furan.smarts), true));
  it('thiophene found in thiophene', () => assert.equal(matchesSMARTS(mol('c1ccsc1'), fg.thiophene.smarts), true));
  it('quinoline found in quinoline', () => assert.equal(matchesSMARTS(mol('c1ccc2ncccc2c1'), fg.quinoline.smarts), true));
  it('naphthalene found in naphthalene', () => assert.equal(matchesSMARTS(mol('c1ccc2ccccc2c1'), fg.naphthalene.smarts), true));
  it('naphthalene NOT found in benzene', () => assert.equal(matchesSMARTS(mol('c1ccccc1'), fg.naphthalene.smarts), false));
});

// ---------------------------------------------------------------------------
// Sanity: every entry has name and smarts string
// ---------------------------------------------------------------------------

describe('functionalGroups — schema', () => {
  for (const [key, entry] of Object.entries(functionalGroups)) {
    it(`${key} has name and smarts`, () => {
      assert.equal(typeof entry.name, 'string');
      assert.equal(typeof entry.smarts, 'string');
      assert.ok(entry.name.length > 0, 'name is non-empty');
      assert.ok(entry.smarts.length > 0, 'smarts is non-empty');
    });
  }
});
