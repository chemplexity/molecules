/** @module cleanup/telemetry */

const CLEANUP_STAGE_ALIASES = Object.freeze({
  placement: Object.freeze({ targetStage: 'placement', category: 'placement' }),
  coreGeometryCleanup: Object.freeze({ targetStage: 'coreGeometryCleanup', category: 'core-geometry' }),
  cleanup: Object.freeze({ targetStage: 'coreGeometryCleanup', category: 'core-geometry' }),
  presentationCleanup: Object.freeze({ targetStage: 'presentationCleanup', category: 'presentation' }),
  postCleanup: Object.freeze({ targetStage: 'presentationCleanup', category: 'presentation' }),
  stabilizeAfterCleanup: Object.freeze({ targetStage: 'stabilizeAfterCleanup', category: 'stabilization' }),
  postHookCleanup: Object.freeze({ targetStage: 'stabilizeAfterCleanup', category: 'stabilization' }),
  selectedGeometryCheckpoint: Object.freeze({ targetStage: 'selectedGeometryCheckpoint', category: 'checkpoint' }),
  selectedGeometryStereo: Object.freeze({ targetStage: 'selectedGeometryCheckpoint', category: 'checkpoint' }),
  stereoRescueCleanup: Object.freeze({ targetStage: 'stereoRescueCleanup', category: 'stereo-rescue' }),
  stereoCleanup: Object.freeze({ targetStage: 'stereoRescueCleanup', category: 'stereo-rescue' }),
  stereoProtectedTouchup: Object.freeze({ targetStage: 'stereoRescueCleanup', category: 'stereo-rescue' }),
  stereoTouchup: Object.freeze({ targetStage: 'stereoRescueCleanup', category: 'stereo-rescue' }),
  postTouchupStereo: Object.freeze({ targetStage: 'stereoRescueCleanup', category: 'stereo-rescue' }),
  specialistCleanup: Object.freeze({ targetStage: 'specialistCleanup', category: 'specialist' }),
  finalHypervalentTouchup: Object.freeze({ targetStage: 'specialistCleanup', category: 'specialist' }),
  finalSpecialistCleanup: Object.freeze({ targetStage: 'specialistCleanup', category: 'specialist' }),
  finalHypervalentRingSubstituentTouchup: Object.freeze({ targetStage: 'specialistCleanup', category: 'specialist' }),
  finalPresentationTouchup: Object.freeze({ targetStage: 'presentationCleanup', category: 'presentation-fallback' }),
  finalRingSubstituentTouchup: Object.freeze({ targetStage: 'presentationCleanup', category: 'presentation-fallback' }),
  finalAttachedRingRotationTouchup: Object.freeze({ targetStage: 'presentationCleanup', category: 'presentation-fallback' }),
  finalRingTerminalHeteroTouchup: Object.freeze({ targetStage: 'presentationCleanup', category: 'presentation' }),
  finalPostRingHypervalentTouchup: Object.freeze({ targetStage: 'specialistCleanup', category: 'specialist' })
});

/**
 * Returns the current alias metadata for one stage name.
 * @param {string|null|undefined} stageName - Cleanup stage name.
 * @returns {{legacyStage: string|null, targetStage: string|null, category: string|null}} Alias metadata.
 */
export function getCleanupStageAlias(stageName) {
  if (!stageName) {
    return {
      legacyStage: null,
      targetStage: null,
      category: null
    };
  }
  const alias = CLEANUP_STAGE_ALIASES[stageName] ?? null;
  return {
    legacyStage: stageName,
    targetStage: alias?.targetStage ?? stageName,
    category: alias?.category ?? null
  };
}

/**
 * Returns the empty cleanup telemetry payload used before any stages run.
 * @returns {{selectedGeometryStage: null, selectedStage: null, selectedGeometryStageAlias: null, selectedStageAlias: null, selectedGeometryStageCategory: null, selectedStageCategory: null, stages: object, counts: object, stabilizationRequests: object, presentationFallbacks: object}} Empty telemetry.
 */
export function createEmptyCleanupTelemetry() {
  return {
    selectedGeometryStage: null,
    selectedStage: null,
    selectedGeometryStageAlias: null,
    selectedStageAlias: null,
    selectedGeometryStageCategory: null,
    selectedStageCategory: null,
    stages: {},
    counts: {
      stagesTracked: 0,
      stagesRan: 0,
      stagesMaterialized: 0,
      stagesReturnedNull: 0,
      stagesWon: 0,
      stabilizationRequestCount: 0,
      presentationFallbackEscalationCount: 0
    },
    stabilizationRequests: {
      count: 0,
      stages: [],
      reasons: []
    },
    presentationFallbacks: {
      count: 0,
      stages: [],
      won: false
    }
  };
}

/**
 * Derives the `stageTelemetry` payload from cleanup telemetry so both
 * metadata views stay aligned.
 * @param {object} cleanupTelemetry - Cleanup telemetry payload.
 * @returns {{selectedGeometryStage: string|null, selectedStage: string|null, firstDirtyStage: string|null, finalDirtyStage: string|null, stageAudits: object}} Stage telemetry payload.
 */
export function buildStageTelemetryFromCleanupTelemetry(cleanupTelemetry) {
  const stageAudits = Object.fromEntries(
    Object.entries(cleanupTelemetry.stages ?? {})
      .filter(([, stage]) => stage.audit)
      .map(([stageName, stage]) => [stageName, stage.audit])
  );
  const firstDirtyStage = Object.entries(stageAudits).find(([, audit]) => audit?.ok === false)?.[0] ?? null;
  return {
    selectedGeometryStage: cleanupTelemetry.selectedGeometryStage ?? null,
    selectedStage: cleanupTelemetry.selectedStage ?? null,
    firstDirtyStage,
    finalDirtyStage:
      cleanupTelemetry.selectedStage && stageAudits[cleanupTelemetry.selectedStage]?.ok === false
        ? cleanupTelemetry.selectedStage
        : null,
    stageAudits
  };
}

/**
 * Returns the empty `stageTelemetry` payload.
 * @returns {{selectedGeometryStage: string|null, selectedStage: string|null, firstDirtyStage: string|null, finalDirtyStage: string|null, stageAudits: object}} Empty stage telemetry payload.
 */
export function createEmptyStageTelemetry() {
  return buildStageTelemetryFromCleanupTelemetry(createEmptyCleanupTelemetry());
}

/**
 * Builds the permanent cleanup telemetry payload from runner execution data.
 * @param {Map<string, {name: string, parentStage: string|string[]|null, ran: boolean, returnedNull: boolean, materialized: boolean, accepted: boolean, won: boolean, elapsedMs: number, audit: object|null}>} stageExecutions - Stage execution data from the runner.
 * @param {Map<string, object>} stageResults - Materialized stage results by name.
 * @param {string|null|undefined} selectedGeometryStage - Winning geometry checkpoint stage name.
 * @param {string|null|undefined} selectedStage - Winning final stage name.
 * @param {{requested: boolean, reasons: string[], stages: string[], maxPasses: number}|null} [accumulatedStabilizationRequest] - Accepted stabilization requests merged across stages.
 * @returns {object} Cleanup telemetry payload.
 */
export function buildCleanupTelemetry(stageExecutions, stageResults, selectedGeometryStage, selectedStage, accumulatedStabilizationRequest = null) {
  const stages = {};
  let stagesRan = 0;
  let stagesMaterialized = 0;
  let stagesReturnedNull = 0;
  let stagesWon = 0;

  for (const [stageName, execution] of stageExecutions) {
    const alias = getCleanupStageAlias(stageName);
    const stageResult = stageResults.get(stageName) ?? null;
    const stageTelemetry = {
      legacyStage: stageName,
      targetStage: alias.targetStage,
      category: alias.category,
      parentStage: execution.parentStage,
      ran: execution.ran === true,
      returnedNull: execution.returnedNull === true,
      materialized: execution.materialized === true || stageResult != null,
      accepted: execution.accepted === true,
      won: execution.won === true,
      elapsedMs: Number.isFinite(execution.elapsedMs) ? execution.elapsedMs : 0,
      audit: stageResult?.audit ?? execution.audit ?? null
    };
    stages[stageName] = stageTelemetry;
    stagesRan += stageTelemetry.ran ? 1 : 0;
    stagesMaterialized += stageTelemetry.materialized ? 1 : 0;
    stagesReturnedNull += stageTelemetry.returnedNull ? 1 : 0;
    stagesWon += stageTelemetry.won ? 1 : 0;
  }

  const selectedGeometryAlias = getCleanupStageAlias(selectedGeometryStage);
  const selectedAlias = getCleanupStageAlias(selectedStage);
  const presentationFallbackStages = new Set(
    Object.entries(stages)
      .filter(([, stage]) => stage.category === 'presentation-fallback' && stage.ran)
      .map(([stageName]) => stageName)
  );
  if (stageResults.get('presentationCleanup')?.usedAttachedRingFallback === true) {
    presentationFallbackStages.add('presentationCleanup');
  }
  const stabilizationRequestStages = accumulatedStabilizationRequest?.stages ?? [];
  const stabilizationRequestReasons = accumulatedStabilizationRequest?.reasons ?? [];

  return {
    selectedGeometryStage: selectedGeometryStage ?? null,
    selectedStage: selectedStage ?? null,
    selectedGeometryStageAlias: selectedGeometryAlias.targetStage,
    selectedStageAlias: selectedAlias.targetStage,
    selectedGeometryStageCategory: selectedGeometryAlias.category,
    selectedStageCategory: selectedAlias.category,
    stages,
    counts: {
      stagesTracked: Object.keys(stages).length,
      stagesRan,
      stagesMaterialized,
      stagesReturnedNull,
      stagesWon,
      stabilizationRequestCount: stabilizationRequestStages.length,
      presentationFallbackEscalationCount: presentationFallbackStages.size
    },
    stabilizationRequests: {
      count: stabilizationRequestStages.length,
      stages: [...stabilizationRequestStages],
      reasons: [...stabilizationRequestReasons]
    },
    presentationFallbacks: {
      count: presentationFallbackStages.size,
      stages: [...presentationFallbackStages],
      won: presentationFallbackStages.has(selectedStage ?? '')
    }
  };
}
