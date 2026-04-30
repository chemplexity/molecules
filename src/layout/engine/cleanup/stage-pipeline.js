/** @module cleanup/stage-pipeline */

import { auditCleanupStage, auditFinalStereoStage, measureCleanupStagePresentationPenalty } from '../audit/stage-metrics.js';
import {
  measureDivalentContinuationDistortion,
  measureThreeHeavyContinuationDistortion
} from '../audit/invariants.js';
import { collectProtectedEZAtomIds } from '../stereo/ez.js';
import { enforceAcyclicEZStereo } from '../stereo/enforcement.js';
import { mergeFrozenAtomIds } from './frozen-atoms.js';
import {
  measureAttachedRingPeripheralFocusPenalty,
  measureAttachedRingRootOutwardPresentationPenalty,
  runProjectedTetrahedralAttachedRingSlotSnap
} from './presentation/attached-ring-fallback.js';
import { hasOutstandingRingPresentationNeed, runRingPresentationCleanup } from './presentation/ring-presentation.js';
import { measurePhosphateArylTailPresentationPenalty } from './presentation/phosphate-aryl-tail.js';
import {
  hasSpecialistCleanupNeed,
  runSpecialistCleanup
} from './specialists/specialist-cleanup.js';
import { measureOrthogonalHypervalentDeviation } from './hypervalent-angle-tidy.js';
import {
  isPreferredCleanupGeometryStage,
  isPreferredFinalStereoStage,
  isPreferredProtectedCleanupStage
} from './stage-comparators.js';
import { hasSymmetryTidyNeed, tidySymmetry } from './symmetry-tidy.js';
import { runUnifiedCleanup } from './unified-cleanup.js';
import { applyLabelClearance } from './label-clearance.js';
import { createStageExecutionEntry } from './stage-runner.js';
import {
  hasRingTerminalHeteroTidyNeed,
  measureRingTerminalHeteroOutwardPenalty,
  measureTerminalMultipleBondLeafFanPenalty,
  runRingTerminalHeteroTidy,
  runTerminalMultipleBondLeafFanTidy
} from './presentation/ring-terminal-hetero.js';

function hasPostCleanupHook(policy, hookName) {
  return policy.postCleanupHooks?.includes(hookName) === true;
}

const HOOK_STEP_META = {
  'ring-perimeter-correction': ['Ring Perimeter Correction', 'Macrocycle ring perimeter drift corrected.'],
  'bridged-bond-tidy': ['Bridged Bond Tidy', 'Bridged system bond angles optimized.'],
  'hypervalent-angle-tidy': ['Hypervalent Angle Tidy', 'S/P/Se/As center angles orthogonalized.'],
  'hypervalent-angle-retouch': ['Hypervalent Angle Retouch', 'Hypervalent center angles re-orthogonalized after bounded presentation rescue.'],
  'hypervalent-angle-final-retouch': ['Hypervalent Angle Final Retouch', 'Hypervalent center angles re-orthogonalized after specialist cleanup.'],
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
    || (options.includeTerminalHetero === true && hasRingTerminalHeteroTidyNeed(layoutGraph, stageResult?.coords, {
      bondLength: options.bondLength
    }))
    || (
      options.includeRingSubstituent === true
      && measureRingTerminalHeteroOutwardPenalty(layoutGraph, stageResult?.coords).maxDeviation > 1e-6
    )
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
  const auditFinalStereoCache = new WeakMap();
  const auditFinalStereo = coords => {
    if (auditFinalStereoCache.has(coords)) {
      return auditFinalStereoCache.get(coords);
    }
    const result = auditFinalStereoStage(layoutGraph.sourceMolecule, layoutGraph, coords, placement, bondLength, runStereoPhase);
    auditFinalStereoCache.set(coords, result);
    return result;
  };
  const auditFinalStereoWithTieBreak = (candidate, incumbent) => isPreferredFinalStereoStage(candidate, incumbent, { allowPresentationTieBreak: true });
  const scorePresentationTieBreakMetrics = coords => {
    const terminalHeteroOutwardPenalty = measureRingTerminalHeteroOutwardPenalty(layoutGraph, coords);
    const terminalMultipleBondLeafFanPenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, coords);
    return {
      presentationPenalty: measureCleanupStagePresentationPenalty(layoutGraph, coords),
      divalentContinuationPenalty: measureDivalentContinuationDistortion(layoutGraph, coords).totalDeviation,
      omittedHydrogenTrigonalPenalty: measureThreeHeavyContinuationDistortion(layoutGraph, coords).totalDeviation,
      phosphateArylTailPenalty: measurePhosphateArylTailPresentationPenalty(layoutGraph, coords),
      attachedRingPeripheralPenalty: measureAttachedRingPeripheralFocusPenalty(layoutGraph, coords, bondLength),
      attachedRingRootOutwardPenalty: measureAttachedRingRootOutwardPresentationPenalty(layoutGraph, coords, placement.frozenAtomIds),
      terminalHeteroOutwardMaxPenalty: terminalHeteroOutwardPenalty.maxDeviation,
      terminalHeteroOutwardPenalty: terminalHeteroOutwardPenalty.totalDeviation,
      terminalMultipleBondLeafFanMaxPenalty: terminalMultipleBondLeafFanPenalty.maxDeviation,
      terminalMultipleBondLeafFanPenalty: terminalMultipleBondLeafFanPenalty.totalDeviation
    };
  };
  const auditFinalStereoWithPresentationMetrics = coords => ({
    ...auditFinalStereo(coords),
    ...scorePresentationTieBreakMetrics(coords)
  });
  /**
   * Returns whether specialist cleanup kept externally visible audit counts at
   * least as good as the incumbent stage.
   * @param {object|null} candidateAudit - Candidate audit summary.
   * @param {object|null} incumbentAudit - Incumbent audit summary.
   * @returns {boolean} True when audit counts did not regress.
   */
  const auditCountsDoNotWorsen = (candidateAudit, incumbentAudit) => {
    if (!candidateAudit || !incumbentAudit || (incumbentAudit.ok === true && candidateAudit.ok !== true)) {
      return false;
    }
    for (const key of [
      'bondLengthFailureCount',
      'mildBondLengthFailureCount',
      'severeBondLengthFailureCount',
      'collapsedMacrocycleCount',
      'ringSubstituentReadabilityFailureCount',
      'inwardRingSubstituentCount',
      'outwardAxisRingSubstituentFailureCount',
      'severeOverlapCount',
      'labelOverlapCount'
    ]) {
      if ((candidateAudit[key] ?? 0) > (incumbentAudit[key] ?? 0)) {
        return false;
      }
    }
    return !((candidateAudit.stereoContradiction ?? false) && !(incumbentAudit.stereoContradiction ?? false));
  };
  /**
   * Scores specialist stages with the normal final-stereo audit plus
   * hypervalent-angle deviation for specialist-specific tie-breaking.
   * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
   * @returns {object} Final-stage score with hypervalent deviation.
   */
  const auditSpecialistStage = coords => ({
    ...auditFinalStereo(coords),
    ...scorePresentationTieBreakMetrics(coords),
    hypervalentDeviation: measureOrthogonalHypervalentDeviation(layoutGraph, coords)
  });
  /**
   * Compares specialist stages, allowing exact hypervalent retouches to win
   * when they reduce sulfur/phosphorus angle deviation without audit regressions.
   * @param {object} candidate - Candidate specialist stage score.
   * @param {object} incumbent - Incumbent stage score.
   * @returns {boolean} True when the candidate should replace the incumbent.
   */
  const specialistCleanupComparator = (candidate, incumbent) => {
    if (auditFinalStereoWithTieBreak(candidate, incumbent)) {
      return true;
    }
    return (
      (candidate.hypervalentDeviation ?? Number.POSITIVE_INFINITY) < (incumbent?.hypervalentDeviation ?? Number.POSITIVE_INFINITY) - 1e-9
      && auditCountsDoNotWorsen(candidate.audit, incumbent?.audit)
    );
  };
  const terminalHeteroRetouchComparator = (candidate, incumbent) => {
    if (auditFinalStereoWithTieBreak(candidate, incumbent)) {
      return true;
    }
    if (!candidate.audit || !incumbent?.audit || candidate.audit.ok !== true || incumbent.audit.ok !== true) {
      return false;
    }
    for (const key of [
      'bondLengthFailureCount',
      'mildBondLengthFailureCount',
      'severeBondLengthFailureCount',
      'collapsedMacrocycleCount',
      'ringSubstituentReadabilityFailureCount',
      'inwardRingSubstituentCount',
      'outwardAxisRingSubstituentFailureCount',
      'severeOverlapCount'
    ]) {
      if ((candidate.audit[key] ?? 0) > (incumbent.audit[key] ?? 0)) {
        return false;
      }
    }
    if ((candidate.audit.stereoContradiction ?? false) && !(incumbent.audit.stereoContradiction ?? false)) {
      return false;
    }
    if ((candidate.audit.labelOverlapCount ?? 0) > (incumbent.audit.labelOverlapCount ?? 0) + 1) {
      return false;
    }
    return (
      (candidate.terminalHeteroOutwardMaxPenalty ?? Number.POSITIVE_INFINITY)
        < (incumbent.terminalHeteroOutwardMaxPenalty ?? Number.POSITIVE_INFINITY) - 1e-9
    );
  };
  const terminalMultipleBondLeafRetouchComparator = (candidate, incumbent) => {
    if (auditFinalStereoWithTieBreak(candidate, incumbent)) {
      return true;
    }
    if (!auditCountsDoNotWorsen(candidate.audit, incumbent?.audit)) {
      return false;
    }
    return (
      (candidate.terminalMultipleBondLeafFanMaxPenalty ?? Number.POSITIVE_INFINITY)
        < (incumbent.terminalMultipleBondLeafFanMaxPenalty ?? Number.POSITIVE_INFINITY) - 1e-9
      || (candidate.terminalMultipleBondLeafFanPenalty ?? Number.POSITIVE_INFINITY)
        < (incumbent.terminalMultipleBondLeafFanPenalty ?? Number.POSITIVE_INFINITY) - 1e-9
    );
  };
  const cleanupGeometryComparator = protectBondIntegrity
    ? (candidate, incumbent) => isPreferredProtectedCleanupStage(familySummary, placement, candidate, incumbent)
    : isPreferredCleanupGeometryStage;
  const scoreGeometryStage = coords => ({
    audit: auditCleanupStage(layoutGraph, coords, placement, bondLength),
    ...scorePresentationTieBreakMetrics(coords)
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
        const projectedSlotSnap = runProjectedTetrahedralAttachedRingSlotSnap(layoutGraph, parentCoords, {
          bondLength,
          frozenAtomIds: placement.frozenAtomIds
        });
        const cleanupInputCoords = projectedSlotSnap.nudges > 0 ? projectedSlotSnap.coords : parentCoords;
        const cleanupResult = runUnifiedCleanup(layoutGraph, cleanupInputCoords, {
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
            overlapMoves: cleanupResult.overlapMoves,
            projectedSlotSnaps: projectedSlotSnap.nudges
          }
        );
        return {
          ...cleanupResult,
          projectedSlotSnaps: projectedSlotSnap.nudges
        };
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
          bondLength,
          includeRingSubstituent: hasRingSubstituentHook,
          includeTerminalHetero: hasRingTerminalHeteroHook,
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
          scoreCoordsFn: auditFinalStereoWithPresentationMetrics,
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
          presentationPenalty: presentationResult.presentationPenalty,
          attachedRingPeripheralPenalty: presentationResult.attachedRingPeripheralPenalty,
          attachedRingRootOutwardPenalty: presentationResult.attachedRingRootOutwardPenalty,
          omittedHydrogenTrigonalPenalty: presentationResult.omittedHydrogenTrigonalPenalty,
          terminalHeteroOutwardMaxPenalty: presentationResult.terminalHeteroOutwardMaxPenalty,
          terminalHeteroOutwardPenalty: presentationResult.terminalHeteroOutwardPenalty,
          terminalMultipleBondLeafFanMaxPenalty: presentationResult.terminalMultipleBondLeafFanMaxPenalty,
          terminalMultipleBondLeafFanPenalty: presentationResult.terminalMultipleBondLeafFanPenalty,
          phosphateArylTailPenalty: presentationResult.phosphateArylTailPenalty,
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
      scoreFn: auditFinalStereoWithPresentationMetrics,
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
          scoreCoordsFn: auditSpecialistStage,
          comparatorFn: specialistCleanupComparator,
          onStep: inputContext.onStep
            ? (stepName, coords, nudges) => {
                const [label, description] = HOOK_STEP_META[stepName] ?? [stepName, 'Specialist cleanup step.'];
                inputContext.onStep(label, description, inputContext.copyCoords(coords), { nudges });
              }
            : null
        });
        return result.nudges > 0 ? result : null;
      },
      scoreFn: auditSpecialistStage,
      comparatorFn: specialistCleanupComparator,
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
      scoreFn: auditFinalStereoWithPresentationMetrics,
      comparatorFn: auditFinalStereoWithTieBreak
    },
    {
      name: 'ringTerminalHeteroFinalRetouch',
      parentStage: 'best',
      guard(_stageResults, incumbent) {
        return (
          (hasRingTerminalHeteroHook || hasRingSubstituentHook)
          && (
            hasRingTerminalHeteroTidyNeed(layoutGraph, incumbent?.coords, { bondLength })
            || measureRingTerminalHeteroOutwardPenalty(layoutGraph, incumbent?.coords).maxDeviation > 1e-6
          )
        );
      },
      transformFn(parentCoords, inputContext) {
        const result = runRingTerminalHeteroTidy(layoutGraph, parentCoords, { bondLength });
        if ((result.nudges ?? 0) <= 0) {
          return null;
        }
        const [label, description] = HOOK_STEP_META['ring-terminal-hetero-tidy'];
        inputContext.onStep?.(label, description, inputContext.copyCoords(result.coords), {
          nudges: result.nudges,
          finalRetouch: true
        });
        return result;
      },
      scoreFn: auditFinalStereoWithPresentationMetrics,
      comparatorFn: terminalHeteroRetouchComparator,
      accumulateSidecar: acceptedNudgeAccumulator('ringTerminalHeteroFinalRetouch')
    },
    {
      name: 'terminalMultipleBondLeafFinalRetouch',
      parentStage: 'best',
      guard(_stageResults, incumbent) {
        return measureTerminalMultipleBondLeafFanPenalty(layoutGraph, incumbent?.coords).maxDeviation > 1e-6;
      },
      transformFn(parentCoords, inputContext) {
        const result = runTerminalMultipleBondLeafFanTidy(layoutGraph, parentCoords, { bondLength });
        if ((result.nudges ?? 0) <= 0) {
          return null;
        }
        const [label, description] = HOOK_STEP_META['ring-presentation-tidy'];
        inputContext.onStep?.(label, description, inputContext.copyCoords(result.coords), {
          nudges: result.nudges,
          strategiesRun: ['terminal-multiple-bond-leaf'],
          finalRetouch: true
        });
        return result;
      },
      scoreFn: auditFinalStereoWithPresentationMetrics,
      comparatorFn: terminalMultipleBondLeafRetouchComparator,
      accumulateSidecar: acceptedNudgeAccumulator('terminalMultipleBondLeafFinalRetouch')
    }
  ];

  function materializeSelectedGeometryCheckpoint(runnerState) {
    const checkpointStart = context.nowMs();
    const stageResult = context.hasStereoTargets === true
      ? {
          name: 'selectedGeometryCheckpoint',
          ...auditFinalStereo(runnerState.bestStage.coords),
          ...scorePresentationTieBreakMetrics(runnerState.bestStage.coords)
        }
      : {
          name: 'selectedGeometryCheckpoint',
          coords: runnerState.bestStage.coords,
          stereo: context.emptyStereoSummary,
          audit: runnerState.bestStage.audit ?? null,
          ...scorePresentationTieBreakMetrics(runnerState.bestStage.coords)
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

    function runSyntheticStereoStage(stageName, parentStageName, stageStart, transformResult) {
      const stageResult = {
        name: stageName,
        ...transformResult,
        ...auditFinalStereo(transformResult.coords)
      };
      const accepted = isPreferredFinalStereoStage(stageResult, runnerState.bestStage);
      const stageExecution = createStageExecutionEntry(stageName, parentStageName, {
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
      return stageResult;
    }

    const protectedFrozenAtomIds = mergeFrozenAtomIds(placement.frozenAtomIds, collectProtectedEZAtomIds(layoutGraph));
    let stereoTouchupStageResult = null;

    if (protectedFrozenAtomIds != null && hasStereoRescueOverlaps(runnerState.allStageResults, runnerState.bestStage)) {
      const stageStart = context.nowMs();
      runSyntheticStereoStage(
        'stereoProtectedTouchup',
        ['stereoRescueCleanup', 'selectedGeometryCheckpoint'],
        stageStart,
        runUnifiedCleanup(layoutGraph, parentStageResult.coords, {
          ...baseCleanupOptions,
          maxPasses: 1,
          protectBondIntegrity: true,
          frozenAtomIds: protectedFrozenAtomIds
        })
      );
    }

    if (hasStereoRescueOverlaps(runnerState.allStageResults, runnerState.bestStage)) {
      const stageStart = context.nowMs();
      stereoTouchupStageResult = runSyntheticStereoStage(
        'stereoTouchup',
        ['stereoRescueCleanup', 'selectedGeometryCheckpoint'],
        stageStart,
        runUnifiedCleanup(layoutGraph, parentStageResult.coords, {
          ...baseCleanupOptions,
          maxPasses: 1,
          protectBondIntegrity: true,
          frozenAtomIds: placement.frozenAtomIds
        })
      );
    }

    if (stereoTouchupStageResult && hasStereoRescueOverlaps(runnerState.allStageResults, runnerState.bestStage)) {
      const stageStart = context.nowMs();
      runSyntheticStereoStage(
        'postTouchupStereo',
        'stereoTouchup',
        stageStart,
        enforceAcyclicEZStereo(layoutGraph, stereoTouchupStageResult.coords, { bondLength })
      );
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
