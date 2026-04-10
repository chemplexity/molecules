import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createQualityReport } from '../../../src/layoutv2/model/quality-report.js';

describe('layoutv2/model/quality-report', () => {
  it('packages cleanup, stereo, audit, and policy into one summary object', () => {
    const report = createQualityReport({
      audit: { ok: true },
      cleanup: { passes: 2, improvement: 3.5, overlapMoves: 1, labelNudges: 0, symmetrySnaps: 2, junctionSnaps: 1 },
      stereo: { assignedCenterCount: 1 },
      ringDependency: { ok: true },
      policy: { bridgedMode: 'template-first' }
    });

    assert.equal(report.ok, true);
    assert.equal(report.cleanup.overlapMoves, 1);
    assert.equal(report.cleanup.junctionSnaps, 1);
    assert.equal(report.stereo.assignedCenterCount, 1);
    assert.equal(report.policy.bridgedMode, 'template-first');
  });
});
