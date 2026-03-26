import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySMIRKS, parseSMILES, parseSMIRKS, reactionTemplates, toSMILES } from '../../src/index.js';

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

  it('carbonylReduction converts formaldehyde to methanol', () => {
    const product = applySMIRKS(parseSMILES('C=O'), reactionTemplates.carbonylReduction.smirks);
    assert.ok(product);
    assert.equal(toSMILES(product), 'CO');
  });
});
