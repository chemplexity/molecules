import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySMIRKS, parseSMILES, parseSMIRKS, reactionTemplates, toSMILES, generateCoords } from '../../src/index.js';

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

  it('alkeneHydrogenation skips alkene sites adjacent to charged atoms', () => {
    const product = applySMIRKS(
      parseSMILES('C1=CC=[C-]C=C1.[Li+]'),
      reactionTemplates.alkeneHydrogenation.smirks
    );
    assert.ok(product);
    assert.equal(toSMILES(product), 'C1C=C[C-]=CC1.[Li+]');
  });

  it('esterHydrolysis converts a simple ester into acid and alcohol', () => {
    const product = applySMIRKS(parseSMILES('CC(=O)OC'), reactionTemplates.esterHydrolysis.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)O.CO');
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

  it('carbonylReduction does not match carboxylates or acyl derivatives', () => {
    const product = applySMIRKS(
      parseSMILES('O=C([O-])C([N+](C)(C)C)C'),
      reactionTemplates.carbonylReduction.smirks
    );
    assert.equal(product, null);
  });

  it('alcoholOxidation does not match a carboxylic acid hydroxyl', () => {
    const product = applySMIRKS(
      parseSMILES('N[C@H](C(=O)O)C1=CC=CC=C1'),
      reactionTemplates.alcoholOxidation.smirks
    );
    assert.equal(product, null);
  });

  it('alcoholOxidation does not match tertiary alcohol centers', () => {
    const product = applySMIRKS(
      parseSMILES('CC(O)(C)C'),
      reactionTemplates.alcoholOxidation.smirks
    );
    assert.equal(product, null);
  });

  it('alcoholHalogenation does not match carboxylic acids', () => {
    const product = applySMIRKS(
      parseSMILES('NC(CC(O)=O)C(O)=O'),
      reactionTemplates.alcoholHalogenation.smirks
    );
    assert.equal(product, null);
  });

  it('alcoholCleavage matches a simple alcohol', () => {
    const product = applySMIRKS(parseSMILES('CCO'), reactionTemplates.alcoholCleavage.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC.[OH]');
  });

  it('alcoholCleavage does not match esters or carboxylic acids', () => {
    const product = applySMIRKS(
      parseSMILES('CC(=O)Oc1ccccc1C(=O)O'),
      reactionTemplates.alcoholCleavage.smirks
    );
    assert.equal(product, null);
  });

  it('alcoholCleavage does not match tertiary alcohol centers', () => {
    const product = applySMIRKS(
      parseSMILES('CC(O)(C)C'),
      reactionTemplates.alcoholCleavage.smirks
    );
    assert.equal(product, null);
  });

  it('alcoholCleavage keeps heavy atoms non-overlapping after 2D transform', () => {
    const source = parseSMILES('CC(O)(C)');
    generateCoords(source);
    const product = applySMIRKS(source, reactionTemplates.alcoholCleavage.smirks);
    assert.ok(product);

    const heavy = [...product.atoms.values()].filter(atom => atom.name !== 'H');
    for (let i = 0; i < heavy.length; i++) {
      for (let j = i + 1; j < heavy.length; j++) {
        const dx = (heavy[i].x ?? 0) - (heavy[j].x ?? 0);
        const dy = (heavy[i].y ?? 0) - (heavy[j].y ?? 0);
        const distance = Math.hypot(dx, dy);
        assert.ok(distance > 0.01, `overlap between ${heavy[i].id} and ${heavy[j].id}`);
      }
    }
  });

  it('carboxylicAcidDeprotonation removes the acidic hydrogen cleanly', () => {
    const product = applySMIRKS(
      parseSMILES('CC(=O)Oc1ccccc1C(=O)O'),
      reactionTemplates.carboxylicAcidDeprotonation.smirks
    );
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)Oc1c(cccc1)C(=O)[O-]');
  });

  it('carboxylateProtonation protonates a carboxylate cleanly', () => {
    const product = applySMIRKS(
      parseSMILES('CC(=O)[O-]'),
      reactionTemplates.carboxylateProtonation.smirks
    );
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)O');
  });

  it('amineProtonation protonates a neutral amine', () => {
    const product = applySMIRKS(parseSMILES('CN'), reactionTemplates.amineProtonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C[NH3+]');
  });

  it('amineProtonation adds a proton to a primary amine site', () => {
    const product = applySMIRKS(
      parseSMILES('NC(CC1=CNC=N1)C(O)=O'),
      reactionTemplates.amineProtonation.smirks
    );
    assert.ok(product);
    assert.match(toSMILES(product), /\[NH3\+\]/);
  });

  it('ammoniumDeprotonation deprotonates an ammonium center', () => {
    const product = applySMIRKS(parseSMILES('C[NH3+]'), reactionTemplates.ammoniumDeprotonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CN');
  });

  it('ammoniumDeprotonation does not match quaternary ammonium centers without N-H', () => {
    const product = applySMIRKS(
      parseSMILES('C[N+](C)(C)CCO'),
      reactionTemplates.ammoniumDeprotonation.smirks
    );
    assert.equal(product, null);
  });

  it('phenolDeprotonation deprotonates phenol', () => {
    const product = applySMIRKS(parseSMILES('c1ccccc1O'), reactionTemplates.phenolDeprotonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), '[O-]c1ccccc1');
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
    assert.equal(toSMILES(product), 'Nc1ccccc1');
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
