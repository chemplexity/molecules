/** @module cleanup/candidate-search */

import { coordOverlayWithOverrides } from '../geometry/coord-overlay.js';

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
  if (overridePositions.size === 0) {
    return '';
  }
  if (overridePositions.size === 1) {
    const [atomId, position] = overridePositions.entries().next().value;
    return `${atomId}:${formatOverrideCoord(position?.x)}:${formatOverrideCoord(position?.y)}`;
  }

  const entries = [...overridePositions.entries()].sort(([leftAtomId], [rightAtomId]) => leftAtomId.localeCompare(rightAtomId));
  let key = '';
  for (let index = 0; index < entries.length; index++) {
    const [atomId, position] = entries[index];
    if (index > 0) {
      key += '|';
    }
    key += `${atomId}:${formatOverrideCoord(position?.x)}:${formatOverrideCoord(position?.y)}`;
  }
  return key;
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

function sparseOverrideCoordView(coords, overridePositions) {
  if (!(overridePositions instanceof Map)) {
    return null;
  }
  let filteredOverrides = null;
  for (const [atomId, position] of overridePositions) {
    if (position) {
      filteredOverrides?.set(atomId, position);
    } else if (!filteredOverrides) {
      filteredOverrides = new Map();
      for (const [previousAtomId, previousPosition] of overridePositions) {
        if (previousAtomId === atomId) {
          break;
        }
        if (previousPosition) {
          filteredOverrides.set(previousAtomId, previousPosition);
        }
      }
    }
  }
  return coordOverlayWithOverrides(coords, filteredOverrides ?? overridePositions);
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
  const changed = typeof result.changed === 'boolean' ? result.changed : (Number.isFinite(result.nudges) && result.nudges > 0) || (Number.isFinite(result.passes) && result.passes > 0);
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
 *   buildSeedKey?: ((descriptor: unknown, seed: unknown, context: object, layoutGraph: object|null) => string|null|undefined),
 *   materializeOverrides?: ((coords: Map<string, {x: number, y: number}>, descriptor: unknown, seed: unknown, context: object, layoutGraph: object|null) => Map<string, {x: number, y: number}>|null),
 *   buildCandidateKey?: ((descriptor: unknown, overridePositions: Map<string, {x: number, y: number}>, seed: unknown, context: object, layoutGraph: object|null) => string|null|undefined),
 *   useSparseCandidateOverlay?: boolean,
 *   prescore?: ((descriptor: unknown, overridePositions: Map<string, {x: number, y: number}>, candidateCoords: Map<string, {x: number, y: number}>|object, seed: unknown, context: object, layoutGraph: object|null) => boolean),
 *   scoreSeed?: ((descriptor: unknown, candidateCoords: Map<string, {x: number, y: number}>|object, seed: unknown, context: object, overridePositions: Map<string, {x: number, y: number}>, layoutGraph: object|null) => unknown),
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
  const materializeOverrides = typeof options.materializeOverrides === 'function' ? options.materializeOverrides : () => null;
  const isBetterScore = typeof options.isBetterScore === 'function' ? options.isBetterScore : defaultIsBetterScore;
  const compareEquivalentCandidates = typeof options.compareEquivalentCandidates === 'function' ? options.compareEquivalentCandidates : defaultCompareEquivalentCandidates;
  const useSparseCandidateOverlay = options.useSparseCandidateOverlay === true;
  const seenCandidateKeys = new Set();
  let bestSeedCandidate = null;
  let bestFinalCandidate = null;
  let visitedCount = 0;
  let acceptedCount = 0;

  for (const seed of generateSeeds(descriptor, context) ?? []) {
    const seedKey = options.buildSeedKey?.(descriptor, seed, context, layoutGraph) ?? null;
    if (seedKey && seenCandidateKeys.has(seedKey)) {
      continue;
    }
    if (seedKey) {
      seenCandidateKeys.add(seedKey);
    }

    const overridePositions = materializeOverrides(coords, descriptor, seed, context, layoutGraph);
    if (!(overridePositions instanceof Map)) {
      continue;
    }
    const candidateKey = seedKey ?? options.buildCandidateKey?.(descriptor, overridePositions, seed, context, layoutGraph) ?? buildSparseOverrideKey(overridePositions);
    if (candidateKey && candidateKey !== seedKey && seenCandidateKeys.has(candidateKey)) {
      continue;
    }
    if (candidateKey && candidateKey !== seedKey) {
      seenCandidateKeys.add(candidateKey);
    }

    visitedCount++;
    const candidateCoords = useSparseCandidateOverlay ? sparseOverrideCoordView(coords, overridePositions) : materializeSparseOverrideCoords(coords, overridePositions);
    if (!candidateCoords) {
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
    const bestSeedScoreBeatsCandidate = bestSeedCandidate ? isBetterScore(bestSeedCandidate.seedScore, seedScore) : false;
    if (!bestSeedCandidate || seedScoreBeatsBest || (!bestSeedScoreBeatsCandidate && compareEquivalentCandidates(candidate, bestSeedCandidate) < 0)) {
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
  if (useSparseCandidateOverlay && (options.postAcceptFollowups?.length ?? 0) > 0 && typeof refinedCoords?.toMap === 'function') {
    refinedCoords = refinedCoords.toMap();
  }
  for (const followup of options.postAcceptFollowups ?? []) {
    if (typeof followup?.run !== 'function') {
      continue;
    }
    const maxRuns = Math.max(1, followup.maxRuns ?? 1);
    for (let runIndex = 0; runIndex < maxRuns; runIndex++) {
      const followupResult = normalizeFollowupResult(
        followup.run(
          layoutGraph,
          refinedCoords,
          descriptor,
          bestSeedCandidate.seed,
          context,
          {
            bestSeedCandidate,
            refinedCoords,
            followupResults
          },
          runIndex
        )
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
      ? options.scoreRefined(
          descriptor,
          refinedCoords,
          bestSeedCandidate.seed,
          context,
          {
            bestSeedCandidate,
            refinedCoords,
            followupResults
          },
          layoutGraph
        )
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
