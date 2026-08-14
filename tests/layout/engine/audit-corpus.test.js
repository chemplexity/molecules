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

const RUN_LAYOUT_STRESS_TESTS = process.env.RUN_LAYOUT_STRESS === '1';
const stressIt = RUN_LAYOUT_STRESS_TESTS ? it : it.skip;

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
  it('loads audit corpus representatives for opt-in stress coverage', () => {
    assert.ok(AUDIT_CORPUS.length > 0);
  });

  it('lays out corpus row 5370 with complete finite coordinates', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 5370);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);

    for (const [atomId, atom] of result.layoutGraph.atoms) {
      assert.ok(atom.element === 'H' || result.coords.has(atomId), `expected coordinates for non-hydrogen atom ${atomId}`);
    }
    for (const [atomId, position] of result.coords) {
      assert.ok(Number.isFinite(position.x), `expected finite x coordinate for ${atomId}`);
      assert.ok(Number.isFinite(position.y), `expected finite y coordinate for ${atomId}`);
    }
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  });

  it('clears row 4860 folded peptide contacts and crossings', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 4860);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('clears residual peptide contacts and crossings in corpus rows 1409 and 4175', { timeout: 20_000 }, () => {
    for (const sourceIndex of [1409, 4175]) {
      const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === sourceIndex);
      assert.ok(entry);

      const result = runPipeline(parseSMILES(entry.smiles), entry.options);
      const audit = result.metadata.audit;

      assert.equal(result.metadata.primaryFamily, 'large-molecule');
      assert.equal(audit.severeOverlapCount, 0, `expected row ${sourceIndex} to have no severe overlaps`);
      assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0, `expected row ${sourceIndex} to have no planar crossings`);
      assert.equal(audit.bondLengthFailureCount, 0, `expected row ${sourceIndex} to have no bond-length failures`);
      assert.equal(audit.ok, true, `expected row ${sourceIndex} to pass its final audit`);
      assert.equal(audit.fallback.mode, null);
    }
  });

  it('reduces residual contacts and crossings in ultra-large corpus row 21714', { timeout: 40_000 }, () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 21714);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.ok(audit.severeOverlapCount <= 6, `expected at most 6 severe overlaps, got ${audit.severeOverlapCount}`);
    assert.ok(
      audit.visibleHeavyBondCrossingFailureCount <= 6,
      `expected at most 6 planar crossings, got ${audit.visibleHeavyBondCrossingFailureCount}`
    );
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.fallback.mode, entry.expected.fallbackMode);
  });

  it('clears crowded polynuclear coordinate-ligand contacts and labels', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 11000);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('clears trapped terminal-branch contacts around a bridged cage', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 3299);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('shortens a residual bridged-ring closure without introducing new defects', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 8795);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('rescues a compact bridged cage with a trapped internal contact', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 28033);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('rescues multi-contact heterocyclic cages and clears their labels', () => {
    for (const sourceIndex of [24460, 14262]) {
      const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === sourceIndex);
      assert.ok(entry);

      const result = runPipeline(parseSMILES(entry.smiles), entry.options);
      const audit = result.metadata.audit;

      assert.equal(result.metadata.primaryFamily, 'bridged');
      assert.equal(audit.severeOverlapCount, 0);
      assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
      assert.equal(audit.labelOverlapCount, 0);
      assert.equal(audit.bondLengthFailureCount, 0);
      assert.equal(audit.stereoContradiction, false);
      assert.equal(audit.ok, true);
      assert.equal(audit.fallback.mode, null);
    }
  });

  it('keeps previously repaired compact polycycles audit-clean', () => {
    for (const sourceIndex of [3086, 7418, 6991, 25846, 23712]) {
      const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === sourceIndex);
      assert.ok(entry);

      const result = runPipeline(parseSMILES(entry.smiles), entry.options);
      const audit = result.metadata.audit;

      assert.equal(audit.severeOverlapCount, 0, `expected ${entry.name} to have no severe overlaps`);
      assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0, `expected ${entry.name} to have no planar crossings`);
      assert.equal(audit.labelOverlapCount, 0, `expected ${entry.name} to have no label overlaps`);
      assert.equal(audit.bondLengthFailureCount, 0, `expected ${entry.name} to have no bond-length failures`);
      assert.equal(audit.ok, true, `expected ${entry.name} to pass its final audit`);
      assert.equal(audit.fallback.mode, null);
    }
  });

  it('re-solves a dense carbon cage without trapped vertex contacts', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 21740);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('repairs paired cage closures after clearing stacked heterocycle vertices', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 27074);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('moves a halogen-bearing cage vertex to clear the final post-seed contact', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 34750);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('redistributes an isolated organometallic chelate closure stretch', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 10515);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.ok, true);
    assert.equal(audit.fallback.mode, null);
  });

  it('clears a single bridged path atom from a stationary cage bridgehead', () => {
    const entry = AUDIT_CORPUS.find(candidate => candidate.sourceIndex === 1341);
    assert.ok(entry);

    const result = runPipeline(parseSMILES(entry.smiles), entry.options);
    const audit = result.metadata.audit;

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.stereoContradiction, false);
  });

  for (const entry of RUN_LAYOUT_STRESS_TESTS ? AUDIT_CORPUS : []) {
    stressIt(`keeps ${entry.bucket} representative ${entry.name} within its current audit ceiling`, () => {
      const { placementAudit, result } = inspectPlacementAndFinalAudit(entry.smiles, entry.options);
      const audit = result.metadata.audit;

      assert.equal(result.metadata.primaryFamily, entry.expected.primaryFamily);
      assert.ok(audit.severeOverlapCount <= entry.expected.maxSevereOverlapCount, `expected ${entry.name} severe overlaps <= ${entry.expected.maxSevereOverlapCount}, got ${audit.severeOverlapCount}`);
      assert.ok(
        audit.bondLengthFailureCount <= entry.expected.maxBondLengthFailureCount,
        `expected ${entry.name} bond failures <= ${entry.expected.maxBondLengthFailureCount}, got ${audit.bondLengthFailureCount}`
      );
      assert.ok(
        audit.maxBondLengthDeviation <= entry.expected.maxBondLengthDeviation + 1e-9,
        `expected ${entry.name} max bond deviation <= ${entry.expected.maxBondLengthDeviation}, got ${audit.maxBondLengthDeviation}`
      );
      if (Object.hasOwn(entry.expected, 'maxLabelOverlapCount')) {
        assert.ok(audit.labelOverlapCount <= entry.expected.maxLabelOverlapCount, `expected ${entry.name} label overlaps <= ${entry.expected.maxLabelOverlapCount}, got ${audit.labelOverlapCount}`);
      }
      if (Object.hasOwn(entry.expected, 'maxRingSubstituentReadabilityFailureCount')) {
        assert.ok(
          audit.ringSubstituentReadabilityFailureCount <= entry.expected.maxRingSubstituentReadabilityFailureCount,
          `expected ${entry.name} ring-substituent readability failures <= ${entry.expected.maxRingSubstituentReadabilityFailureCount}, got ${audit.ringSubstituentReadabilityFailureCount}`
        );
      }
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
