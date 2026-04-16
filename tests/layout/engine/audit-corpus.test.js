import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { auditLayout } from '../../../src/layout/engine/audit/audit.js';
import { createLayoutGraphFromNormalized } from '../../../src/layout/engine/model/layout-graph.js';
import { normalizeOptions } from '../../../src/layout/engine/options.js';
import { layoutSupportedComponents } from '../../../src/layout/engine/placement/component-layout.js';
import { classifyFamily, runPipeline } from '../../../src/layout/engine/pipeline.js';
import { resolveProfile } from '../../../src/layout/engine/profile.js';
import { resolvePolicy } from '../../../src/layout/engine/standards/profile-policy.js';

import { AUDIT_CORPUS } from './support/audit-corpus.js';

/**
 * Returns the placement-stage audit and final pipeline result for one SMILES input.
 * @param {string} smiles - SMILES string.
 * @param {object} [options] - Pipeline options.
 * @returns {{placementAudit: object, result: object}} Placement audit and final result.
 */
function inspectPlacementAndFinalAudit(smiles, options = { suppressH: true }) {
  const molecule = parseSMILES(smiles);
  const normalizedOptions = normalizeOptions(options);
  const layoutGraph = createLayoutGraphFromNormalized(molecule, normalizedOptions);
  const familySummary = classifyFamily(layoutGraph);
  const policy = resolvePolicy(resolveProfile(normalizedOptions.profile), {
    ...layoutGraph.traits,
    ...familySummary
  });
  const placement = layoutSupportedComponents(layoutGraph, policy);
  const placementAudit = auditLayout(layoutGraph, placement.coords, {
    bondLength: normalizedOptions.bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });

  return {
    placementAudit,
    result: runPipeline(molecule, options)
  };
}

describe('layout/engine/audit-corpus', () => {
  for (const entry of AUDIT_CORPUS) {
    it(`keeps ${entry.bucket} representative ${entry.name} within its current audit ceiling`, () => {
      const { placementAudit, result } = inspectPlacementAndFinalAudit(entry.smiles);
      const audit = result.metadata.audit;

      assert.equal(result.metadata.primaryFamily, entry.expected.primaryFamily);
      assert.ok(
        audit.severeOverlapCount <= entry.expected.maxSevereOverlapCount,
        `expected ${entry.name} severe overlaps <= ${entry.expected.maxSevereOverlapCount}, got ${audit.severeOverlapCount}`
      );
      assert.ok(
        audit.bondLengthFailureCount <= entry.expected.maxBondLengthFailureCount,
        `expected ${entry.name} bond failures <= ${entry.expected.maxBondLengthFailureCount}, got ${audit.bondLengthFailureCount}`
      );
      assert.ok(
        audit.maxBondLengthDeviation <= entry.expected.maxBondLengthDeviation + 1e-9,
        `expected ${entry.name} max bond deviation <= ${entry.expected.maxBondLengthDeviation}, got ${audit.maxBondLengthDeviation}`
      );
      assert.ok(
        audit.collapsedMacrocycleCount <= entry.expected.maxCollapsedMacrocycleCount,
        `expected ${entry.name} collapsed macrocycles <= ${entry.expected.maxCollapsedMacrocycleCount}, got ${audit.collapsedMacrocycleCount}`
      );
      assert.equal(audit.stereoContradiction, entry.expected.stereoContradiction);
      assert.equal(audit.fallback.mode, entry.expected.fallbackMode);

      if (entry.relations?.finalBondFailuresAtMostPlacement) {
        assert.ok(
          audit.bondLengthFailureCount <= placementAudit.bondLengthFailureCount,
          `expected ${entry.name} final bond failures <= placement bond failures, got ${audit.bondLengthFailureCount} vs ${placementAudit.bondLengthFailureCount}`
        );
      }
      if (entry.relations?.finalOverlapsAtMostPlacement) {
        assert.ok(
          audit.severeOverlapCount <= placementAudit.severeOverlapCount,
          `expected ${entry.name} final overlaps <= placement overlaps, got ${audit.severeOverlapCount} vs ${placementAudit.severeOverlapCount}`
        );
      }
      if (entry.relations?.finalCollapsedAtMostPlacement) {
        assert.ok(
          audit.collapsedMacrocycleCount <= placementAudit.collapsedMacrocycleCount,
          `expected ${entry.name} final collapsed macrocycles <= placement collapsed macrocycles, got ${audit.collapsedMacrocycleCount} vs ${placementAudit.collapsedMacrocycleCount}`
        );
      }
      if (entry.relations?.finalMaxDeviationAtMostPlacement) {
        assert.ok(
          audit.maxBondLengthDeviation <= placementAudit.maxBondLengthDeviation + 1e-9,
          `expected ${entry.name} final max bond deviation <= placement max bond deviation, got ${audit.maxBondLengthDeviation} vs ${placementAudit.maxBondLengthDeviation}`
        );
      }
      if (Object.hasOwn(entry.relations ?? {}, 'placementStereoContradiction')) {
        assert.equal(placementAudit.stereoContradiction, entry.relations.placementStereoContradiction);
      }
    });
  }
});
