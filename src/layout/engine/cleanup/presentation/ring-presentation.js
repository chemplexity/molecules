/** @module cleanup/presentation/ring-presentation */

import {
  collectAttachedCarbonylPresentationDescriptors
} from './attached-carbonyl.js';
import {
  collectMovableAttachedRingDescriptors,
  runAttachedRingRotationTouchup
} from './attached-ring-fallback.js';
import {
  measureRingSubstituentPresentationPenalty,
  runRingSubstituentTidy
} from './ring-substituent.js';
import { runRingTerminalHeteroTidy } from './ring-terminal-hetero.js';

const PRESENTATION_NEED_EPSILON = 1e-6;

function buildPresentationState(layoutGraph, coords, nudges, steps, options) {
  return {
    coords,
    nudges,
    steps,
    presentationPenalty: measureRingSubstituentPresentationPenalty(layoutGraph, coords),
    score:
      typeof options.scoreCoordsFn === 'function'
        ? {
            coords,
            ...(options.scoreCoordsFn(coords) ?? {})
          }
        : { coords }
  };
}

function isBetterPresentationState(candidateState, incumbentState, options) {
  if (!incumbentState) {
    return true;
  }
  if (typeof options.comparatorFn === 'function') {
    return options.comparatorFn(candidateState.score, incumbentState.score);
  }
  return candidateState.nudges > incumbentState.nudges;
}

function collectPresentationDescriptorSummary(layoutGraph, coords, options = {}) {
  return {
    attachedCarbonylDescriptorCount: collectAttachedCarbonylPresentationDescriptors(
      layoutGraph,
      coords
    ).length,
    attachedRingDescriptorCount: collectMovableAttachedRingDescriptors(
      layoutGraph,
      coords,
      options.frozenAtomIds ?? null
    ).length
  };
}

function evaluatePresentationStep(layoutGraph, currentState, stepName, stepResult, options) {
  if (!stepResult || !(stepResult.coords instanceof Map) || (stepResult.nudges ?? 0) <= 0) {
    return currentState;
  }
  const candidateState = buildPresentationState(
    layoutGraph,
    stepResult.coords,
    currentState.nudges + (stepResult.nudges ?? 0),
    [
      ...currentState.steps,
      {
        name: stepName,
        nudges: stepResult.nudges ?? 0
      }
    ],
    options
  );
  return isBetterPresentationState(candidateState, currentState, options) ? candidateState : currentState;
}

/**
 * Returns whether a stage result still needs ring-presentation cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{coords?: Map<string, {x: number, y: number}>, audit?: object|null, presentationPenalty?: number}} stageResult - Stage-like result.
 * @returns {boolean} True when ring-presentation cleanup should still be considered.
 */
export function hasOutstandingRingPresentationNeed(layoutGraph, stageResult) {
  if (!(stageResult?.coords instanceof Map)) {
    return false;
  }
  const audit = stageResult.audit ?? null;
  const presentationPenalty = stageResult.presentationPenalty ?? measureRingSubstituentPresentationPenalty(layoutGraph, stageResult.coords);
  return (
    (audit?.ringSubstituentReadabilityFailureCount ?? 0) > 0
    || (audit?.inwardRingSubstituentCount ?? 0) > 0
    || (audit?.outwardAxisRingSubstituentFailureCount ?? 0) > 0
    || (audit?.severeOverlapCount ?? 0) > 0
    || presentationPenalty > PRESENTATION_NEED_EPSILON
  );
}

/**
 * Runs late ring-presentation cleanup through a single internal escalation
 * ladder while preserving the existing worker modules.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{
 *   bondLength?: number,
 *   frozenAtomIds?: Set<string>|null,
 *   cleanupRigidSubtreesByAtomId?: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>,
 *   protectLargeMoleculeBackbone?: boolean,
 *   includeRingSubstituent?: boolean,
 *   includeTerminalHetero?: boolean,
 *   includeAttachedRingFallback?: boolean,
 *   scoreCoordsFn?: ((coords: Map<string, {x: number, y: number}>) => object|null),
 *   comparatorFn?: ((candidate: object, incumbent: object) => boolean)
 * }} [options] - Presentation cleanup options.
 * @returns {{
 *   coords: Map<string, {x: number, y: number}>,
 *   nudges: number,
 *   changed: boolean,
 *   presentationPenalty: number,
 *   strategiesRun: string[],
 *   steps: Array<{name: string, nudges: number}>,
 *   attachedCarbonylDescriptorCount: number,
 *   attachedRingDescriptorCount: number,
 *   usedAttachedRingFallback: boolean,
 *   stabilizationRequest: {requested: boolean, reasons: string[], maxPasses: number}|null
 * }} Best accepted presentation-cleanup result.
 */
export function runRingPresentationCleanup(layoutGraph, inputCoords, options = {}) {
  let currentState = buildPresentationState(layoutGraph, inputCoords, 0, [], options);

  if (options.includeRingSubstituent !== false && hasOutstandingRingPresentationNeed(layoutGraph, currentState)) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'ring-substituent',
      runRingSubstituentTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
  }

  if (options.includeTerminalHetero === true) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'ring-terminal-hetero',
      runRingTerminalHeteroTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength
      }),
      options
    );
  }

  const descriptorSummary = collectPresentationDescriptorSummary(layoutGraph, currentState.coords, options);
  if (
    options.includeAttachedRingFallback === true
    && descriptorSummary.attachedRingDescriptorCount > 0
    && hasOutstandingRingPresentationNeed(layoutGraph, currentState)
  ) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'attached-ring-fallback',
      runAttachedRingRotationTouchup(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null,
        cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
        protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true
      }),
      options
    );
  }

  const finalDescriptorSummary = collectPresentationDescriptorSummary(layoutGraph, currentState.coords, options);
  return {
    coords: currentState.coords,
    nudges: currentState.nudges,
    changed: currentState.nudges > 0,
    presentationPenalty: currentState.presentationPenalty,
    strategiesRun: currentState.steps.map(step => step.name),
    steps: currentState.steps,
    attachedCarbonylDescriptorCount: finalDescriptorSummary.attachedCarbonylDescriptorCount,
    attachedRingDescriptorCount: finalDescriptorSummary.attachedRingDescriptorCount,
    usedAttachedRingFallback: currentState.steps.some(step => step.name === 'attached-ring-fallback'),
    stabilizationRequest:
      currentState.nudges > 0
        ? {
            requested: true,
            reasons: ['presentation'],
            maxPasses: 1
          }
        : null
  };
}
