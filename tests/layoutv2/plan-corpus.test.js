import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/smiles.js';
import { runPipeline } from '../../src/layoutv2/pipeline.js';
import { PLAN_CORPUS } from './support/plan-corpus.js';

describe('layoutv2/plan-corpus', () => {
  it('keeps the implementation-plan corpus audit-clean', () => {
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
