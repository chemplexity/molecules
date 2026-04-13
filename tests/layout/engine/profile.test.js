import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile } from '../../../src/layout/engine/profile.js';

describe('layout/engine/profile', () => {
  it('returns the default profile when omitted or null', () => {
    assert.equal(resolveProfile(), 'organic-publication');
    assert.equal(resolveProfile(null), 'organic-publication');
  });

  it('accepts supported profile names', () => {
    assert.equal(resolveProfile('macrocycle'), 'macrocycle');
    assert.equal(resolveProfile('organometallic'), 'organometallic');
  });

  it('rejects unsupported profiles', () => {
    assert.throws(() => resolveProfile('legacy'), RangeError);
    assert.throws(() => resolveProfile(7), RangeError);
  });
});
