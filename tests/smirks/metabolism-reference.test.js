import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySMIRKS, parseSMILES, toCanonicalSMILES, metabolismTemplates, reactionTemplates, METABOLISM_PHASE } from '../../src/index.js';

function canon(smiles) {
  return toCanonicalSMILES(parseSMILES(smiles));
}

function applyAndSortParts(smiles, smirks) {
  const product = applySMIRKS(parseSMILES(smiles), smirks);
  return toCanonicalSMILES(product).split('.').sort();
}

describe('metabolismTemplates — schema', () => {
  const allowedPhases = new Set(Object.values(METABOLISM_PHASE));

  for (const [key, entry] of Object.entries(metabolismTemplates)) {
    it(`${key} has core fields and metadata`, () => {
      assert.equal(typeof entry.name, 'string');
      assert.ok(entry.name.length > 0, 'name is non-empty');
      assert.equal(typeof entry.smirks, 'string');
      assert.ok(entry.smirks.length > 0, 'smirks is non-empty');
      assert.ok(allowedPhases.has(entry.phase), `phase '${entry.phase}' is recognized`);
      assert.equal(typeof entry.enzymeFamily, 'string');
      assert.ok(entry.enzymeFamily.length > 0, 'enzymeFamily is non-empty');
      assert.equal(typeof entry.summary, 'string');
      assert.ok(entry.summary.length > 0, 'summary is non-empty');
      assert.ok(Array.isArray(entry.notes), 'notes is an array');
      assert.ok(Array.isArray(entry.limitations), 'limitations is an array');
    });
  }
});

describe('metabolismTemplates — Phase I behavior', () => {
  it('benzylicHydroxylation converts toluene to benzyl alcohol', () => {
    const product = applySMIRKS(parseSMILES('Cc1ccccc1'), metabolismTemplates.benzylicHydroxylation.smirks);
    assert.equal(toCanonicalSMILES(product), canon('OCc1ccccc1'));
  });

  it('nDemethylation converts N-methylaniline to aniline and formaldehyde', () => {
    const parts = applyAndSortParts('CNc1ccccc1', metabolismTemplates.nDemethylation.smirks);
    assert.deepEqual(parts, [canon('Nc1ccccc1'), canon('C=O')].sort());
  });

  it('oDemethylation converts anisole to phenol and formaldehyde', () => {
    const parts = applyAndSortParts('COc1ccccc1', metabolismTemplates.oDemethylation.smirks);
    assert.deepEqual(parts, [canon('Oc1ccccc1'), canon('C=O')].sort());
  });

  it('aromaticHydroxylation converts benzene to phenol without corrupting ring aromaticity', () => {
    const product = applySMIRKS(parseSMILES('c1ccccc1'), metabolismTemplates.aromaticHydroxylation.smirks);
    assert.equal(toCanonicalSMILES(product), canon('Oc1ccccc1'));
    for (const atom of product.atoms.values()) {
      if (atom.name === 'C') {
        assert.equal(atom.isAromatic(), true, `ring carbon ${atom.id} should remain aromatic`);
      }
    }
  });

  it('tertiaryAmineNOxidation converts a tertiary amine to its N-oxide zwitterion', () => {
    const product = applySMIRKS(parseSMILES('CN(C)C'), metabolismTemplates.tertiaryAmineNOxidation.smirks);
    assert.equal(toCanonicalSMILES(product), canon('C[N+](C)(C)[O-]'));
  });

  it('oxidativeDeamination converts phenethylamine to phenylacetaldehyde and ammonia', () => {
    const parts = applyAndSortParts('NCCc1ccccc1', metabolismTemplates.oxidativeDeamination.smirks);
    assert.deepEqual(parts, [canon('O=CCc1ccccc1'), canon('N')].sort());
  });

  it('epoxidation converts styrene to styrene oxide', () => {
    const product = applySMIRKS(parseSMILES('C=Cc1ccccc1'), metabolismTemplates.epoxidation.smirks);
    assert.equal(toCanonicalSMILES(product), canon('C1OC1c1ccccc1'));
  });

  it('sulfoxidation reuses the generic sulfide oxidation template', () => {
    const product = applySMIRKS(parseSMILES('CSC'), metabolismTemplates.sulfoxidation.smirks);
    assert.equal(toCanonicalSMILES(product), canon('CS(=O)C'));
  });

  it('esterHydrolysis, amideHydrolysis, reductiveDehalogenation, and nitroReduction reuse the generic organic-chemistry SMIRKS verbatim', () => {
    assert.equal(metabolismTemplates.esterHydrolysis.smirks, reactionTemplates.esterHydrolysis.smirks);
    assert.equal(metabolismTemplates.amideHydrolysis.smirks, reactionTemplates.amideHydrolysis.smirks);
    assert.equal(metabolismTemplates.reductiveDehalogenation.smirks, reactionTemplates.dehalogenation.smirks);
    assert.equal(metabolismTemplates.nitroReduction.smirks, reactionTemplates.nitroReduction.smirks);
  });
});

describe('metabolismTemplates — Phase II behavior', () => {
  it('glucuronidation appends a glucuronic acid unit to a phenol', () => {
    const before = parseSMILES('Oc1ccccc1');
    const product = applySMIRKS(before, metabolismTemplates.glucuronidation.smirks);
    assert.notEqual(product, null);
    assert.ok(product.atoms.size > before.atoms.size, 'glucuronide adds heavy atoms');
  });

  it('sulfation converts phenol to phenyl sulfate', () => {
    const product = applySMIRKS(parseSMILES('Oc1ccccc1'), metabolismTemplates.sulfation.smirks);
    assert.equal(toCanonicalSMILES(product), canon('OS(=O)(=O)Oc1ccccc1'));
  });

  it('acetylation converts aniline to acetanilide', () => {
    const product = applySMIRKS(parseSMILES('Nc1ccccc1'), metabolismTemplates.acetylation.smirks);
    assert.equal(toCanonicalSMILES(product), canon('CC(=O)Nc1ccccc1'));
  });

  it('methylation converts phenol to anisole', () => {
    const product = applySMIRKS(parseSMILES('Oc1ccccc1'), metabolismTemplates.methylation.smirks);
    assert.equal(toCanonicalSMILES(product), canon('COc1ccccc1'));
  });

  it('glycineConjugation converts benzoic acid to hippuric acid and water', () => {
    const parts = applyAndSortParts('OC(=O)c1ccccc1', metabolismTemplates.glycineConjugation.smirks);
    assert.deepEqual(parts, [canon('O=C(NCC(=O)O)c1ccccc1'), canon('O')].sort());
  });
});
