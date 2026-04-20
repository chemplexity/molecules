/** @module cleanup/stage-runner */

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
 * @returns {{bestStage: object, geometryCheckpointStage: object, allStageResults: Map<string, object>, accumulatedSidecars: object, stageEntries: Array<{name: string, audit: object}>}} Runner result.
 */
export function runStageGraph(stages, baselineStage, context) {
  const stageResults = new Map([[baselineStage.name, baselineStage]]);
  const stageEntries = baselineStage.audit ? [{ name: baselineStage.name, audit: baselineStage.audit }] : [];
  let bestStage = baselineStage;
  let geometryCheckpointStage = baselineStage;
  let accumulatedSidecars = {};

  for (const stage of stages) {
    if (typeof stage.guard === 'function' && stage.guard(stageResults, bestStage, context) === false) {
      continue;
    }

    const parentStageResult = resolveParentStageResult(stageResults, baselineStage, stage.parentStage, bestStage);
    if (!parentStageResult) {
      const parentStageLabel = Array.isArray(stage.parentStage) ? stage.parentStage.join(' -> ') : stage.parentStage;
      throw new Error(`Missing parent stage result for ${stage.name}: ${parentStageLabel}`);
    }

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
    if (stageResult.audit) {
      stageEntries.push({ name: stageResult.name, audit: stageResult.audit });
    }

    const prevBestStage = bestStage;
    const accepted = !stage.comparatorFn || stage.comparatorFn(stageResult, bestStage, context, stageResults);
    if (accepted) {
      bestStage = stageResult;
      if (typeof stage.accumulateSidecar === 'function') {
        accumulatedSidecars = stage.accumulateSidecar(accumulatedSidecars, stageResult, stageResults, context) ?? accumulatedSidecars;
      }
    }
    context.onStageAcceptance?.(stage.name, accepted, stageResult.audit ?? null, prevBestStage.audit ?? null);

    if (stage.isGeometryPhase) {
      geometryCheckpointStage = bestStage;
    }
  }

  return {
    bestStage,
    geometryCheckpointStage,
    allStageResults: stageResults,
    accumulatedSidecars,
    stageEntries
  };
}
