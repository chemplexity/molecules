import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSMILES } from '../../src/io/index.js';
import { chemicalSpaceDescriptorProfile } from '../../src/descriptors/index.js';

describe('chemicalSpaceDescriptorProfile', () => {
  it('builds a serializable shared-matrix profile for ethanol', () => {
    const profile = chemicalSpaceDescriptorProfile(parseSMILES('CCO'));

    assert.equal(profile.schemaVersion, 2);
    assert.equal(profile.connected, true);
    assert.equal(profile.heavyAtomCount, 3);
    assert.ok(profile.molecularWeight > 46 && profile.molecularWeight < 47);
    assert.equal(profile.wienerIndex, 4);
    assert.equal(profile.zagreb1, 6);
    assert.equal(profile.plattIndex, 2);
    assert.equal(profile.hosoyaIndex, 3);
    assert.ok(Number.isFinite(profile.randicIndex));
    assert.doesNotThrow(() => JSON.stringify(profile));
  });

  it('marks disconnected heavy-atom graphs instead of throwing for distance descriptors', () => {
    const profile = chemicalSpaceDescriptorProfile(parseSMILES('C.O'));

    assert.equal(profile.connected, false);
    assert.equal(profile.wienerIndex, null);
    assert.equal(profile.balabanIndex, null);
  });
});
