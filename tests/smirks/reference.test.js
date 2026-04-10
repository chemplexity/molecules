import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySMIRKS, parseSMILES, parseSMIRKS, reactionTemplates, toSMILES } from '../../src/index.js';

function sortDotSmiles(smiles) {
  return smiles.split('.').sort().join('.');
}

describe('reactionTemplates — schema', () => {
  for (const [key, entry] of Object.entries(reactionTemplates)) {
    it(`${key} has name and smirks`, () => {
      assert.equal(typeof entry.name, 'string');
      assert.equal(typeof entry.smirks, 'string');
      assert.ok(entry.name.length > 0, 'name is non-empty');
      assert.ok(entry.smirks.length > 0, 'smirks is non-empty');
    });
  }
});

describe('reactionTemplates — parseability', () => {
  for (const [key, entry] of Object.entries(reactionTemplates)) {
    it(`${key} parses as SMIRKS`, () => {
      const transform = parseSMIRKS(entry.smirks);
      assert.ok(transform.reactant.atoms.size > 0);
      assert.ok(transform.product.atoms.size > 0);
    });
  }
});

describe('reactionTemplates — example applications', () => {
  it('dehalogenation removes a halogen substituent', () => {
    const product = applySMIRKS(parseSMILES('CCl'), reactionTemplates.dehalogenation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C');
  });

  it('halideHydrolysis converts an alkyl halide to an alcohol', () => {
    const product = applySMIRKS(parseSMILES('CCl'), reactionTemplates.halideHydrolysis.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CO');
  });

  it('alkeneHydrogenation saturates a carbon-carbon double bond', () => {
    const product = applySMIRKS(parseSMILES('C=C'), reactionTemplates.alkeneHydrogenation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC');
  });

  it('aldehydeOxidation converts an aldehyde to a carboxylic acid', () => {
    const product = applySMIRKS(parseSMILES('CC=O'), reactionTemplates.aldehydeOxidation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)O');
  });

  it('aldehydeOxidation does not match ketones', () => {
    const product = applySMIRKS(parseSMILES('CC(C)=O'), reactionTemplates.aldehydeOxidation.smirks);
    assert.equal(product, null);
  });

  it('aldehydeOxidation does not match carboxylic acids', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)O'), reactionTemplates.aldehydeOxidation.smirks);
    assert.equal(product, null);
  });

  it('alkeneHydrogenation skips alkene sites adjacent to charged atoms', () => {
    const product = applySMIRKS(parseSMILES('C1=CC=[C-]C=C1.[Li+]'), reactionTemplates.alkeneHydrogenation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C1C=C[C-]=CC1.[Li+]');
  });

  it('alkyneFullReduction fully saturates a carbon-carbon triple bond', () => {
    const product = applySMIRKS(parseSMILES('C#C'), reactionTemplates.alkyneFullReduction.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC');
  });

  it('benzylicOxidation converts toluene into benzaldehyde', () => {
    const product = applySMIRKS(parseSMILES('Cc1ccccc1'), reactionTemplates.benzylicOxidation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'O=Cc1ccccc1');
  });

  it('benzylicOxidation does not match non-methyl benzylic sites', () => {
    const product = applySMIRKS(parseSMILES('CCc1ccccc1'), reactionTemplates.benzylicOxidation.smirks);
    assert.equal(product, null);
  });

  it('esterHydrolysis converts a simple ester into acid and alcohol', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)OC'), reactionTemplates.esterHydrolysis.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)O.CO');
  });

  it('esterification converts a carboxylic acid and alcohol into an ester plus water', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)O.CO'), reactionTemplates.esterification.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)OC.O');
  });

  it('esterification does not match phenols as the alcohol partner', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)O.Oc1ccccc1'), reactionTemplates.esterification.smirks);
    assert.equal(product, null);
  });

  it('saponification converts a simple ester into carboxylate and alcohol', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)OC'), reactionTemplates.saponification.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)[O-].CO');
  });

  it('anhydrideHydrolysis converts an anhydride into two acids', () => {
    const product = applySMIRKS(parseSMILES('O=C(CC)OC(C)=O'), reactionTemplates.anhydrideHydrolysis.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'O=C(CC)O.CC(=O)O');
  });

  it('imineHydrolysis converts a simple imine into carbonyl plus amine fragment', () => {
    const product = applySMIRKS(parseSMILES('CC=NC'), reactionTemplates.imineHydrolysis.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC=O.NC');
  });

  it('amineAcylation converts an acid chloride and primary amine into an amide', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)Cl.CN'), reactionTemplates.amineAcylation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)NC.[Cl-]');
  });

  it('amineAcylation does not match tertiary amines', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)Cl.CN(C)C'), reactionTemplates.amineAcylation.smirks);
    assert.equal(product, null);
  });

  it('amineAlkylation converts an alkyl halide and primary amine into a secondary amine', () => {
    const product = applySMIRKS(parseSMILES('CCl.CN'), reactionTemplates.amineAlkylation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CNC.[Cl-]');
  });

  it('amineAlkylation does not match tertiary amines', () => {
    const product = applySMIRKS(parseSMILES('CCl.CN(C)C'), reactionTemplates.amineAlkylation.smirks);
    assert.equal(product, null);
  });

  it('amineAlkylation does not match congested or non-chloride haloamines', () => {
    const product = applySMIRKS(parseSMILES('C1(C(C(C(C(C1F)Cl)Br)I)N)P'), reactionTemplates.amineAlkylation.smirks);
    assert.equal(product, null);
  });

  it('nitrileHydrolysisToAmide converts a nitrile into an amide', () => {
    const product = applySMIRKS(parseSMILES('CC#N'), reactionTemplates.nitrileHydrolysisToAmide.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(N)=O');
  });

  it('nitrileHydrolysisToAcid converts a nitrile into an acid plus ammonia fragment', () => {
    const product = applySMIRKS(parseSMILES('CC#N'), reactionTemplates.nitrileHydrolysisToAcid.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)O.N');
  });

  it('carbonylReduction converts formaldehyde to methanol', () => {
    const product = applySMIRKS(parseSMILES('C=O'), reactionTemplates.carbonylReduction.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CO');
  });

  it('imineReduction converts a simple imine into an amine', () => {
    const product = applySMIRKS(parseSMILES('CC=NC'), reactionTemplates.imineReduction.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CCNC');
  });

  it('imineReduction does not match amidines or related heteroatom-substituted imines', () => {
    const product = applySMIRKS(parseSMILES('CC(=NC)N'), reactionTemplates.imineReduction.smirks);
    assert.equal(product, null);
  });

  it('carbonylReduction does not match carboxylates or acyl derivatives', () => {
    const product = applySMIRKS(parseSMILES('O=C([O-])C([N+](C)(C)C)C'), reactionTemplates.carbonylReduction.smirks);
    assert.equal(product, null);
  });

  it('alcoholOxidation does not match a carboxylic acid hydroxyl', () => {
    const product = applySMIRKS(parseSMILES('N[C@H](C(=O)O)C1=CC=CC=C1'), reactionTemplates.alcoholOxidation.smirks);
    assert.equal(product, null);
  });

  it('alcoholOxidation does not match tertiary alcohol centers', () => {
    const product = applySMIRKS(parseSMILES('CC(O)(C)C'), reactionTemplates.alcoholOxidation.smirks);
    assert.equal(product, null);
  });

  it('alcoholHalogenation does not match carboxylic acids', () => {
    const product = applySMIRKS(parseSMILES('NC(CC(O)=O)C(O)=O'), reactionTemplates.alcoholHalogenation.smirks);
    assert.equal(product, null);
  });

  it('arylHalideHydrolysis converts an aryl halide into a phenol', () => {
    const product = applySMIRKS(parseSMILES('c1ccccc1Cl'), reactionTemplates.arylHalideHydrolysis.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'Oc1ccccc1');
  });

  it('arylHalideHydrolysis does not match alkyl halides', () => {
    const product = applySMIRKS(parseSMILES('CCl'), reactionTemplates.arylHalideHydrolysis.smirks);
    assert.equal(product, null);
  });

  it('etherCleavage converts a simple dialkyl ether into two alcohol fragments', () => {
    const product = applySMIRKS(parseSMILES('COC'), reactionTemplates.etherCleavage.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CO.CO');
  });

  it('etherCleavage does not match esters', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)OC'), reactionTemplates.etherCleavage.smirks);
    assert.equal(product, null);
  });

  it('alcoholDehydration converts ethanol into ethene plus water without valence errors', async () => {
    const { validateValence } = await import('../../src/validation/index.js');
    const product = applySMIRKS(parseSMILES('CCO'), reactionTemplates.alcoholDehydration.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C=C.O');
    assert.deepEqual(validateValence(product), []);
  });

  it('alcoholDehydration converts secondary and tertiary alcohols', () => {
    assert.equal(toSMILES(applySMIRKS(parseSMILES('CC(O)C'), reactionTemplates.alcoholDehydration.smirks)), 'C=CC.O');
    assert.equal(toSMILES(applySMIRKS(parseSMILES('CC(C)(O)C'), reactionTemplates.alcoholDehydration.smirks)), 'C=C(C)C.O');
  });

  it('alcoholDehydration does not match alcohols without a beta hydrogen', () => {
    const product = applySMIRKS(parseSMILES('CC(C)(C)CO'), reactionTemplates.alcoholDehydration.smirks);
    assert.equal(product, null);
  });

  it('alkylChlorideElimination converts an alkyl chloride to an alkene and HCl without valence errors', async () => {
    const { validateValence } = await import('../../src/validation/index.js');
    const product = applySMIRKS(parseSMILES('CCCl'), reactionTemplates.alkylChlorideElimination.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C=C.Cl');
    assert.deepEqual(validateValence(product), []);
  });

  it('alkylChlorideElimination converts secondary and tertiary alkyl chlorides', () => {
    assert.equal(toSMILES(applySMIRKS(parseSMILES('CC(Cl)C'), reactionTemplates.alkylChlorideElimination.smirks)), 'C=CC.Cl');
    assert.equal(toSMILES(applySMIRKS(parseSMILES('CC(C)(Cl)C'), reactionTemplates.alkylChlorideElimination.smirks)), 'C=C(C)C.Cl');
  });

  it('alkylChlorideElimination does not match alkyl chlorides without a beta hydrogen', () => {
    const product = applySMIRKS(parseSMILES('CC(C)(C)CCl'), reactionTemplates.alkylChlorideElimination.smirks);
    assert.equal(product, null);
  });

  it('carboxylicAcidDeprotonation removes the acidic hydrogen cleanly', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)Oc1ccccc1C(=O)O'), reactionTemplates.carboxylicAcidDeprotonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)Oc1c(cccc1)C(=O)[O-]');
  });

  it('carboxylateProtonation protonates a carboxylate cleanly', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)[O-]'), reactionTemplates.carboxylateProtonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)O');
  });

  it('amineProtonation protonates a neutral amine', () => {
    const product = applySMIRKS(parseSMILES('CN'), reactionTemplates.amineProtonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C[NH3+]');
  });

  it('amineProtonation adds a proton to a primary amine site', () => {
    const product = applySMIRKS(parseSMILES('NC(CC1=CNC=N1)C(O)=O'), reactionTemplates.amineProtonation.smirks);
    assert.ok(product);
    assert.match(toSMILES(product), /\[NH3\+\]/);
  });

  it('ammoniumDeprotonation deprotonates an ammonium center', () => {
    const product = applySMIRKS(parseSMILES('C[NH3+]'), reactionTemplates.ammoniumDeprotonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CN');
  });

  it('ammoniumDeprotonation does not match quaternary ammonium centers without N-H', () => {
    const product = applySMIRKS(parseSMILES('C[N+](C)(C)CCO'), reactionTemplates.ammoniumDeprotonation.smirks);
    assert.equal(product, null);
  });

  it('phenolDeprotonation deprotonates phenol', () => {
    const product = applySMIRKS(parseSMILES('c1ccccc1O'), reactionTemplates.phenolDeprotonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), '[O-]c1ccccc1');
  });

  it('dielsAlder converts butadiene and ethylene into cyclohexene (intermolecular)', () => {
    const product = applySMIRKS(parseSMILES('C=CC=C.C=C'), reactionTemplates.dielsAlder.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C1C=CCCC1');
  });

  it('dielsAlder closes nona-1,3,8-triene into a bicyclo[4.3.0]non-2-ene (intramolecular)', () => {
    const product = applySMIRKS(parseSMILES('C=CC=CCCCC=C'), reactionTemplates.dielsAlder.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C1C=CC2CCCC2C1');
  });

  it('dielsAlder returns null when no isolated dienophile is present', () => {
    const product = applySMIRKS(parseSMILES('C=CC=C'), reactionTemplates.dielsAlder.smirks);
    assert.equal(product, null);
  });

  it('phenolateProtonation protonates phenolate cleanly', () => {
    const product = applySMIRKS(parseSMILES('[O-]c1ccccc1'), reactionTemplates.phenolateProtonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'Oc1ccccc1');
  });

  it('amideHydrolysis preserves tertiary amine valence in the amine fragment', () => {
    const product = applySMIRKS(parseSMILES('CN(C)C=O'), reactionTemplates.amideHydrolysis.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CNC.O=CO');
  });

  it('nitroReduction converts a nitro group into an amine', () => {
    const product = applySMIRKS(parseSMILES('c1ccccc1[N+](=O)[O-]'), reactionTemplates.nitroReduction.smirks);
    assert.ok(product);
    assert.equal(sortDotSmiles(toSMILES(product)), 'Nc1ccccc1.O.O');
  });

  it('sulfideOxidationToSulfoxide oxidizes a sulfide once', () => {
    const product = applySMIRKS(parseSMILES('CSC'), reactionTemplates.sulfideOxidationToSulfoxide.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CS(C)=O');
  });

  it('sulfoxideOxidationToSulfone oxidizes a sulfoxide to a sulfone', () => {
    const product = applySMIRKS(parseSMILES('CS(C)=O'), reactionTemplates.sulfoxideOxidationToSulfone.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CS(C)(=O)=O');
  });
});
