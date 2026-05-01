/** @module cleanup/presentation/ring-presentation */

import {
  collectAttachedCarbonylPresentationDescriptors
} from './attached-carbonyl.js';
import {
  findVisibleHeavyBondCrossings,
  measureThreeHeavyContinuationDistortion
} from '../../audit/invariants.js';
import {
  collectMovableAttachedRingDescriptors,
  measureAttachedRingPeripheralFocusPenalty,
  measureAttachedRingRootOutwardPresentationPenalty,
  runExactAttachedRingRootOutwardRetidy,
  runTerminalCarbonRingLeafRetidy,
  runAttachedRingRotationTouchup
} from './attached-ring-fallback.js';
import {
  measurePhosphateArylTailPresentationPenalty,
  runPhosphateArylTailTidy
} from './phosphate-aryl-tail.js';
import {
  measureTerminalCationRingProximityPenalty,
  runTerminalCationRingClearanceTidy
} from './terminal-cation-ring-clearance.js';
import { runDiarylOmittedHydrogenFanTidy } from './diaryl-omitted-h-fan.js';
import {
  measureRingSubstituentPresentationPenalty,
  runDirectAttachedRingSystemOutwardRetidy,
  runRingSubstituentTidy
} from './ring-substituent.js';
import {
  measureRingTerminalHeteroOutwardPenalty,
  measureTerminalMultipleBondLeafFanPenalty,
  runRingTerminalHeteroTidy,
  runTerminalMultipleBondLeafFanTidy
} from './ring-terminal-hetero.js';

const PRESENTATION_NEED_EPSILON = 1e-6;
const OMITTED_H_TRIGONAL_PRESENTATION_NEED = (Math.PI / 6) ** 2;

function buildPresentationState(layoutGraph, coords, nudges, steps, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const attachedRingPeripheralPenalty = measureAttachedRingPeripheralFocusPenalty(layoutGraph, coords, bondLength);
  const attachedRingRootOutwardPenalty = measureAttachedRingRootOutwardPresentationPenalty(
    layoutGraph,
    coords,
    options.frozenAtomIds ?? null
  );
  const terminalHeteroOutwardPenalty = measureRingTerminalHeteroOutwardPenalty(layoutGraph, coords);
  const terminalMultipleBondLeafFanPenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, coords);
  const omittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, coords).totalDeviation;
  const phosphateArylTailPenalty = measurePhosphateArylTailPresentationPenalty(layoutGraph, coords);
  const terminalCationRingProximityPenalty = measureTerminalCationRingProximityPenalty(layoutGraph, coords, { bondLength });
  const visibleBondCrossingCount = findVisibleHeavyBondCrossings(layoutGraph, coords).length;
  const presentationPenalty = measureRingSubstituentPresentationPenalty(layoutGraph, coords, {
    includeLinkedRingBridgePenalty: true
  });
  return {
    coords,
    nudges,
    steps,
    presentationPenalty,
    attachedRingPeripheralPenalty,
    attachedRingRootOutwardPenalty,
    omittedHydrogenTrigonalPenalty,
    terminalHeteroOutwardMaxPenalty: terminalHeteroOutwardPenalty.maxDeviation,
    terminalHeteroOutwardPenalty: terminalHeteroOutwardPenalty.totalDeviation,
    terminalMultipleBondLeafFanMaxPenalty: terminalMultipleBondLeafFanPenalty.maxDeviation,
    terminalMultipleBondLeafFanPenalty: terminalMultipleBondLeafFanPenalty.totalDeviation,
    phosphateArylTailPenalty,
    terminalCationRingProximityPenalty,
    visibleBondCrossingCount,
    score:
      {
        coords,
        presentationPenalty,
        attachedRingPeripheralPenalty,
        attachedRingRootOutwardPenalty,
        omittedHydrogenTrigonalPenalty,
        terminalHeteroOutwardMaxPenalty: terminalHeteroOutwardPenalty.maxDeviation,
        terminalHeteroOutwardPenalty: terminalHeteroOutwardPenalty.totalDeviation,
        terminalMultipleBondLeafFanMaxPenalty: terminalMultipleBondLeafFanPenalty.maxDeviation,
        terminalMultipleBondLeafFanPenalty: terminalMultipleBondLeafFanPenalty.totalDeviation,
        phosphateArylTailPenalty,
        terminalCationRingProximityPenalty,
        visibleBondCrossingCount,
        ...(typeof options.scoreCoordsFn === 'function' ? (options.scoreCoordsFn(coords) ?? {}) : {})
      }
  };
}

function isBetterPresentationState(candidateState, incumbentState, options) {
  if (!incumbentState) {
    return true;
  }
  if (candidateState.visibleBondCrossingCount !== incumbentState.visibleBondCrossingCount) {
    return candidateState.visibleBondCrossingCount < incumbentState.visibleBondCrossingCount;
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
 * @param {{coords?: Map<string, {x: number, y: number}>, audit?: object|null, presentationPenalty?: number, terminalMultipleBondLeafFanPenalty?: number}} stageResult - Stage-like result.
 * @returns {boolean} True when ring-presentation cleanup should still be considered.
 */
export function hasOutstandingRingPresentationNeed(layoutGraph, stageResult) {
  if (!(stageResult?.coords instanceof Map)) {
    return false;
  }
  const audit = stageResult.audit ?? null;
  const presentationPenalty = stageResult.presentationPenalty ?? measureRingSubstituentPresentationPenalty(layoutGraph, stageResult.coords, {
    includeLinkedRingBridgePenalty: true
  });
  const attachedRingPeripheralPenalty = stageResult.attachedRingPeripheralPenalty
    ?? measureAttachedRingPeripheralFocusPenalty(layoutGraph, stageResult.coords);
  const attachedRingRootOutwardPenalty = stageResult.attachedRingRootOutwardPenalty
    ?? measureAttachedRingRootOutwardPresentationPenalty(layoutGraph, stageResult.coords);
  const omittedHydrogenTrigonalPenalty = stageResult.omittedHydrogenTrigonalPenalty
    ?? measureThreeHeavyContinuationDistortion(layoutGraph, stageResult.coords).totalDeviation;
  const terminalMultipleBondLeafFanPenalty = stageResult.terminalMultipleBondLeafFanPenalty
    ?? measureTerminalMultipleBondLeafFanPenalty(layoutGraph, stageResult.coords).totalDeviation;
  const phosphateArylTailPenalty = stageResult.phosphateArylTailPenalty
    ?? measurePhosphateArylTailPresentationPenalty(layoutGraph, stageResult.coords);
  const terminalCationRingProximityPenalty = stageResult.terminalCationRingProximityPenalty
    ?? measureTerminalCationRingProximityPenalty(layoutGraph, stageResult.coords);
  return (
    (audit?.ringSubstituentReadabilityFailureCount ?? 0) > 0
    || (audit?.inwardRingSubstituentCount ?? 0) > 0
    || (audit?.outwardAxisRingSubstituentFailureCount ?? 0) > 0
    || (audit?.severeOverlapCount ?? 0) > 0
    || omittedHydrogenTrigonalPenalty > OMITTED_H_TRIGONAL_PRESENTATION_NEED
    || phosphateArylTailPenalty > PRESENTATION_NEED_EPSILON
    || terminalCationRingProximityPenalty > PRESENTATION_NEED_EPSILON
    || terminalMultipleBondLeafFanPenalty > PRESENTATION_NEED_EPSILON
    || attachedRingPeripheralPenalty > PRESENTATION_NEED_EPSILON
    || attachedRingRootOutwardPenalty > PRESENTATION_NEED_EPSILON
    || presentationPenalty > PRESENTATION_NEED_EPSILON
  );
}

function hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, stageResult) {
  if (!(stageResult?.coords instanceof Map)) {
    return false;
  }
  const audit = stageResult.audit ?? null;
  const presentationPenalty = stageResult.presentationPenalty ?? measureRingSubstituentPresentationPenalty(layoutGraph, stageResult.coords, {
    includeLinkedRingBridgePenalty: true
  });
  const attachedRingPeripheralPenalty = stageResult.attachedRingPeripheralPenalty
    ?? measureAttachedRingPeripheralFocusPenalty(layoutGraph, stageResult.coords);
  const attachedRingRootOutwardPenalty = stageResult.attachedRingRootOutwardPenalty
    ?? measureAttachedRingRootOutwardPresentationPenalty(layoutGraph, stageResult.coords);
  const omittedHydrogenTrigonalPenalty = stageResult.omittedHydrogenTrigonalPenalty
    ?? measureThreeHeavyContinuationDistortion(layoutGraph, stageResult.coords).totalDeviation;
  const terminalMultipleBondLeafFanPenalty = stageResult.terminalMultipleBondLeafFanPenalty
    ?? measureTerminalMultipleBondLeafFanPenalty(layoutGraph, stageResult.coords).totalDeviation;
  const terminalCationRingProximityPenalty = stageResult.terminalCationRingProximityPenalty
    ?? measureTerminalCationRingProximityPenalty(layoutGraph, stageResult.coords);
  return (
    (audit?.ringSubstituentReadabilityFailureCount ?? 0) > 0
    || (audit?.inwardRingSubstituentCount ?? 0) > 0
    || (audit?.outwardAxisRingSubstituentFailureCount ?? 0) > 0
    || (audit?.severeOverlapCount ?? 0) > 0
    || omittedHydrogenTrigonalPenalty > OMITTED_H_TRIGONAL_PRESENTATION_NEED
    || terminalCationRingProximityPenalty > PRESENTATION_NEED_EPSILON
    || terminalMultipleBondLeafFanPenalty > PRESENTATION_NEED_EPSILON
    || attachedRingPeripheralPenalty > PRESENTATION_NEED_EPSILON
    || attachedRingRootOutwardPenalty > PRESENTATION_NEED_EPSILON
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
 *   attachedRingPeripheralPenalty: number,
 *   attachedRingRootOutwardPenalty: number,
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
  let usedAttachedRingFallback = false;
  let usedDirectAttachedRingRootRetidy = false;
  let usedPhosphateArylTailTidy = false;
  let usedRingSubstituentTidy = false;

  const hasTerminalHeteroOutwardNeed = state => (
    measureRingTerminalHeteroOutwardPenalty(layoutGraph, state.coords).maxDeviation > PRESENTATION_NEED_EPSILON
  );

  if (options.includeRingSubstituent !== false) {
    const previousStepCount = currentState.steps.length;
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'phosphate-aryl-tail',
      runPhosphateArylTailTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength
      }),
      options
    );
    usedPhosphateArylTailTidy = currentState.steps.length > previousStepCount;

    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'terminal-cation-ring-clearance',
      runTerminalCationRingClearanceTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength
      }),
      options
    );

    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'diaryl-omitted-h-fan',
      runDiarylOmittedHydrogenFanTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
        protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true
      }),
      options
    );
  }

  if (
    options.includeRingSubstituent !== false
    && (
      hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
      || hasTerminalHeteroOutwardNeed(currentState)
    )
  ) {
    const previousStepCount = currentState.steps.length;
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
    usedRingSubstituentTidy = currentState.steps.length > previousStepCount;
  }

  if (options.includeRingSubstituent !== false && (!usedPhosphateArylTailTidy || usedRingSubstituentTidy)) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'phosphate-aryl-tail',
      runPhosphateArylTailTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength
      }),
      options
    );

    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'terminal-multiple-bond-leaf',
      runTerminalMultipleBondLeafFanTidy(layoutGraph, currentState.coords, {
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
    && hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
  ) {
    const previousStepCount = currentState.steps.length;
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
    usedAttachedRingFallback = currentState.steps.length > previousStepCount;
  }

  if (
    usedAttachedRingFallback
    && options.includeRingSubstituent !== false
    && hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
  ) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'ring-substituent-retidy',
      runRingSubstituentTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
  }

  if (
    usedAttachedRingFallback
    && hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
  ) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'attached-ring-root-outward-retidy',
      runExactAttachedRingRootOutwardRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );

    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'terminal-carbon-ring-leaf-retidy',
      runTerminalCarbonRingLeafRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );

    const previousStepCount = currentState.steps.length;
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'direct-attached-ring-root-retidy',
      runDirectAttachedRingSystemOutwardRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
    usedDirectAttachedRingRootRetidy = currentState.steps.length > previousStepCount;
  }

  if (
    usedAttachedRingFallback
    && usedDirectAttachedRingRootRetidy
    && options.includeAttachedRingFallback === true
    && collectPresentationDescriptorSummary(layoutGraph, currentState.coords, options).attachedRingDescriptorCount > 0
    && hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
  ) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'attached-ring-fallback-retouch',
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
    attachedRingPeripheralPenalty: currentState.attachedRingPeripheralPenalty,
    attachedRingRootOutwardPenalty: currentState.attachedRingRootOutwardPenalty,
    omittedHydrogenTrigonalPenalty: currentState.omittedHydrogenTrigonalPenalty,
    terminalHeteroOutwardMaxPenalty: currentState.terminalHeteroOutwardMaxPenalty,
    terminalHeteroOutwardPenalty: currentState.terminalHeteroOutwardPenalty,
    terminalMultipleBondLeafFanMaxPenalty: currentState.terminalMultipleBondLeafFanMaxPenalty,
    terminalMultipleBondLeafFanPenalty: currentState.terminalMultipleBondLeafFanPenalty,
    phosphateArylTailPenalty: currentState.phosphateArylTailPenalty,
    terminalCationRingProximityPenalty: currentState.terminalCationRingProximityPenalty,
    strategiesRun: currentState.steps.map(step => step.name),
    steps: currentState.steps,
    attachedCarbonylDescriptorCount: finalDescriptorSummary.attachedCarbonylDescriptorCount,
    attachedRingDescriptorCount: finalDescriptorSummary.attachedRingDescriptorCount,
    usedAttachedRingFallback,
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
