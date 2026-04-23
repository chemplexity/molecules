/** @module cleanup/candidate-search */

const OVERRIDE_KEY_PRECISION = 9;

function formatOverrideCoord(value) {
  return Number.isFinite(value) ? value.toFixed(OVERRIDE_KEY_PRECISION) : `${value}`;
}

/**
 * Builds a stable key for sparse override positions so equivalent candidates can
 * be deduped across multiple seed sources.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Sparse override map.
 * @returns {string|null} Stable override key, or `null` when overrides are missing.
 */
export function buildSparseOverrideKey(overridePositions) {
  if (!(overridePositions instanceof Map)) {
    return null;
  }
  return [...overridePositions.entries()]
    .sort(([leftAtomId], [rightAtomId]) => leftAtomId.localeCompare(rightAtomId))
    .map(([atomId, position]) => `${atomId}:${formatOverrideCoord(position?.x)}:${formatOverrideCoord(position?.y)}`)
    .join('|');
}

/**
 * Materializes a full coordinate map from a sparse override contract.
 * @param {Map<string, {x: number, y: number}>} coords - Baseline coordinate map.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Sparse override positions.
 * @returns {Map<string, {x: number, y: number}>|null} Candidate coordinate map.
 */
export function materializeSparseOverrideCoords(coords, overridePositions) {
  if (!(overridePositions instanceof Map)) {
    return null;
  }
  const candidateCoords = new Map(coords);
  for (const [atomId, position] of overridePositions) {
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, { x: position.x, y: position.y });
  }
  return candidateCoords;
}

function normalizeFollowupResult(result) {
  if (!result) {
    return null;
  }
  if (result instanceof Map) {
    return {
      coords: result,
      changed: true,
      metadata: null
    };
  }
  if (!(result.coords instanceof Map)) {
    return null;
  }
  const changed =
    typeof result.changed === 'boolean'
      ? result.changed
      : (Number.isFinite(result.nudges) && result.nudges > 0)
        || (Number.isFinite(result.passes) && result.passes > 0);
  return {
    coords: result.coords,
    changed,
    metadata: result
  };
}

function defaultIsBetterScore(candidateScore, incumbentScore) {
  return candidateScore < incumbentScore;
}

function defaultCompareEquivalentCandidates(candidate, incumbent) {
  const candidateKey = candidate?.candidateKey ?? null;
  const incumbentKey = incumbent?.candidateKey ?? null;
  if (candidateKey && incumbentKey && candidateKey !== incumbentKey) {
    return candidateKey.localeCompare(incumbentKey, 'en', { numeric: true });
  }
  return 0;
}

/**
 * Visits one descriptor's candidate seeds through a shared sparse-override
 * search loop. Callers keep descriptor collection and score shapes.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Baseline coordinate map.
 * @param {unknown} descriptor - Caller-owned descriptor payload.
 * @param {{
 *   context?: object,
 *   generateSeeds?: ((descriptor: unknown, context: object) => Iterable<unknown>|null|undefined),
 *   materializeOverrides?: ((coords: Map<string, {x: number, y: number}>, descriptor: unknown, seed: unknown, context: object, layoutGraph: object|null) => Map<string, {x: number, y: number}>|null),
 *   buildCandidateKey?: ((descriptor: unknown, overridePositions: Map<string, {x: number, y: number}>, seed: unknown, context: object, layoutGraph: object|null) => string|null|undefined),
 *   prescore?: ((descriptor: unknown, overridePositions: Map<string, {x: number, y: number}>, candidateCoords: Map<string, {x: number, y: number}>, seed: unknown, context: object, layoutGraph: object|null) => boolean),
 *   scoreSeed?: ((descriptor: unknown, candidateCoords: Map<string, {x: number, y: number}>, seed: unknown, context: object, overridePositions: Map<string, {x: number, y: number}>, layoutGraph: object|null) => unknown),
 *   postAcceptFollowups?: Array<{
 *     name?: string,
 *     maxRuns?: number,
 *     run?: ((layoutGraph: object|null, coords: Map<string, {x: number, y: number}>, descriptor: unknown, seed: unknown, context: object, state: {
 *       bestSeedCandidate: object,
 *       refinedCoords: Map<string, {x: number, y: number}>,
 *       followupResults: object[]
 *     }, runIndex: number) => Map<string, {x: number, y: number}>|{coords: Map<string, {x: number, y: number}>, changed?: boolean, nudges?: number, passes?: number}|null)
 *   }>,
 *   scoreRefined?: ((descriptor: unknown, candidateCoords: Map<string, {x: number, y: number}>, seed: unknown, context: object, state: {
 *     bestSeedCandidate: object,
 *     refinedCoords: Map<string, {x: number, y: number}>,
 *     followupResults: object[]
 *   }, layoutGraph: object|null) => unknown),
 *   isBetterScore?: ((candidateScore: unknown, incumbentScore: unknown) => boolean),
 *   compareEquivalentCandidates?: ((candidate: object, incumbent: object) => number),
 *   onAcceptedCandidate?: ((candidate: object, incumbent: object|null) => void)
 * }} [options] - Shared search hooks.
 * @returns {{
 *   bestSeedCandidate: object|null,
 *   bestFinalCandidate: object|null,
 *   visitedCount: number,
 *   acceptedCount: number
 * }} Search summary and candidate telemetry.
 */
export function visitPresentationDescriptorCandidates(layoutGraph, coords, descriptor, options = {}) {
  const context = options.context ?? {};
  const generateSeeds = typeof options.generateSeeds === 'function' ? options.generateSeeds : () => [];
  const materializeOverrides =
    typeof options.materializeOverrides === 'function'
      ? options.materializeOverrides
      : () => null;
  const isBetterScore =
    typeof options.isBetterScore === 'function'
      ? options.isBetterScore
      : defaultIsBetterScore;
  const compareEquivalentCandidates =
    typeof options.compareEquivalentCandidates === 'function'
      ? options.compareEquivalentCandidates
      : defaultCompareEquivalentCandidates;
  const seenCandidateKeys = new Set();
  let bestSeedCandidate = null;
  let bestFinalCandidate = null;
  let visitedCount = 0;
  let acceptedCount = 0;

  for (const seed of generateSeeds(descriptor, context) ?? []) {
    const overridePositions = materializeOverrides(coords, descriptor, seed, context, layoutGraph);
    if (!(overridePositions instanceof Map)) {
      continue;
    }
    const candidateKey =
      options.buildCandidateKey?.(descriptor, overridePositions, seed, context, layoutGraph)
      ?? buildSparseOverrideKey(overridePositions);
    if (candidateKey && seenCandidateKeys.has(candidateKey)) {
      continue;
    }
    if (candidateKey) {
      seenCandidateKeys.add(candidateKey);
    }

    visitedCount++;
    const candidateCoords = materializeSparseOverrideCoords(coords, overridePositions);
    if (!(candidateCoords instanceof Map)) {
      continue;
    }
    if (options.prescore?.(descriptor, overridePositions, candidateCoords, seed, context, layoutGraph) === false) {
      continue;
    }

    const seedScore = options.scoreSeed?.(descriptor, candidateCoords, seed, context, overridePositions, layoutGraph);
    if (seedScore == null) {
      continue;
    }

    const candidate = {
      descriptor,
      seed,
      candidateKey,
      overridePositions,
      coords: candidateCoords,
      score: seedScore,
      seedScore,
      finalScore: seedScore,
      followupResults: []
    };
    acceptedCount++;
    options.onAcceptedCandidate?.(candidate, bestSeedCandidate);

    const seedScoreBeatsBest = bestSeedCandidate ? isBetterScore(seedScore, bestSeedCandidate.seedScore) : true;
    const bestSeedScoreBeatsCandidate =
      bestSeedCandidate ? isBetterScore(bestSeedCandidate.seedScore, seedScore) : false;
    if (
      !bestSeedCandidate
      || seedScoreBeatsBest
      || (!bestSeedScoreBeatsCandidate && compareEquivalentCandidates(candidate, bestSeedCandidate) < 0)
    ) {
      bestSeedCandidate = candidate;
    }
  }

  if (!bestSeedCandidate) {
    return {
      bestSeedCandidate: null,
      bestFinalCandidate: null,
      visitedCount,
      acceptedCount
    };
  }

  const followupResults = [];
  let refinedCoords = bestSeedCandidate.coords;
  for (const followup of options.postAcceptFollowups ?? []) {
    if (typeof followup?.run !== 'function') {
      continue;
    }
    const maxRuns = Math.max(1, followup.maxRuns ?? 1);
    for (let runIndex = 0; runIndex < maxRuns; runIndex++) {
      const followupResult = normalizeFollowupResult(
        followup.run(layoutGraph, refinedCoords, descriptor, bestSeedCandidate.seed, context, {
          bestSeedCandidate,
          refinedCoords,
          followupResults
        }, runIndex)
      );
      if (!followupResult) {
        break;
      }
      followupResults.push({
        name: followup.name ?? null,
        runIndex,
        changed: followupResult.changed,
        ...(followupResult.metadata ?? {})
      });
      refinedCoords = followupResult.coords;
      if (!followupResult.changed) {
        break;
      }
    }
  }

  const finalScore =
    typeof options.scoreRefined === 'function'
      ? options.scoreRefined(descriptor, refinedCoords, bestSeedCandidate.seed, context, {
        bestSeedCandidate,
        refinedCoords,
        followupResults
      }, layoutGraph)
      : bestSeedCandidate.seedScore;
  if (finalScore != null) {
    bestFinalCandidate = {
      ...bestSeedCandidate,
      coords: refinedCoords,
      score: finalScore,
      finalScore,
      followupResults
    };
  }

  return {
    bestSeedCandidate,
    bestFinalCandidate,
    visitedCount,
    acceptedCount
  };
}
