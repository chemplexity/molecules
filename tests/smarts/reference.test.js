import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { matchesSMARTS, functionalGroups } from '../../src/smarts/index.js';
import { findSMARTS } from '../../src/smarts/search.js';

const fg = functionalGroups;

function mol(smiles) {
  return parseSMILES(smiles);
}

// ---------------------------------------------------------------------------
// Hydrocarbons
// ---------------------------------------------------------------------------

describe('functionalGroups — hydrocarbons', () => {
  // X-based SMARTS count all bonds including H; use non-stripped molecules
  it('alkene found in ethene', () => assert.equal(matchesSMARTS(parseSMILES('C=C'), fg.alkene.smarts), true));
  it('alkene NOT found in ethane', () => assert.equal(matchesSMARTS(parseSMILES('CC'), fg.alkene.smarts), false));
  it('alkyne found in acetylene', () => assert.equal(matchesSMARTS(parseSMILES('C#C'), fg.alkyne.smarts), true));
  it('cyclopentadiene found in cyclopentadiene', () => assert.equal(matchesSMARTS(mol('C1=CCC=C1'), fg.cyclopentadiene.smarts), true));
  it('cyclohexadiene found in 1,3-cyclohexadiene', () => assert.equal(matchesSMARTS(mol('C1=CCCC=C1'), fg.cyclohexadiene.smarts), true));
  it('cycloheptatriene found in cycloheptatriene', () => assert.equal(matchesSMARTS(mol('C1=CC=CCC=C1'), fg.cycloheptatriene.smarts), true));
  it('fused benzenoid polycycle exposes cyclohexadiene subrings', () => {
    const molecule = mol('C12C4=CC=CC1=CC=CC2=Cc3c4cccc3');
    const mappings = [...findSMARTS(molecule, fg.cyclohexadiene.smarts)];
    assert.equal(mappings.length, 2);
  });
  it('bicyclobutane registers two cyclopropane matches', () => {
    const molecule = parseSMILES('C1C2C1C2');
    const mappings = [...findSMARTS(molecule, fg.cyclopropane.smarts)];
    assert.equal(mappings.length, 2);

    const mergedByAnchor = new Map();
    for (const mapping of mappings) {
      const anchor = mapping.values().next().value;
      if (!mergedByAnchor.has(anchor)) {
        mergedByAnchor.set(anchor, new Set());
      }
      for (const atomId of mapping.values()) {
        mergedByAnchor.get(anchor).add(atomId);
      }
    }

    assert.equal(mergedByAnchor.size, 2);
  });
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
  it('generic organohalides do not overlap acyl halides', () => {
    const acetylChloride = mol('CC(=O)Cl');
    assert.equal(matchesSMARTS(acetylChloride, fg.acylHalide.smarts), true);
    assert.equal(matchesSMARTS(acetylChloride, fg.organochloride.smarts), false);
    assert.equal(matchesSMARTS(acetylChloride, fg.organohalide.smarts), false);
  });
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
});

// ---------------------------------------------------------------------------
// Phosphorus functional groups
// ---------------------------------------------------------------------------

describe('functionalGroups — phosphorus groups', () => {
  it('phosphoricAcid found in phosphoric acid', () => assert.equal(matchesSMARTS(mol('P(=O)(O)(O)O'), fg.phosphoricAcid.smarts), true));
  it('phosphoricAcid NOT found in trimethyl phosphate', () => assert.equal(matchesSMARTS(mol('COP(=O)(OC)OC'), fg.phosphoricAcid.smarts), false));
  it('phosphate (triester) found in trimethyl phosphate', () => assert.equal(matchesSMARTS(mol('COP(=O)(OC)OC'), fg.phosphate.smarts), true));
  it('phosphate (triester) NOT found in methyl dihydrogen phosphate', () => assert.equal(matchesSMARTS(mol('COP(=O)(O)O'), fg.phosphate.smarts), false));
  it('phosphate (triester) NOT found in phosphoric acid', () => assert.equal(matchesSMARTS(mol('P(=O)(O)(O)O'), fg.phosphate.smarts), false));
  it('phosphateDiester found in [PH](=O)(OC)(O)OC', () => assert.equal(matchesSMARTS(mol('[PH](=O)(OC)(O)OC'), fg.phosphateDiester.smarts), true));
  it('phosphateDiester NOT found in trimethyl phosphate', () => assert.equal(matchesSMARTS(mol('COP(=O)(OC)OC'), fg.phosphateDiester.smarts), false));
  it('phosphateMonoester found in methyl dihydrogen phosphate', () => assert.equal(matchesSMARTS(mol('COP(=O)(O)O'), fg.phosphateMonoester.smarts), true));
  it('phosphateMonoester NOT found in trimethyl phosphate', () => assert.equal(matchesSMARTS(mol('COP(=O)(OC)OC'), fg.phosphateMonoester.smarts), false));
  it('phosphonate found in dimethyl methylphosphonate', () => assert.equal(matchesSMARTS(mol('CP(=O)(OC)OC'), fg.phosphonate.smarts), true));
  it('phosphonate NOT found in trimethyl phosphate (no P-C bond)', () => assert.equal(matchesSMARTS(mol('COP(=O)(OC)OC'), fg.phosphonate.smarts), false));
  it('phosphonate NOT found in [PH] ester (no P-C bond)', () => assert.equal(matchesSMARTS(mol('[PH](=O)(OC)(OC)OC'), fg.phosphonate.smarts), false));
  it('phosphine found in trimethylphosphine', () => assert.equal(matchesSMARTS(mol('CP(C)C'), fg.phosphine.smarts), true));
  it('phosphineOxide found in trimethylphosphine oxide', () => assert.equal(matchesSMARTS(mol('CP(=O)(C)C'), fg.phosphineOxide.smarts), true));
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
