/** @module cleanup/stage-pipeline */

import { auditCleanupStage, auditFinalStereoStage, measureCleanupStagePresentationPenalty } from '../audit/stage-metrics.js';
import { collectProtectedEZAtomIds } from '../stereo/ez.js';
import { enforceAcyclicEZStereo } from '../stereo/enforcement.js';
import { mergeFrozenAtomIds } from './frozen-atoms.js';
import { measureRingSubstituentPresentationPenalty } from './presentation/ring-substituent.js';
import { hasOutstandingRingPresentationNeed, runRingPresentationCleanup } from './presentation/ring-presentation.js';
import {
  hasSpecialistCleanupNeed,
  runSpecialistCleanup
} from './specialists/specialist-cleanup.js';
import {
  isPreferredCleanupGeometryStage,
  isPreferredFinalStereoStage,
  isPreferredProtectedCleanupStage
} from './stage-comparators.js';
import { hasSymmetryTidyNeed, tidySymmetry } from './symmetry-tidy.js';
import { runUnifiedCleanup } from './unified-cleanup.js';
import { applyLabelClearance } from './label-clearance.js';
import { createStageExecutionEntry } from './stage-runner.js';

function hasPostCleanupHook(policy, hookName) {
  return policy.postCleanupHooks?.includes(hookName) === true;
}

const HOOK_STEP_META = {
  'ring-perimeter-correction': ['Ring Perimeter Correction', 'Macrocycle ring perimeter drift corrected.'],
  'bridged-bond-tidy': ['Bridged Bond Tidy', 'Bridged system bond angles optimized.'],
  'hypervalent-angle-tidy': ['Hypervalent Angle Tidy', 'S/P/Se/As center angles orthogonalized.'],
  'hypervalent-angle-retouch': ['Hypervalent Angle Retouch', 'Hypervalent center angles re-orthogonalized after bounded presentation rescue.'],
  'ligand-angle-tidy': ['Ligand Angle Tidy', 'Metal-ligand bond angles optimized.'],
  'ring-presentation-tidy': ['Ring Presentation Tidy', 'Ring presentation cleanup merged substituent and terminal-hetero refinement.'],
  'specialist-presentation-rescue': ['Ring Presentation Rescue', 'Bounded ring-presentation revalidation inside specialist cleanup.'],
  'ring-substituent-tidy': ['Ring Substituent Tidy', 'Ring substituents repositioned for better presentation.'],
  'ring-terminal-hetero-tidy': ['Ring Terminal Hetero Tidy', 'Terminal heteroatom bonds on rings reoriented.']
};

function hasStereoRescueOverlaps(stageResults, incumbent) {
  const stereoRescueCleanupStage = stageResults.get('stereoRescueCleanup');
  const totalStereoRescueCount = stereoRescueCleanupStage?.reflections ?? 0;
  return totalStereoRescueCount > 0
    && incumbent.audit?.stereoContradiction === false
    && incumbent.audit?.bondLengthFailureCount === 0
    && incumbent.audit?.severeOverlapCount > 0;
}

function hasCoreGeometryCleanupNeed(stageResult) {
  const audit = stageResult?.audit ?? null;
  return (
    (audit?.severeOverlapCount ?? 0) > 0
    || (audit?.bondLengthFailureCount ?? 0) > 0
    || (audit?.collapsedMacrocycleCount ?? 0) > 0
  );
}

function hasPresentationCleanupNeed(layoutGraph, stageResult, options = {}) {
  const audit = stageResult?.audit ?? null;
  return (
    (audit?.labelOverlapCount ?? 0) > 0
    || (audit?.stereoContradiction ?? false) === true
    || hasOutstandingRingPresentationNeed(layoutGraph, stageResult)
    || hasSymmetryTidyNeed(stageResult?.coords, {
      epsilon: options.symmetryEpsilon,
      layoutGraph
    })
  );
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

function addSyntheticStageResult(runnerState, stageResult, stageExecution, context) {
  const normalizedStageResult = {
    name: stageResult.name,
    ...stageResult
  };
  runnerState.allStageResults.set(normalizedStageResult.name, normalizedStageResult);
  runnerState.stageExecutions.set(normalizedStageResult.name, stageExecution);
  if (normalizedStageResult.audit) {
    runnerState.stageEntries.push({
      name: normalizedStageResult.name,
      audit: normalizedStageResult.audit
    });
  }
  const previousBestStage = runnerState.bestStage;
  if (stageExecution.accepted) {
    runnerState.bestStage = normalizedStageResult;
  }
  context.onStageAcceptance?.(
    normalizedStageResult.name,
    stageExecution.accepted,
    normalizedStageResult.audit ?? null,
    previousBestStage?.audit ?? null
  );
  return normalizedStageResult;
}

function syncAggregateStageResult(runnerState, aggregateStageName, aggregateParentStage, stageResult, additionalElapsedMs = 0) {
  const existingAggregateStageResult = runnerState.allStageResults.get(aggregateStageName) ?? null;
  const aggregateStageResult = {
    ...existingAggregateStageResult,
    ...stageResult,
    name: aggregateStageName,
    reflections: existingAggregateStageResult?.reflections ?? stageResult.reflections
  };
  const aggregateStageExecution = runnerState.stageExecutions.get(aggregateStageName)
    ?? createStageExecutionEntry(aggregateStageName, aggregateParentStage);
  aggregateStageExecution.ran = true;
  aggregateStageExecution.returnedNull = false;
  aggregateStageExecution.materialized = true;
  aggregateStageExecution.accepted = true;
  aggregateStageExecution.elapsedMs += additionalElapsedMs;
  aggregateStageExecution.audit = aggregateStageResult.audit ?? null;
  runnerState.allStageResults.set(aggregateStageName, aggregateStageResult);
  runnerState.stageExecutions.set(aggregateStageName, aggregateStageExecution);
  runnerState.bestStage = aggregateStageResult;
  return aggregateStageResult;
}

/**
 * Builds the cleanup-stage plan used by the pipeline runner.
 * @param {object} context - Cleanup execution context from `pipeline.js`.
 * @returns {{geometryStages: object[], stereoStages: object[], finalStages: object[], stabilizationStages: object[], materializeSelectedGeometryCheckpoint: (runnerState: object) => object, runStereoRescueCleanup: (runnerState: object) => object}} Cleanup stage plan.
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
  const hasRingSubstituentHook = hasPostCleanupHook(policy, 'ring-substituent-tidy');
  const hasRingTerminalHeteroHook = hasPostCleanupHook(policy, 'ring-terminal-hetero-tidy');

  const geometryStages = [
    {
      name: 'coreGeometryCleanup',
      parentStage: null,
      isGeometryPhase: true,
      guard(stageResults, incumbent) {
        return hasCoreGeometryCleanupNeed(incumbent ?? stageResults.get('placement'));
      },
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
    }
  ];

  const stereoStages = [
    {
      name: 'stereoRescueCleanup',
      parentStage: 'selectedGeometryCheckpoint',
      guard(_stageResults, incumbent) {
        return incumbent?.audit?.stereoContradiction === true;
      },
      transformFn(parentCoords) {
        const result = enforceAcyclicEZStereo(layoutGraph, parentCoords, { bondLength });
        // Skip audit entirely when EZ enforcement made no changes — coords are identical
        // to selectedGeometryCheckpoint so re-running auditFinalStereoStage would be redundant.
        return result.reflections > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: isPreferredFinalStereoStage
    }
  ];

  const finalStages = [
    {
      name: 'presentationCleanup',
      parentStage: 'best',
      guard(_stageResults, incumbent) {
        return hasPresentationCleanupNeed(layoutGraph, incumbent, {
          symmetryEpsilon: bondLength * 0.01
        });
      },
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

        const presentationResult = runRingPresentationCleanup(layoutGraph, symmetryTidy.coords, {
          bondLength,
          frozenAtomIds: placement.frozenAtomIds,
          cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
          protectLargeMoleculeBackbone,
          includeRingSubstituent: hasRingSubstituentHook,
          includeTerminalHetero: hasRingTerminalHeteroHook,
          includeAttachedRingFallback: hasRingSubstituentHook,
          scoreCoordsFn: auditFinalStereo,
          comparatorFn: auditFinalStereoWithTieBreak
        });

        if (presentationResult.nudges > 0) {
          const [label, description] = HOOK_STEP_META['ring-presentation-tidy'];
          inputContext.onStep?.(label, description, inputContext.copyCoords(presentationResult.coords), {
            nudges: presentationResult.nudges,
            strategiesRun: presentationResult.strategiesRun ?? [],
            usedAttachedRingFallback: presentationResult.usedAttachedRingFallback === true
          });
        }

        const stereoCleanup = enforceAcyclicEZStereo(layoutGraph, presentationResult.coords, {
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

        const stabilizationReasons = new Set(presentationResult.stabilizationRequest?.reasons ?? []);
        if (stereoCleanup.reflections > 0) {
          stabilizationReasons.add('presentation:stereo');
        }

        return {
          coords: stereoCleanup.coords,
          labelNudges: labelClearance.nudges,
          symmetrySnaps: symmetryTidy.snappedCount,
          junctionSnaps: symmetryTidy.junctionSnapCount,
          reflections: stereoCleanup.reflections,
          hookNudges: presentationResult.nudges ?? 0,
          strategiesRun: presentationResult.strategiesRun ?? [],
          usedAttachedRingFallback: presentationResult.usedAttachedRingFallback === true,
          stabilizationRequest:
            stabilizationReasons.size > 0
              ? {
                  requested: true,
                  reasons: [...stabilizationReasons],
                  maxPasses: 1
                }
              : null
        };
      },
      scoreFn: auditFinalStereo,
      comparatorFn: auditFinalStereoWithTieBreak,
    },
    {
      name: 'specialistCleanup',
      parentStage: 'best',
      guard(_stageResults, incumbent) {
        return hasSpecialistCleanupNeed(layoutGraph, incumbent.coords, policy, {
          bondLength
        });
      },
      transformFn(parentCoords, inputContext) {
        const result = runSpecialistCleanup(layoutGraph, parentCoords, policy, {
          bondLength,
          frozenAtomIds: placement.frozenAtomIds,
          cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
          protectLargeMoleculeBackbone,
          scoreCoordsFn: auditFinalStereo,
          comparatorFn: auditFinalStereoWithTieBreak,
          onStep: inputContext.onStep
            ? (stepName, coords, nudges) => {
                const [label, description] = HOOK_STEP_META[stepName] ?? [stepName, 'Specialist cleanup step.'];
                inputContext.onStep(label, description, inputContext.copyCoords(coords), { nudges });
              }
            : null
        });
        return result.nudges > 0 ? result : null;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: auditFinalStereoWithTieBreak,
      accumulateSidecar: acceptedNudgeAccumulator('specialistCleanup')
    }
  ];

  const stabilizationStages = [
    {
      name: 'stabilizeAfterCleanup',
      parentStage: 'best',
      guard(_stageResults, _incumbent, inputContext) {
        return inputContext.stabilizationRequest?.requested === true;
      },
      transformFn(parentCoords, inputContext) {
        const stabilizationRequest = inputContext.stabilizationRequest ?? null;
        if (stabilizationRequest?.requested !== true) {
          return null;
        }
        const postHookCleanup = runUnifiedCleanup(layoutGraph, parentCoords, {
          ...baseCleanupOptions,
          maxPasses: stabilizationRequest.maxPasses ?? 1,
          protectBondIntegrity,
          frozenAtomIds: placement.frozenAtomIds
        });
        inputContext.onStep?.(
          'Post-Hook Cleanup',
          'Final overlap pass after presentation and specialist cleanup adjustments.',
          inputContext.copyCoords(postHookCleanup.coords),
          {
            passes: postHookCleanup.passes,
            reasons: stabilizationRequest.reasons ?? []
          }
        );
        return postHookCleanup;
      },
      scoreFn: auditFinalStereo,
      comparatorFn: auditFinalStereoWithTieBreak
    }
  ];

  function materializeSelectedGeometryCheckpoint(runnerState) {
    const checkpointStart = context.nowMs();
    const stageResult = context.hasStereoTargets === true
      ? {
          name: 'selectedGeometryCheckpoint',
          ...auditFinalStereo(runnerState.bestStage.coords)
        }
      : {
          name: 'selectedGeometryCheckpoint',
          coords: runnerState.bestStage.coords,
          stereo: context.emptyStereoSummary,
          audit: runnerState.bestStage.audit ?? null,
          presentationPenalty: measureCleanupStagePresentationPenalty(layoutGraph, runnerState.bestStage.coords)
        };
    const stageExecution = createStageExecutionEntry(stageResult.name, 'best', {
      ran: true,
      materialized: true,
      accepted: true,
      elapsedMs: context.nowMs() - checkpointStart,
      audit: stageResult.audit ?? null
    });
    addSyntheticStageResult(runnerState, stageResult, stageExecution, context);
    return stageResult;
  }

  function runStereoRescueCleanup(runnerState) {
    const parentStageResult = runnerState.allStageResults.get('stereoRescueCleanup') ?? runnerState.allStageResults.get('selectedGeometryCheckpoint');
    if (!parentStageResult) {
      throw new Error('Missing selectedGeometryCheckpoint/stereoRescueCleanup parent stage for stereo rescue cleanup.');
    }

    for (const [stageName, parentStage] of [
      ['stereoProtectedTouchup', ['stereoRescueCleanup', 'selectedGeometryCheckpoint']],
      ['stereoTouchup', ['stereoRescueCleanup', 'selectedGeometryCheckpoint']],
      ['postTouchupStereo', 'stereoTouchup']
    ]) {
      if (!runnerState.stageExecutions.has(stageName)) {
        runnerState.stageExecutions.set(stageName, createStageExecutionEntry(stageName, parentStage));
      }
    }

    const protectedFrozenAtomIds = mergeFrozenAtomIds(placement.frozenAtomIds, collectProtectedEZAtomIds(layoutGraph));
    let stereoTouchupStageResult = null;

    if (protectedFrozenAtomIds != null && hasStereoRescueOverlaps(runnerState.allStageResults, runnerState.bestStage)) {
      const stageName = 'stereoProtectedTouchup';
      const stageStart = context.nowMs();
      const transformResult = runUnifiedCleanup(layoutGraph, parentStageResult.coords, {
        ...baseCleanupOptions,
        maxPasses: 1,
        protectBondIntegrity: true,
        frozenAtomIds: protectedFrozenAtomIds
      });
      const stageResult = {
        name: stageName,
        ...transformResult,
        ...auditFinalStereo(transformResult.coords)
      };
      const accepted = isPreferredFinalStereoStage(stageResult, runnerState.bestStage);
      const stageExecution = createStageExecutionEntry(stageName, ['stereoRescueCleanup', 'selectedGeometryCheckpoint'], {
        ran: true,
        materialized: true,
        accepted,
        elapsedMs: context.nowMs() - stageStart,
        audit: stageResult.audit ?? null
      });
      addSyntheticStageResult(runnerState, stageResult, stageExecution, context);
      if (accepted) {
        syncAggregateStageResult(
          runnerState,
          'stereoRescueCleanup',
          'selectedGeometryCheckpoint',
          stageResult,
          stageExecution.elapsedMs
        );
      }
    }

    if (hasStereoRescueOverlaps(runnerState.allStageResults, runnerState.bestStage)) {
      const stageName = 'stereoTouchup';
      const stageStart = context.nowMs();
      const transformResult = runUnifiedCleanup(layoutGraph, parentStageResult.coords, {
        ...baseCleanupOptions,
        maxPasses: 1,
        protectBondIntegrity: true,
        frozenAtomIds: placement.frozenAtomIds
      });
      stereoTouchupStageResult = {
        name: stageName,
        ...transformResult,
        ...auditFinalStereo(transformResult.coords)
      };
      const accepted = isPreferredFinalStereoStage(stereoTouchupStageResult, runnerState.bestStage);
      const stageExecution = createStageExecutionEntry(stageName, ['stereoRescueCleanup', 'selectedGeometryCheckpoint'], {
        ran: true,
        materialized: true,
        accepted,
        elapsedMs: context.nowMs() - stageStart,
        audit: stereoTouchupStageResult.audit ?? null
      });
      addSyntheticStageResult(runnerState, stereoTouchupStageResult, stageExecution, context);
      if (accepted) {
        syncAggregateStageResult(
          runnerState,
          'stereoRescueCleanup',
          'selectedGeometryCheckpoint',
          stereoTouchupStageResult,
          stageExecution.elapsedMs
        );
      }
    }

    if (stereoTouchupStageResult && hasStereoRescueOverlaps(runnerState.allStageResults, runnerState.bestStage)) {
      const stageName = 'postTouchupStereo';
      const stageStart = context.nowMs();
      const transformResult = enforceAcyclicEZStereo(layoutGraph, stereoTouchupStageResult.coords, {
        bondLength
      });
      const stageResult = {
        name: stageName,
        ...transformResult,
        ...auditFinalStereo(transformResult.coords)
      };
      const accepted = isPreferredFinalStereoStage(stageResult, runnerState.bestStage);
      const stageExecution = createStageExecutionEntry(stageName, 'stereoTouchup', {
        ran: true,
        materialized: true,
        accepted,
        elapsedMs: context.nowMs() - stageStart,
        audit: stageResult.audit ?? null
      });
      addSyntheticStageResult(runnerState, stageResult, stageExecution, context);
      if (accepted) {
        syncAggregateStageResult(
          runnerState,
          'stereoRescueCleanup',
          'selectedGeometryCheckpoint',
          stageResult,
          stageExecution.elapsedMs
        );
      }
    }

    return runnerState;
  }

  return {
    geometryStages,
    stereoStages,
    finalStages,
    stabilizationStages,
    materializeSelectedGeometryCheckpoint,
    runStereoRescueCleanup
  };
}
