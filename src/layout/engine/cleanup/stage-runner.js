/** @module cleanup/stage-runner */

/**
 * Returns the current high-resolution time for stage telemetry.
 * @param {object} context - Shared runner context.
 * @returns {number} Current time in milliseconds.
 */
function nowMs(context) {
  if (typeof context?.nowMs === 'function') {
    return context.nowMs();
  }
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

/**
 * Returns a blank execution telemetry record for one stage.
 * @param {string} stageName - Stage name.
 * @param {string|string[]|null} parentStage - Requested parent stage descriptor.
 * @param {{ran?: boolean, returnedNull?: boolean, materialized?: boolean, accepted?: boolean, won?: boolean, elapsedMs?: number, audit?: object|null}} [overrides] - Optional field overrides.
 * @returns {{name: string, parentStage: string|string[]|null, ran: boolean, returnedNull: boolean, materialized: boolean, accepted: boolean, won: boolean, elapsedMs: number, audit: object|null}} Stage execution telemetry.
 */
export function createStageExecutionEntry(stageName, parentStage, overrides = {}) {
  return {
    name: stageName,
    parentStage: Array.isArray(parentStage) ? [...parentStage] : parentStage ?? null,
    ran: overrides.ran === true,
    returnedNull: overrides.returnedNull === true,
    materialized: overrides.materialized === true,
    accepted: overrides.accepted === true,
    won: overrides.won === true,
    elapsedMs: Number.isFinite(overrides.elapsedMs) ? overrides.elapsedMs : 0,
    audit: overrides.audit ?? null
  };
}

function mergeStabilizationRequest(accumulatedRequest, stageName, stageRequest) {
  if (stageRequest?.requested !== true) {
    return accumulatedRequest ?? null;
  }
  return {
    requested: true,
    reasons: [...new Set([...(accumulatedRequest?.reasons ?? []), ...(stageRequest.reasons ?? [])])],
    stages: [...new Set([...(accumulatedRequest?.stages ?? []), stageName])],
    maxPasses: Math.max(accumulatedRequest?.maxPasses ?? 0, stageRequest.maxPasses ?? 1)
  };
}

function ensureBaselineStageState(stageResults, stageEntries, stageExecutions, baselineStage) {
  if (!stageResults.has(baselineStage.name)) {
    stageResults.set(baselineStage.name, baselineStage);
  }
  if (baselineStage.audit && !stageEntries.some(entry => entry.name === baselineStage.name)) {
    stageEntries.push({ name: baselineStage.name, audit: baselineStage.audit });
  }
  if (!stageExecutions.has(baselineStage.name)) {
    stageExecutions.set(
      baselineStage.name,
      createStageExecutionEntry(baselineStage.name, null, {
        ran: true,
        materialized: true,
        accepted: true,
        audit: baselineStage.audit ?? null
      })
    );
  }
}

/**
 * Resolves the parent input for one stage. Parent descriptors can be a single
 * stage name, the sentinel `best`, or an ordered fallback list when an
 * optional upstream stage may legitimately return `null`.
 * @param {Map<string, object>} stageResults - Materialized stage results by name.
 * @param {{name: string, coords: Map<string, {x: number, y: number}>}} baselineStage - Baseline placement stage.
 * @param {string|string[]|null} parentStage - Requested parent stage descriptor.
 * @param {object} bestStage - Current incumbent stage result.
 * @returns {object|null} Resolved parent stage result, or null when none exists.
 */
function resolveParentStageResult(stageResults, baselineStage, parentStage, bestStage) {
  const parentStages = Array.isArray(parentStage) ? parentStage : [parentStage];
  for (const candidateParentStage of parentStages) {
    if (candidateParentStage == null) {
      return baselineStage;
    }
    if (candidateParentStage === 'best') {
      return bestStage;
    }
    const resolvedStage = stageResults.get(candidateParentStage) ?? null;
    if (resolvedStage) {
      return resolvedStage;
    }
  }
  return null;
}

/**
 * Executes a cleanup-stage DAG while tracking the current incumbent and stage sidecars.
 * @param {object[]} stages - Ordered stage descriptors.
 * @param {{name: string, coords: Map<string, {x: number, y: number}>, audit?: object}} baselineStage - Named baseline stage.
 * @param {object} context - Shared runner context.
 * @param {{allStageResults?: Map<string, object>, accumulatedSidecars?: object, accumulatedStabilizationRequest?: {requested: boolean, reasons: string[], stages: string[], maxPasses: number}|null, stageEntries?: Array<{name: string, audit: object}>, stageExecutions?: Map<string, {name: string, parentStage: string|string[]|null, ran: boolean, returnedNull: boolean, materialized: boolean, accepted: boolean, won: boolean, elapsedMs: number, audit: object|null}>, bestStage?: object, geometryCheckpointStage?: object}|null} [seedState] - Optional prior runner state to continue from.
 * @returns {{bestStage: object, geometryCheckpointStage: object, allStageResults: Map<string, object>, accumulatedSidecars: object, accumulatedStabilizationRequest: {requested: boolean, reasons: string[], stages: string[], maxPasses: number}|null, stageEntries: Array<{name: string, audit: object}>, stageExecutions: Map<string, {name: string, parentStage: string|string[]|null, ran: boolean, returnedNull: boolean, materialized: boolean, accepted: boolean, won: boolean, elapsedMs: number, audit: object|null}>}} Runner result.
 */
export function runStageGraph(stages, baselineStage, context, seedState = null) {
  const stageResults = new Map(seedState?.allStageResults ?? [[baselineStage.name, baselineStage]]);
  const stageEntries = [...(seedState?.stageEntries ?? (baselineStage.audit ? [{ name: baselineStage.name, audit: baselineStage.audit }] : []))];
  const stageExecutions = new Map(seedState?.stageExecutions ?? []);
  ensureBaselineStageState(stageResults, stageEntries, stageExecutions, baselineStage);
  let bestStage = seedState?.bestStage ?? baselineStage;
  let geometryCheckpointStage = seedState?.geometryCheckpointStage ?? baselineStage;
  let accumulatedSidecars = { ...(seedState?.accumulatedSidecars ?? {}) };
  let accumulatedStabilizationRequest = seedState?.accumulatedStabilizationRequest ?? null;

  for (const stage of stages) {
    const stageExecution = createStageExecutionEntry(stage.name, stage.parentStage);
    stageExecutions.set(stage.name, stageExecution);

    if (typeof stage.guard === 'function' && stage.guard(stageResults, bestStage, context) === false) {
      continue;
    }

    stageExecution.ran = true;
    const parentStageResult = resolveParentStageResult(stageResults, baselineStage, stage.parentStage, bestStage);
    if (!parentStageResult) {
      const parentStageLabel = Array.isArray(stage.parentStage) ? stage.parentStage.join(' -> ') : stage.parentStage;
      throw new Error(`Missing parent stage result for ${stage.name}: ${parentStageLabel}`);
    }

    const stageStart = nowMs(context);
    // Wrap onStep to automatically inject the current stage name into metadata.
    const originalOnStep = context.onStep;
    if (originalOnStep) {
      context.onStep = (label, desc, coords, meta) => originalOnStep(label, desc, coords, { ...meta, _stageName: stage.name });
    }
    const transformResult = stage.transformFn(parentStageResult.coords, context, stageResults, bestStage);
    if (originalOnStep) {
      context.onStep = originalOnStep;
    }

    if (!transformResult) {
      stageExecution.returnedNull = true;
      stageExecution.elapsedMs = nowMs(context) - stageStart;
      continue;
    }

    const stageResult = {
      name: stage.name,
      ...transformResult
    };
    if (!(stageResult.coords instanceof Map)) {
      throw new Error(`Stage ${stage.name} did not return coords.`);
    }

    const scoredStageResult = stage.scoreFn ? stage.scoreFn(stageResult.coords, stageResult, context, stageResults, bestStage) : null;
    if (scoredStageResult) {
      Object.assign(stageResult, scoredStageResult);
    }

    stageResults.set(stage.name, stageResult);
    stageExecution.materialized = true;
    stageExecution.audit = stageResult.audit ?? null;
    if (stageResult.audit) {
      stageEntries.push({ name: stageResult.name, audit: stageResult.audit });
    }

    const prevBestStage = bestStage;
    const accepted = !stage.comparatorFn || stage.comparatorFn(stageResult, bestStage, context, stageResults);
    stageExecution.accepted = accepted;
    if (accepted) {
      bestStage = stageResult;
      if (typeof stage.accumulateSidecar === 'function') {
        accumulatedSidecars = stage.accumulateSidecar(accumulatedSidecars, stageResult, stageResults, context) ?? accumulatedSidecars;
      }
      accumulatedStabilizationRequest = mergeStabilizationRequest(accumulatedStabilizationRequest, stage.name, stageResult.stabilizationRequest);
    }
    stageExecution.elapsedMs = nowMs(context) - stageStart;
    context.onStageAcceptance?.(stage.name, accepted, stageResult.audit ?? null, prevBestStage.audit ?? null);

    if (stage.isGeometryPhase) {
      geometryCheckpointStage = bestStage;
    }
  }

  for (const stageExecution of stageExecutions.values()) {
    stageExecution.won = false;
  }
  const winningStageExecution = stageExecutions.get(bestStage.name);
  if (winningStageExecution) {
    winningStageExecution.won = true;
  }

  return {
    bestStage,
    geometryCheckpointStage,
    allStageResults: stageResults,
    accumulatedSidecars,
    accumulatedStabilizationRequest,
    stageEntries,
    stageExecutions
  };
}
