import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySMIRKS, findSMARTS, parseSMILES, parseSMIRKS, reactionTemplates, toSMILES, validateValence } from '../../src/index.js';

function sortDotSmiles(smiles) {
  return smiles.split('.').sort().join('.');
}

describe('reactionTemplates — schema', () => {
  const allowedCategories = new Set(['oxidationReduction', 'substitution', 'acylChemistry', 'acidBase', 'bondConstruction', 'cycloaddition']);

  for (const [key, entry] of Object.entries(reactionTemplates)) {
    it(`${key} has core fields and metadata`, () => {
      assert.equal(typeof entry.name, 'string');
      assert.equal(typeof entry.smirks, 'string');
      assert.ok(entry.name.length > 0, 'name is non-empty');
      assert.ok(entry.smirks.length > 0, 'smirks is non-empty');
      assert.equal(typeof entry.category, 'string');
      assert.ok(allowedCategories.has(entry.category), `category '${entry.category}' is recognized`);
      assert.equal(typeof entry.summary, 'string');
      assert.ok(entry.summary.length > 0, 'summary is non-empty');
      assert.ok(Array.isArray(entry.variants), 'variants is an array');
      assert.ok(entry.variants.length > 0, 'variants is non-empty');
      assert.ok(Array.isArray(entry.byproducts), 'byproducts is an array');
      assert.equal(typeof entry.selectivity, 'object', 'selectivity is an object');
      assert.notEqual(entry.selectivity, null, 'selectivity is not null');
      assert.equal(Array.isArray(entry.selectivity), false, 'selectivity is not an array');
      assert.equal(typeof entry.selectivity.regioselectivity, 'string', 'selectivity regioselectivity is a string');
      assert.equal(typeof entry.selectivity.stereochemistry, 'string', 'selectivity stereochemistry is a string');
      assert.equal(typeof entry.selectivity.chemoselectivity, 'string', 'selectivity chemoselectivity is a string');
      assert.ok(Array.isArray(entry.notes), 'notes is an array');
      assert.ok(Array.isArray(entry.limitations), 'limitations is an array');
      assert.ok(Array.isArray(entry.references), 'references is an array');

      const variantIds = new Set();
      for (const variant of entry.variants) {
        assert.equal(typeof variant.id, 'string', 'variant id is a string');
        assert.match(variant.id, /^[a-z0-9][a-z0-9-]*$/, 'variant id is stable kebab-case');
        assert.equal(variantIds.has(variant.id), false, `variant id '${variant.id}' is unique within ${key}`);
        variantIds.add(variant.id);
        assert.equal(typeof variant.label, 'string', 'variant label is a string');
        assert.ok(variant.label.length > 0, 'variant label is non-empty');
        assert.equal(typeof variant.role, 'string', 'variant role is a string');
        assert.ok(Array.isArray(variant.reagents), 'variant reagents is an array');
        assert.ok(Array.isArray(variant.catalysts), 'variant catalysts is an array');
        assert.ok(Array.isArray(variant.solvents), 'variant solvents is an array');
        assert.equal(typeof variant.conditions, 'object', 'variant conditions is an object');
        assert.notEqual(variant.conditions, null, 'variant conditions is not null');
        assert.equal(Array.isArray(variant.conditions), false, 'variant conditions is not an array');
        assert.ok(Array.isArray(variant.byproducts), 'variant byproducts is an array');
        assert.ok(Array.isArray(variant.notes), 'variant notes is an array');
        assert.ok(Array.isArray(variant.limitations), 'variant limitations is an array');
      }
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
    assert.equal(reactionTemplates.dehalogenation.category, 'substitution');
    assert.ok(reactionTemplates.dehalogenation.byproducts.includes('halide-containing reagent products'));
    assert.equal(reactionTemplates.dehalogenation.selectivity.chemoselectivity, 'strongly substrate- and halide-dependent');
    assert.ok(reactionTemplates.dehalogenation.variants.some(variant => variant.id === 'h2-pd-c' && variant.reagents.includes('H2')));
  });

  it('dehalogenation skips charged carbon-halogen centers', () => {
    const product = applySMIRKS(parseSMILES('[CH2+]Cl'), reactionTemplates.dehalogenation.smirks);
    assert.equal(product, null);
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

  it('alkynePartialReduction reduces a neutral alkyne to an alkene', () => {
    const product = applySMIRKS(parseSMILES('C#C'), reactionTemplates.alkynePartialReduction.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'C=C');
  });

  it('alkyne reductions skip charged alkyne centers and directly charge-adjacent alkynes', () => {
    assert.equal(applySMIRKS(parseSMILES('[C-]#C'), reactionTemplates.alkynePartialReduction.smirks), null);
    assert.equal(applySMIRKS(parseSMILES('C#C[NH3+]'), reactionTemplates.alkynePartialReduction.smirks), null);
    assert.equal(applySMIRKS(parseSMILES('[C-]#C'), reactionTemplates.alkyneFullReduction.smirks), null);
    assert.equal(applySMIRKS(parseSMILES('C#C[NH3+]'), reactionTemplates.alkyneFullReduction.smirks), null);
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

  it('nitrileHydrogenationToImine converts a neutral nitrile into an imine', () => {
    const product = applySMIRKS(parseSMILES('CC#N'), reactionTemplates.nitrileHydrogenationToImine.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC=N');
  });

  it('nitrileHydrolysisToAcid converts a nitrile into an acid plus ammonia fragment', () => {
    const product = applySMIRKS(parseSMILES('CC#N'), reactionTemplates.nitrileHydrolysisToAcid.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CC(=O)O.N');
  });

  it('nitrile templates skip charged cyanide-like and protonated nitrile states', () => {
    assert.equal(applySMIRKS(parseSMILES('[C-]#N'), reactionTemplates.nitrileHydrogenationToImine.smirks), null);
    assert.equal(applySMIRKS(parseSMILES('[C-]#N'), reactionTemplates.nitrileHydrolysisToAmide.smirks), null);
    assert.equal(applySMIRKS(parseSMILES('C#[NH+]'), reactionTemplates.nitrileHydrolysisToAcid.smirks), null);
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

  it('imine reduction and hydrolysis skip protonated imines', () => {
    assert.equal(applySMIRKS(parseSMILES('CC=[NH2+]'), reactionTemplates.imineReduction.smirks), null);
    assert.equal(applySMIRKS(parseSMILES('CC=[NH2+]'), reactionTemplates.imineHydrolysis.smirks), null);
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

  it('alcoholDehydration clears stale wedge/dash display from the alkene bond', () => {
    const reactant = parseSMILES('CCO');
    const alcoholCarbon = [...reactant.atoms.values()].find(atom => atom.name === 'C' && atom.getNeighbors(reactant).some(neighbor => neighbor.name === 'O'));
    const betaCarbon = alcoholCarbon?.getNeighbors(reactant).find(neighbor => neighbor.name === 'C');
    assert.ok(alcoholCarbon && betaCarbon, 'expected alcohol carbon and beta carbon');
    const dehydratingBond = reactant.getBond(alcoholCarbon.id, betaCarbon.id);
    assert.ok(dehydratingBond, 'expected C-C dehydration bond');
    dehydratingBond.properties.display = { as: 'wedge', centerId: alcoholCarbon.id, manual: true };

    const product = applySMIRKS(reactant, reactionTemplates.alcoholDehydration.smirks);
    assert.ok(product);
    const productBond = product.getBond(alcoholCarbon.id, betaCarbon.id);
    assert.ok(productBond, 'expected retained product alkene bond');
    assert.equal(productBond.properties.order, 2);
    assert.equal(productBond.properties.display?.as, undefined);
  });

  it('alcoholDehydration clears stereo display when the alcohol center is no longer chiral', () => {
    const reactant = parseSMILES('C[C@H](CC)O');
    const alcoholCarbon = [...reactant.atoms.values()].find(atom => atom.getChirality());
    assert.ok(alcoholCarbon, 'expected chiral alcohol center');
    const displayedBonds = alcoholCarbon
      .getNeighbors(reactant)
      .filter(neighbor => neighbor.name === 'C')
      .map(neighbor => reactant.getBond(alcoholCarbon.id, neighbor.id))
      .filter(Boolean);
    assert.ok(displayedBonds.length >= 2, 'expected carbon substituent bonds on the alcohol center');
    for (const bond of displayedBonds) {
      bond.properties.display = { as: 'wedge', centerId: alcoholCarbon.id, manual: true };
    }

    const product = applySMIRKS(reactant, reactionTemplates.alcoholDehydration.smirks);
    assert.ok(product);
    const productCenter = product.atoms.get(alcoholCarbon.id);
    assert.ok(productCenter, 'expected retained alcohol carbon in product');
    assert.equal(productCenter.getChirality(), null);
    for (const bondId of productCenter.bonds) {
      assert.equal(product.bonds.get(bondId)?.properties.display?.as, undefined);
    }
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

  it('amineProtonation preserves unrelated fused aza aromaticity', () => {
    const product = applySMIRKS(parseSMILES('C[C@@H]1CCCC[C@H]1OC1=CC=CC(c2nc3cc(F)c(cc3n2)C(N)=[NH2+])=C1[O-]'), reactionTemplates.amineProtonation.smirks);

    assert.ok(product);
    assert.deepEqual(validateValence(product), []);
    assert.equal(product.atoms.get('N17')?.properties.aromatic, true);
    assert.equal(product.atoms.get('N25')?.properties.aromatic, true);
  });

  it('imineHydrolysis skips protonated amidines while phenolateProtonation preserves the adjacent fused aza ring', () => {
    const source = parseSMILES('C[C@@H]1CCCC[C@H]1OC1=CC=CC(c2nc3cc(F)c(cc3n2)C(N)=[NH2+])=C1[O-]');
    const afterImineHydrolysis = applySMIRKS(source, reactionTemplates.imineHydrolysis.smirks);
    assert.equal(afterImineHydrolysis, null);

    const afterPhenolateProtonation = applySMIRKS(source, reactionTemplates.phenolateProtonation.smirks);
    assert.ok(afterPhenolateProtonation);
    assert.deepEqual(validateValence(afterPhenolateProtonation), []);
    assert.equal(afterPhenolateProtonation.atoms.get('N17')?.properties.aromatic, true);
    assert.equal(afterPhenolateProtonation.atoms.get('N25')?.properties.aromatic, true);
  });

  it('aromaticAzaProtonation protonates pyridine-like aromatic nitrogens', () => {
    const product = applySMIRKS(parseSMILES('c1ccncc1'), reactionTemplates.aromaticAzaProtonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'c1cc[nH+]cc1');
  });

  it('aromaticAzaProtonation skips substituted pyrrolic nitrogens but still finds the imine-like site', () => {
    const product = applySMIRKS(parseSMILES('Cn1cncc1'), reactionTemplates.aromaticAzaProtonation.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'Cn1cc[nH+]c1');
  });

  it('aromaticAzaProtonation preserves fused aza aromaticity after protonating the aza site', () => {
    const product = applySMIRKS(parseSMILES('C[C@@H]1CCCC[C@H]1OC1=CC=CC(c2nc3cc(F)c(cc3n2)C(N)=[NH2+])=C1[O-]'), reactionTemplates.aromaticAzaProtonation.smirks);

    assert.ok(product);
    assert.deepEqual(validateValence(product), []);
    assert.equal(product.atoms.get('N17')?.getCharge(), 1);
    assert.equal(product.atoms.get('N17')?.properties.aromatic, true);
    assert.equal(product.atoms.get('N25')?.properties.aromatic, true);
  });

  it('fused aza nucleosides expose aromatic aza protonation sites after aromaticity perception', () => {
    const matches = [...findSMARTS(parseSMILES('N1C=NC2=C1N=CN2[C@H]3C[C@H](O)[C@@H](CO)O3'), '[n+0X2:1]')];
    assert.equal(matches.length, 2);
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

  it('dielsAlder skips charged diene and dienophile centers', () => {
    assert.equal(applySMIRKS(parseSMILES('[CH2+]=CC=C.C=C'), reactionTemplates.dielsAlder.smirks), null);
    assert.equal(applySMIRKS(parseSMILES('C=CC=C.[CH2+]=C'), reactionTemplates.dielsAlder.smirks), null);
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

  it('sulfideOxidationToSulfoxide does not oxidize already-oxidized sulfones', () => {
    const dimethylSulfoneProduct = applySMIRKS(parseSMILES('CS(C)(=O)=O'), reactionTemplates.sulfideOxidationToSulfoxide.smirks);
    const reportedRingSulfoneProduct = applySMIRKS(parseSMILES('CC1C2NC3(COC12C=O)C(C)NCS3(=O)=O'), reactionTemplates.sulfideOxidationToSulfoxide.smirks);

    assert.equal(dimethylSulfoneProduct, null);
    assert.equal(reportedRingSulfoneProduct, null);
  });

  it('sulfoxideOxidationToSulfone oxidizes a sulfoxide to a sulfone', () => {
    const product = applySMIRKS(parseSMILES('CS(C)=O'), reactionTemplates.sulfoxideOxidationToSulfone.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CS(C)(=O)=O');
  });

  it('sulfoxideOxidationToSulfone does not oxidize sulfones again', () => {
    const dimethylSulfoneProduct = applySMIRKS(parseSMILES('CS(C)(=O)=O'), reactionTemplates.sulfoxideOxidationToSulfone.smirks);
    const reportedRingSulfoneProduct = applySMIRKS(parseSMILES('CC1C2NC3(COC12C=O)C(C)NCS3(=O)=O'), reactionTemplates.sulfoxideOxidationToSulfone.smirks);

    assert.equal(dimethylSulfoneProduct, null);
    assert.equal(reportedRingSulfoneProduct, null);
  });
});
