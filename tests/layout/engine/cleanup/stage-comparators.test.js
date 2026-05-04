import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPreferredCleanupGeometryStage,
  isPreferredFinalStereoStage
} from '../../../../src/layout/engine/cleanup/stage-comparators.js';

function stageAudit(overrides = {}) {
  return {
    ok: false,
    collapsedMacrocycleCount: 0,
    bondLengthFailureCount: 0,
    maxBondLengthDeviation: 0,
    ringSubstituentReadabilityFailureCount: 0,
    inwardRingSubstituentCount: 0,
    outwardAxisRingSubstituentFailureCount: 0,
    severeOverlapCount: 0,
    labelOverlapCount: 0,
    ...overrides
  };
}

describe('layout/engine/cleanup/stage-comparators', () => {
  it('prefers clearing severe overlaps over one minor ring-substituent readability miss', () => {
    const incumbent = {
      audit: stageAudit({
        severeOverlapCount: 2
      })
    };
    const candidate = {
      audit: stageAudit({
        ringSubstituentReadabilityFailureCount: 1,
        outwardAxisRingSubstituentFailureCount: 1,
        severeOverlapCount: 0
      })
    };

    assert.equal(isPreferredCleanupGeometryStage(candidate, incumbent), true);
  });

  it('keeps hypervalent deviation ahead of late presentation tie-breaks', () => {
    const incumbent = {
      audit: stageAudit({ ok: true }),
      hypervalentDeviation: 0,
      terminalHeteroOutwardPenalty: 10
    };
    const candidate = {
      audit: stageAudit({ ok: true }),
      hypervalentDeviation: 1,
      terminalHeteroOutwardPenalty: 0
    };

    assert.equal(isPreferredFinalStereoStage(candidate, incumbent, { allowPresentationTieBreak: true }), false);
  });

});
