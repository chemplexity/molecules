/** @module cleanup/stage-pipeline */

import { auditCleanupStage, auditFinalStereoStage } from '../audit/stage-metrics.js';
import { collectProtectedEZAtomIds } from '../stereo/ez.js';
import { enforceAcyclicEZStereo } from '../stereo/enforcement.js';
import { runHypervalentAngleTidy } from './hypervalent-angle-tidy.js';
import { runAttachedRingRotationTouchup } from './attached-ring-rotation-tidy.js';
import { mergeFrozenAtomIds } from './frozen-atoms.js';
import { measureRingSubstituentPresentationPenalty, runRingSubstituentTidy } from './ring-substituent-tidy.js';
import {
  isPreferredCleanupGeometryStage,
  isPreferredFinalStereoStage,
  isPreferredProtectedCleanupStage
} from './stage-comparators.js';
import { runPostCleanupHooks } from './post-cleanup-hooks.js';
import { runRingTerminalHeteroTidy } from './ring-terminal-hetero-tidy.js';
import { tidySymmetry } from './symmetry-tidy.js';
import { runUnifiedCleanup } from './unified-cleanup.js';
import { applyLabelClearance } from './label-clearance.js';

function hasPostCleanupHook(policy, hookName) {
  return policy.postCleanupHooks?.includes(hookName) === true;
}

const HOOK_STEP_META = {
  'ring-perimeter-correction': ['Ring Perimeter Correction', 'Macrocycle ring perimeter drift corrected.'],
  'bridged-bond-tidy': ['Bridged Bond Tidy', 'Bridged system bond angles optimized.'],
  'hypervalent-angle-tidy': ['Hypervalent Angle Tidy', 'S/P/Se/As center angles orthogonalized.'],
  'ligand-angle-tidy': ['Ligand Angle Tidy', 'Metal-ligand bond angles optimized.'],
  'ring-substituent-tidy': ['Ring Substituent Tidy', 'Ring substituents repositioned for better presentation.'],
  'ring-terminal-hetero-tidy': ['Ring Terminal Hetero Tidy', 'Terminal heteroatom bonds on rings reoriented.']
};

function hasStereoRescueOverlaps(stageResults, incumbent) {
  const postCleanupStage = stageResults.get('postCleanup');
  const stereoCleanupStage = stageResults.get('stereoCleanup');
  const totalStereoRescueCount = (postCleanupStage?.reflections ?? 0) + (stereoCleanupStage?.reflections ?? 0);
  return totalStereoRescueCount > 0
    && incumbent.audit?.stereoContradiction === false
    && incumbent.audit?.bondLengthFailureCount === 0
    && incumbent.audit?.severeOverlapCount > 0;
}

function acceptedNudgeAccumulator(stageName, additionalStageNames = []) {
  return (sidecars, stageResult, stageResults) => {
    const nextSidecars = {
      ...sidecars,
      [stageName]: stageResult.nudges ?? 0
    };
    for (const additionalStageName of additionalStageNames) {
      nextSidecars[additionalStageName] = stageResults.get(additionalStageName)?.nudges ?? 0;
    }
    return nextSidecars;
  };
}

function hasOutstandingRingSubstituentCleanupNeed(stageResult) {
  if (!stageResult) {
    return false;
  }
  const audit = stageResult.audit ?? null;
  return (
    (audit.ringSubstituentReadabilityFailureCount ?? 0) > 0
    || (audit.inwardRingSubstituentCount ?? 0) > 0
    || (audit.outwardAxisRingSubstituentFailureCount ?? 0) > 0
    || (audit.severeOverlapCount ?? 0) > 0
    || (stageResult.presentationPenalty ?? 0) > 1e-6
  );
}

/**
 * Builds the declarative cleanup-stage DAG used by the stage runner.
 * @param {object} context - Cleanup execution context from `pipeline.js`.
 * @returns {object[]} Ordered stage descriptors with parent relationships and comparators.
 */
export function buildCleanupStageGraph(context) {
  const {
    layoutGraph,
    placement,
    familySummary,
    policy,
    normalizedOptions,
    cleanupMaxPasses,
    protectBondIntegrity,
    runStereoPhase
  } = context;
  const bondLength = normalizedOptions.bondLength;
  const protectLargeMoleculeBackbone = placement.placedFamilies.includes('large-molecule');
  const baseCleanupOptions = {
    epsilon: bondLength * 0.001,
    bondLength,
    protectLargeMoleculeBackbone,
    cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId
  };
  const auditFinalStereo = coords => auditFinalStereoStage(layoutGraph.sourceMolecule, layoutGraph, coords, placement, bondLength, runStereoPhase);
  const auditFinalStereoWithTieBreak = (candidate, incumbent) => isPreferredFinalStereoStage(candidate, incumbent, { allowPresentationTieBreak: true });
  const cleanupGeometryComparator = protectBondIntegrity
    ? (candidate, incumbent) => isPreferredProtectedCleanupStage(familySummary, placement, candidate, incumbent)
    : isPreferredCleanupGeometryStage;
  const scoreGeometryStage = coords => ({
    audit: auditCleanupStage(layoutGraph, coords, placement, bondLength),
    presentationPenalty: measureRingSubstituentPresentationPenalty(layoutGraph, coords)
  });

  return [
    {
      name: 'cleanup',
      parentStage: null,
      isGeometryPhase: true,
      transformFn(parentCoords) {
        const cleanupResult = runUnifiedCleanup(layoutGraph, parentCoords, {
          ...baseCleanupOptions,
          maxPasses: cleanupMaxPasses,
          protectBondIntegrity,
          frozenAtomIds: placement.frozenAtomIds
        });
        context.onStep?.(
          'Unified Cleanup',
          'Multi-pass overlap resolution and bond length normalization.',
          context.copyCoords(cleanupResult.coords),
          {
            passes: cleanupResult.passes,
            improvement: cleanupResult.improvement,
            overlapMoves: cleanupResult.overlapMoves
          }
        );
        return cleanupResult;
      },
      scoreFn: scoreGeometryStage,
      comparatorFn: cleanupGeometryComparator
    },
    {
      name: 'postCleanup',
      parentStage: 'cleanup',
      isGeometryPhase: true,
      transformFn(parentCoords, inputContext) {
        const labelClearanceStart = inputContext.timingState ? inputContext.nowMs() : 0;
        const labelClearance = applyLabelClearance(layoutGraph, parentCoords, {
          bondLength,
          labelMetrics: normalizedOptions.labelMetrics
        });
        if (inputContext.timingState) {
          inputContext.timingState.labelClearanceMs = inputContext.nowMs() - labelClearanceStart;
        }
        inputContext.onStep?.(
          'Label Clearance',
          'Atom positions nudged to prevent overlap with element labels.',
          inputContext.copyCoords(labelClearance.coords),
          { nudges: labelClearance.nudges }
        );
        const symmetryTidy = tidySymmetry(labelClearance.coords, {
          epsilon: bondLength * 0.01,
          layoutGraph
        });
        inputContext.onStep?.(
          'Symmetry Tidy',
          'Atoms snapped onto axes of symmetry for aesthetic alignment.',
          inputContext.copyCoords(symmetryTidy.coords),
          {
            snaps: symmetryTidy.snappedCount,
            junctionSnaps: symmetryTidy.junctionSnapCount
          }
        );
        const stereoCleanup = enforceAcyclicEZStereo(layoutGraph, symmetryTidy.coords, {
          bondLength
        });
        inputContext.onStep?.(
          'EZ Stereo Enforcement',
          'Acyclic double bond geometry adjusted to maintain E/Z stereochemistry.',
          inputContext.copyCoords(stereoCleanup.coords),
          {
            reflections: stereoCleanup.reflections
          }
        );
        const postCleanup = runPostCleanupHooks(layoutGraph, stereoCleanup.coords, policy, {
          bondLength,
          frozenAtomIds: placement.frozenAtomIds,
          onHook: inputContext.onStep
            ? (hookName, coords, nudges) => {
                const [label, description] = HOOK_STEP_META[hookName] ?? [hookName, 'Post-cleanup hook.'];
                inputContext.onStep(label, description, inputContext.copyCoords(coords), { nudges });
              }
            : null
        });
        return {
          coords: postCleanup.coords,
          labelNudges: labelClearance.nudges,
          symmetrySnaps: symmetryTidy.snappedCount,
          junctionSnaps: symmetryTidy.junctionSnapCount,
          reflections: stereoCleanup.reflections,
          hookNudges: postCleanup.hookNudges
        };
      },
      scoreFn: scoreGeometryStage,
      comparatorFn: cleanupGeometryComparator
    },
    {
      name: 'postHookCleanup',
      parentStage: 'postCleanup',
      isGeometryPhase: true,
      transformFn(parentCoords, _inputContext, stageResults) {
        if ((stageResults.get('postCleanup')?.hookNudges ?? 0) <= 0) {
          // No hooks made changes — coords are identical to postCleanup, skip the
          // auditCleanupStage scoreFn since it would produce the same result.
          return null;
        }
        const postHookCleanup = runUnifiedCleanup(layoutGraph, parentCoords, {
          ...baseCleanupOptions,
          maxPasses: 1,
          protectBondIntegrity,
          frozenAtomIds: placement.frozenAtomIds
        });
        context.onStep?.(
          'Post-Hook Cleanup',
          'Final overlap pass after tidy hook adjustments.',
          context.copyCoords(postHookCleanup.coords),
          { passes: postHookCleanup.passes }
        );
        return postHookCleanup;
      },
      scoreFn: scoreGeometryStage,
      comparatorFn: cleanupGeometryComparator
    },
    {
      name: 'selectedGeometryStereo',
      parentStage: 'best',
      transformFn(parentCoords) {
        return { coords: parentCoords };
      },
      scoreFn: auditFinalStereo,
      comparatorFn() {
        return true;
      }
    },
    {
      name: 'stereoCleanup',
      parentStage: 'selectedGeometryStereo',
      transformFn(parentCoords) {
        const result = enforceAcyclicEZStereo(layoutGraph, parentCoords, { bondLength });
        // Skip audit entirely when EZ enforcement made no changes — coords are identical
        // to selectedGeometryStereo so re-running auditFinalStereoStage would be redundant.
        return result.reflections > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: isPreferredFinalStereoStage
    },
    {
      name: 'stereoProtectedTouchup',
      parentStage: ['stereoCleanup', 'selectedGeometryStereo'],
      guard(stageResults, incumbent) {
        return mergeFrozenAtomIds(placement.frozenAtomIds, collectProtectedEZAtomIds(layoutGraph)) != null
          && hasStereoRescueOverlaps(stageResults, incumbent);
      },
      transformFn(parentCoords) {
        return runUnifiedCleanup(layoutGraph, parentCoords, {
          ...baseCleanupOptions,
          maxPasses: 1,
          protectBondIntegrity: true,
          frozenAtomIds: mergeFrozenAtomIds(placement.frozenAtomIds, collectProtectedEZAtomIds(layoutGraph))
        });
      },
      scoreFn: auditFinalStereo,
      comparatorFn: isPreferredFinalStereoStage
    },
    {
      name: 'stereoTouchup',
      parentStage: ['stereoCleanup', 'selectedGeometryStereo'],
      guard: hasStereoRescueOverlaps,
      transformFn(parentCoords) {
        return runUnifiedCleanup(layoutGraph, parentCoords, {
          ...baseCleanupOptions,
          maxPasses: 1,
          protectBondIntegrity: true,
          frozenAtomIds: placement.frozenAtomIds
        });
      },
      scoreFn: auditFinalStereo,
      comparatorFn: isPreferredFinalStereoStage
    },
    {
      name: 'postTouchupStereo',
      parentStage: 'stereoTouchup',
      guard(stageResults, incumbent) {
        return stageResults.has('stereoTouchup') && hasStereoRescueOverlaps(stageResults, incumbent);
      },
      transformFn(parentCoords) {
        return enforceAcyclicEZStereo(layoutGraph, parentCoords, {
          bondLength
        });
      },
      scoreFn: auditFinalStereo,
      comparatorFn: isPreferredFinalStereoStage
    },
    {
      name: 'finalHypervalentTouchup',
      parentStage: 'best',
      guard() {
        return hasPostCleanupHook(policy, 'hypervalent-angle-tidy');
      },
      transformFn(parentCoords) {
        const result = runHypervalentAngleTidy(layoutGraph, parentCoords);
        return result.nudges > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: auditFinalStereoWithTieBreak,
      accumulateSidecar: acceptedNudgeAccumulator('finalHypervalentTouchup')
    },
    {
      name: 'finalHypervalentRingSubstituentTouchup',
      parentStage: 'finalHypervalentTouchup',
      guard(stageResults) {
        return hasPostCleanupHook(policy, 'ring-substituent-tidy')
          && hasOutstandingRingSubstituentCleanupNeed(stageResults.get('finalHypervalentTouchup'));
      },
      transformFn(parentCoords) {
        const result = runRingSubstituentTidy(layoutGraph, parentCoords, {
          bondLength,
          frozenAtomIds: placement.frozenAtomIds
        });
        return result.nudges > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: auditFinalStereoWithTieBreak,
      accumulateSidecar: acceptedNudgeAccumulator('finalHypervalentRingSubstituentTouchup', ['finalHypervalentTouchup'])
    },
    {
      name: 'finalRingSubstituentTouchup',
      parentStage: 'best',
      guard(_stageResults, incumbent) {
        return hasPostCleanupHook(policy, 'ring-substituent-tidy')
          && hasOutstandingRingSubstituentCleanupNeed(incumbent);
      },
      transformFn(parentCoords) {
        const result = runRingSubstituentTidy(layoutGraph, parentCoords, {
          bondLength,
          frozenAtomIds: placement.frozenAtomIds
        });
        return result.nudges > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: auditFinalStereoWithTieBreak,
      accumulateSidecar: acceptedNudgeAccumulator('finalRingSubstituentTouchup')
    },
    {
      name: 'finalAttachedRingRotationTouchup',
      parentStage: 'best',
      guard(_stageResults, incumbent) {
        return hasPostCleanupHook(policy, 'ring-substituent-tidy')
          && hasOutstandingRingSubstituentCleanupNeed(incumbent);
      },
      transformFn(parentCoords) {
        const result = runAttachedRingRotationTouchup(layoutGraph, parentCoords, {
          bondLength,
          frozenAtomIds: placement.frozenAtomIds,
          cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
          protectLargeMoleculeBackbone
        });
        return result.nudges > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: auditFinalStereoWithTieBreak,
      accumulateSidecar: acceptedNudgeAccumulator('finalAttachedRingRotationTouchup')
    },
    {
      name: 'finalRingTerminalHeteroTouchup',
      parentStage: 'best',
      guard() {
        return hasPostCleanupHook(policy, 'ring-terminal-hetero-tidy');
      },
      transformFn(parentCoords) {
        const result = runRingTerminalHeteroTidy(layoutGraph, parentCoords, {
          bondLength
        });
        return result.nudges > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: isPreferredFinalStereoStage,
      accumulateSidecar: acceptedNudgeAccumulator('finalRingTerminalHeteroTouchup')
    },
    {
      name: 'finalPostRingHypervalentTouchup',
      parentStage: 'best',
      guard() {
        return hasPostCleanupHook(policy, 'hypervalent-angle-tidy');
      },
      transformFn(parentCoords) {
        const result = runHypervalentAngleTidy(layoutGraph, parentCoords);
        return result.nudges > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: auditFinalStereoWithTieBreak,
      accumulateSidecar: acceptedNudgeAccumulator('finalPostRingHypervalentTouchup')
    }
  ];
}
