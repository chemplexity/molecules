/** @module cleanup/specialists/specialist-cleanup */

import {
  hasBridgedBondTidyNeed,
  runBridgedBondTidy
} from '../bridged-bond-tidy.js';
import {
  hasHypervalentAngleTidyNeed,
  measureOrthogonalHypervalentDeviation,
  runHypervalentAngleTidy
} from '../hypervalent-angle-tidy.js';
import {
  hasLigandAngleTidyNeed,
  runLigandAngleTidy
} from '../ligand-angle-tidy.js';
import {
  hasOutstandingRingPresentationNeed,
  runRingPresentationCleanup
} from '../presentation/ring-presentation.js';
import {
  hasRingPerimeterCorrectionNeed,
  runRingPerimeterCorrection
} from '../ring-perimeter-correction.js';

const SPECIALIST_DEFINITIONS = new Map([
  [
    'ring-perimeter-correction',
    {
      id: 'macrocycle-perimeter',
      shouldRun(layoutGraph, coords, options) {
        return hasRingPerimeterCorrectionNeed(layoutGraph, coords, {
          bondLength: options.bondLength
        });
      },
      run(layoutGraph, coords, options) {
        return runRingPerimeterCorrection(layoutGraph, coords, {
          bondLength: options.bondLength
        });
      }
    }
  ],
  [
    'bridged-bond-tidy',
    {
      id: 'bridged',
      shouldRun(layoutGraph, coords, options) {
        return hasBridgedBondTidyNeed(layoutGraph, coords, {
          bondLength: options.bondLength
        });
      },
      run(layoutGraph, coords, options) {
        return runBridgedBondTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        });
      }
    }
  ],
  [
    'hypervalent-angle-tidy',
    {
      id: 'hypervalent',
      shouldRun(layoutGraph, coords) {
        return hasHypervalentAngleTidyNeed(layoutGraph, coords);
      },
      run(layoutGraph, coords) {
        return runHypervalentAngleTidy(layoutGraph, coords);
      }
    }
  ],
  [
    'ligand-angle-tidy',
    {
      id: 'ligand',
      shouldRun(layoutGraph, coords) {
        return hasLigandAngleTidyNeed(layoutGraph, coords);
      },
      run(layoutGraph, coords) {
        return runLigandAngleTidy(layoutGraph, coords);
      }
    }
  ]
]);

function appendUnique(items, item) {
  return items.includes(item) ? items : [...items, item];
}

function buildSpecialistState(coords, options, overrides = {}) {
  return {
    coords,
    nudges: overrides.nudges ?? 0,
    steps: overrides.steps ?? [],
    specialistsRun: overrides.specialistsRun ?? [],
    score:
      typeof options.scoreCoordsFn === 'function'
        ? {
            coords,
            ...(options.scoreCoordsFn(coords) ?? {})
          }
        : { coords }
  };
}

function isBetterSpecialistState(candidateState, incumbentState, options) {
  if (!incumbentState) {
    return true;
  }
  if (typeof options.comparatorFn === 'function') {
    return options.comparatorFn(candidateState.score, incumbentState.score);
  }
  return candidateState.nudges > incumbentState.nudges;
}

/**
 * Returns whether a final hypervalent retouch may override presentation
 * tie-breaks. The retouch is allowed only when it reduces orthogonal
 * hypervalent deviation and does not worsen the externally visible audit
 * counts that normally protect cleanup stages.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidateState - Candidate specialist state.
 * @param {object} incumbentState - Current specialist state.
 * @returns {boolean} True when the retouch is safe to accept.
 */
function isSafeFinalHypervalentRetouch(layoutGraph, candidateState, incumbentState) {
  const candidateDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, candidateState.coords);
  const incumbentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, incumbentState.coords);
  if (candidateDeviation >= incumbentDeviation - 1e-9) {
    return false;
  }

  const candidateAudit = candidateState.score?.audit ?? null;
  const incumbentAudit = incumbentState.score?.audit ?? null;
  if (!candidateAudit || !incumbentAudit) {
    return true;
  }
  if (incumbentAudit.ok === true && candidateAudit.ok !== true) {
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
  if ((candidateAudit.stereoContradiction ?? false) && !(incumbentAudit.stereoContradiction ?? false)) {
    return false;
  }
  if ((candidateAudit.bridgedReadabilityFailure ?? false) && !(incumbentAudit.bridgedReadabilityFailure ?? false)) {
    return false;
  }
  return candidateAudit.maxBondLengthDeviation <= incumbentAudit.maxBondLengthDeviation + 1e-9;
}

/**
 * Re-applies hypervalent tidy after any specialist-internal presentation rescue
 * when the center is still measurably off its orthogonal presentation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} currentState - Current specialist state.
 * @param {object} options - Specialist cleanup options.
 * @returns {object} The accepted retouched state, or the original state.
 */
function runFinalHypervalentRetouch(layoutGraph, currentState, options) {
  if (!hasHypervalentAngleTidyNeed(layoutGraph, currentState.coords)) {
    return currentState;
  }
  const stepResult = runHypervalentAngleTidy(layoutGraph, currentState.coords);
  if (!stepResult || !(stepResult.coords instanceof Map) || (stepResult.nudges ?? 0) <= 0) {
    return currentState;
  }

  const candidateState = buildSpecialistState(stepResult.coords, options, {
    nudges: currentState.nudges + (stepResult.nudges ?? 0),
    steps: [
      ...currentState.steps,
      {
        name: 'hypervalent-angle-final-retouch',
        nudges: stepResult.nudges ?? 0
      }
    ],
    specialistsRun: appendUnique(currentState.specialistsRun, 'hypervalent')
  });
  if (!isSafeFinalHypervalentRetouch(layoutGraph, candidateState, currentState)) {
    return currentState;
  }

  options.onStep?.('hypervalent-angle-final-retouch', candidateState.coords, stepResult.nudges ?? 0);
  return candidateState;
}

function evaluateSpecialistStep(currentState, stepName, specialistId, stepResult, options) {
  if (!stepResult || !(stepResult.coords instanceof Map) || (stepResult.nudges ?? 0) <= 0) {
    return currentState;
  }

  const candidateState = buildSpecialistState(stepResult.coords, options, {
    nudges: currentState.nudges + (stepResult.nudges ?? 0),
    steps: [
      ...currentState.steps,
      {
        name: stepName,
        nudges: stepResult.nudges ?? 0
      }
    ],
    specialistsRun: specialistId ? appendUnique(currentState.specialistsRun, specialistId) : currentState.specialistsRun
  });

  if (!isBetterSpecialistState(candidateState, currentState, options)) {
    return currentState;
  }

  options.onStep?.(stepName, candidateState.coords, stepResult.nudges ?? 0);
  return candidateState;
}

/**
 * Returns whether any configured specialist still has cheap evidence that it
 * can improve the current coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{postCleanupHooks?: string[]}} policy - Resolved policy bundle.
 * @param {{bondLength?: number}} [options] - Specialist options.
 * @returns {boolean} True when the specialist orchestrator should run.
 */
export function hasSpecialistCleanupNeed(layoutGraph, coords, policy, options = {}) {
  for (const hookName of policy.postCleanupHooks ?? []) {
    const specialist = SPECIALIST_DEFINITIONS.get(hookName);
    if (specialist?.shouldRun(layoutGraph, coords, options) === true) {
      return true;
    }
  }
  return false;
}

/**
 * Runs the configured specialist tidies behind a single late orchestrator.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{postCleanupHooks?: string[]}} policy - Resolved policy bundle.
 * @param {{
 *   bondLength?: number,
 *   frozenAtomIds?: Set<string>|null,
 *   cleanupRigidSubtreesByAtomId?: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>,
 *   protectLargeMoleculeBackbone?: boolean,
 *   scoreCoordsFn?: ((coords: Map<string, {x: number, y: number}>) => object|null),
 *   comparatorFn?: ((candidate: object, incumbent: object) => boolean),
 *   onStep?: ((stepName: string, coords: Map<string, {x: number, y: number}>, nudges: number) => void)|null
 * }} [options] - Specialist cleanup options.
 * @returns {{
 *   coords: Map<string, {x: number, y: number}>,
 *   nudges: number,
 *   changed: boolean,
 *   steps: Array<{name: string, nudges: number}>,
 *   specialistsRun: string[],
 *   stabilizationRequest: {requested: boolean, reasons: string[], maxPasses: number}|null
 * }} Best accepted specialist-cleanup result.
 */
export function runSpecialistCleanup(layoutGraph, inputCoords, policy, options = {}) {
  const hookNames = policy.postCleanupHooks ?? [];
  const allowPresentationRescue = hookNames.includes('ring-substituent-tidy');
  let currentState = buildSpecialistState(inputCoords, options);

  for (const hookName of hookNames) {
    const specialist = SPECIALIST_DEFINITIONS.get(hookName);
    if (!specialist || specialist.shouldRun(layoutGraph, currentState.coords, options) !== true) {
      continue;
    }

    const previousState = currentState;
    currentState = evaluateSpecialistStep(
      currentState,
      hookName,
      specialist.id,
      specialist.run(layoutGraph, currentState.coords, options),
      options
    );

    if (
      hookName !== 'hypervalent-angle-tidy'
      || currentState === previousState
      || allowPresentationRescue !== true
      || !hasOutstandingRingPresentationNeed(layoutGraph, currentState)
    ) {
      continue;
    }

    const rescuedState = evaluateSpecialistStep(
      currentState,
      'specialist-presentation-rescue',
      null,
      runRingPresentationCleanup(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null,
        cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
        protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true,
        includeRingSubstituent: true,
        includeTerminalHetero: false,
        includeAttachedRingFallback: false,
        scoreCoordsFn: options.scoreCoordsFn,
        comparatorFn: options.comparatorFn
      }),
      options
    );

    if (rescuedState === currentState || specialist.shouldRun(layoutGraph, rescuedState.coords, options) !== true) {
      currentState = rescuedState;
      continue;
    }

    currentState = evaluateSpecialistStep(
      rescuedState,
      'hypervalent-angle-retouch',
      specialist.id,
      specialist.run(layoutGraph, rescuedState.coords, options),
      options
    );
  }

  if (hookNames.includes('hypervalent-angle-tidy')) {
    currentState = runFinalHypervalentRetouch(layoutGraph, currentState, options);
  }

  return {
    coords: currentState.coords,
    nudges: currentState.nudges,
    changed: currentState.nudges > 0,
    steps: currentState.steps,
    specialistsRun: currentState.specialistsRun,
    stabilizationRequest:
      currentState.nudges > 0
        ? {
            requested: true,
            reasons: currentState.specialistsRun.map(specialistId => `specialist:${specialistId}`),
            maxPasses: 1
          }
        : null
  };
}
