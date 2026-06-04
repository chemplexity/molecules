import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';
import { PLAN_CORPUS } from './support/plan-corpus.js';

const RUN_LAYOUT_STRESS_TESTS = process.env.RUN_LAYOUT_STRESS === '1';
const stressIt = RUN_LAYOUT_STRESS_TESTS ? it : it.skip;

describe('layout/engine/plan-corpus', () => {
  it('loads implementation-plan corpus representatives for opt-in stress coverage', () => {
    assert.ok(PLAN_CORPUS.length > 0);
  });

  stressIt('keeps the implementation-plan corpus audit-clean', () => {
    const failures = [];

    for (const entry of PLAN_CORPUS) {
      const result = runPipeline(parseSMILES(entry.smiles), { suppressH: true });
      if (!result.metadata.audit.ok) {
        failures.push({
          name: entry.name,
          smiles: entry.smiles,
          audit: result.metadata.audit
        });
      }
    }

    assert.deepEqual(failures, []);
  });
});
