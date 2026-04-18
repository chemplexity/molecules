/** @module cleanup/stage-runner */

function resolveParentStageResult(stageResults, baselineStage, parentStage, bestStage) {
  if (parentStage == null) {
    return baselineStage;
  }
  if (parentStage === 'best') {
    return bestStage;
  }
  return stageResults.get(parentStage) ?? null;
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
      throw new Error(`Missing parent stage result for ${stage.name}: ${stage.parentStage}`);
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
