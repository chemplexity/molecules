import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';
import { generateCoords } from '../../../src/layout/public-api.js';

const SMILES = '[O-][V](=O)[O+]([V](=O)O[V](=O)(=O)O[V](=O)(=O)[O+]([V]([O-])=O)[V](=O)(=O)=O)[V](=O)(=O)=O';

/**
 * Simulates elapsed time without sleeping, restoring the clock after each run.
 * @param {number} step - Milliseconds per clock read.
 * @param {Function} run - Synchronous layout operation.
 * @returns {*} Operation result.
 */
function withClock(step, run) {
  const original = Object.getOwnPropertyDescriptor(performance, 'now');
  let ticks = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => (ticks += step) });
  try {
    return run();
  } finally {
    if (original) {
      Object.defineProperty(performance, 'now', original);
    } else {
      delete performance.now;
    }
  }
}

describe('cleanup scheduling modes', () => {
  for (const cleanupMode of [undefined, 'deterministic']) {
    for (const timing of [false, true]) {
      it(`is clock-independent with mode=${cleanupMode} and timing=${timing}`, () => {
        const run = () => runPipeline(parseSMILES(SMILES), { suppressH: true, cleanupMode, timing });
        const baseline = withClock(0, run);
        const expired = withClock(100000, run);
        assert.deepEqual(expired.coords, baseline.coords);
        assert.deepEqual(expired.metadata.audit, baseline.metadata.audit);
        assert.equal(expired.metadata.audit.ok, true);
        assert.equal(expired.metadata.cleanupMode, 'deterministic');
        assert.equal(expired.metadata.cleanupStageBudget.enabled, false);
        assert.equal(expired.metadata.cleanupStageBudget.skippedStageCount, 0);
        assert.deepEqual(expired.metadata.cleanupStageBudget.skippedStages, []);
      });
    }
  }

  it('retains explicit time-limited skipping and reports it without timing enabled', () => {
    const run = () => runPipeline(parseSMILES(SMILES), { suppressH: true, cleanupMode: 'time-limited' });
    const baseline = withClock(0, run);
    const expired = withClock(100000, run);
    assert.notDeepEqual(expired.coords, baseline.coords);
    assert.equal(baseline.metadata.audit.ok, true);
    assert.equal(expired.metadata.audit.ok, true);
    assert.equal(expired.metadata.timing, undefined);
    assert.equal(expired.metadata.cleanupStageBudget.mode, 'time-limited');
    assert.equal(baseline.metadata.cleanupStageBudget.skippedStageCount, 0);
    assert.ok(expired.metadata.cleanupStageBudget.skippedStageCount > 0);
    assert.equal(expired.metadata.cleanupStageBudget.skippedStages.length, expired.metadata.cleanupStageBudget.skippedStageCount);
  });

  it('forwards the cleanup mode through the public API', () => {
    const run = cleanupMode => generateCoords(parseSMILES(SMILES), { cleanupMode });
    const baseline = withClock(0, () => run('deterministic'));
    assert.deepEqual(withClock(100000, () => run('deterministic')), baseline);
    assert.notDeepEqual(withClock(100000, () => run('time-limited')), baseline);
    assert.throws(() => run('unknown'), TypeError);
  });
});
