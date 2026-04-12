/** @module pipeline */

import { normalizeOptions } from './options.js';
import { resolveProfile } from './profile.js';
import { createLayoutGraph } from './model/layout-graph.js';
import { resolvePolicy } from './standards/profile-policy.js';
import { layoutSupportedComponents } from './placement/component-layout.js';
import { applyLabelClearance } from './cleanup/label-clearance.js';
import { runLigandAngleTidy } from './cleanup/ligand-angle-tidy.js';
import { runRingPerimeterCorrection } from './cleanup/ring-perimeter-correction.js';
import { tidySymmetry } from './cleanup/symmetry-tidy.js';
import { runUnifiedCleanup } from './cleanup/unified-cleanup.js';
import { auditLayout } from './audit/audit.js';
import { createQualityReport } from './model/quality-report.js';
import { inspectEZStereo } from './stereo/ez.js';
import { enforceAcyclicEZStereo } from './stereo/enforcement.js';
import { pickWedgeAssignments } from './stereo/wedge-selection.js';
import { inspectRingDependency } from './topology/ring-dependency.js';
import { exceedsLargeMoleculeThreshold } from './topology/large-blocks.js';
import { findMacrocycleRings } from './topology/macrocycles.js';
import { buildScaffoldPlan } from './model/scaffold-plan.js';

/**
 * Returns the atom count for a molecule-like input when it can be determined.
 * @param {object|null|undefined} molecule - Molecule-like value.
 * @returns {number|null} Atom count, or null when the value is not molecule-like.
 */
function moleculeAtomCount(molecule) {
  if (!molecule || typeof molecule !== 'object') {
    return null;
  }
  if (Number.isInteger(molecule.atomCount)) {
    return molecule.atomCount;
  }
  if (molecule.atoms instanceof Map) {
    return molecule.atoms.size;
  }
  return null;
}

/**
 * Returns whether the input is missing or has no atoms to lay out.
 * @param {object|null|undefined} molecule - Molecule-like value.
 * @returns {boolean} True when the pipeline should short-circuit.
 */
function isEmptyLayoutInput(molecule) {
  const atomCount = moleculeAtomCount(molecule);
  return atomCount == null || atomCount === 0;
}

/**
 * Builds the stable empty/invalid pipeline result used for guarded API entry.
 * @param {object|null|undefined} molecule - Original molecule input.
 * @param {object} normalizedOptions - Normalized layout options.
 * @param {string} profile - Resolved profile name.
 * @param {'empty-molecule'|'invalid-molecule'} reason - Guard reason.
 * @returns {object} Empty pipeline result.
 */
function createEmptyPipelineResult(molecule, normalizedOptions, profile, reason) {
  const policy = resolvePolicy(profile, {});
  const ringDependency = {
    ok: true,
    requiresDedicatedRingEngine: false,
    suspiciousSystemCount: 0,
    systems: [],
    rings: [],
    connections: []
  };
  const stereo = {
    ezCheckedBondCount: 0,
    ezResolvedBondCount: 0,
    ezViolationCount: 0,
    ezChecks: [],
    chiralCenterCount: 0,
    assignedCenterCount: 0,
    unassignedCenterCount: 0,
    assignments: [],
    missingCenterIds: []
  };
  const cleanup = {
    passes: 0,
    improvement: 0,
    overlapMoves: 0,
    labelNudges: 0,
    symmetrySnaps: 0,
    junctionSnaps: 0,
    stereoReflections: 0,
    postHookNudges: 0
  };
  const audit = {
    ok: false,
    severeOverlapCount: 0,
    labelOverlapCount: 0,
    maxBondLengthDeviation: 0,
    meanBondLengthDeviation: 0,
    bondLengthFailureCount: 0,
    collapsedMacrocycleCount: 0,
    stereoContradiction: false,
    bridgedReadabilityFailure: false,
    fallback: {
      recommended: false,
      mode: null,
      reasons: []
    },
    reason
  };

  return {
    molecule: molecule ?? null,
    coords: new Map(),
    layoutGraph: null,
    metadata: {
      stage: 'unsupported',
      profile,
      primaryFamily: 'empty',
      mixedMode: false,
      componentCount: 0,
      ringCount: 0,
      ringSystemCount: 0,
      fixedAtomCount: normalizedOptions.fixedCoords.size,
      existingCoordCount: normalizedOptions.existingCoords.size,
      placedComponentCount: 0,
      unplacedComponentCount: 0,
      preservedComponentCount: 0,
      placedFamilies: [],
      bondValidationClassCount: 0,
      displayAssignmentCount: 0,
      displayAssignments: [],
      policy,
      ringDependency,
      stereo,
      cleanupPasses: cleanup.passes,
      cleanupImprovement: cleanup.improvement,
      cleanupOverlapMoves: cleanup.overlapMoves,
      cleanupLabelNudges: cleanup.labelNudges,
      cleanupSymmetrySnaps: cleanup.symmetrySnaps,
      cleanupJunctionSnaps: cleanup.junctionSnaps,
      cleanupStereoReflections: cleanup.stereoReflections,
      cleanupPostHookNudges: cleanup.postHookNudges,
      audit,
      qualityReport: createQualityReport({
        audit,
        cleanup,
        stereo,
        ringDependency,
        policy
      })
    }
  };
}

function buildInitialCoordsMap(options) {
  const coords = new Map();
  for (const [atomId, position] of options.existingCoords) {
    coords.set(atomId, { ...position });
  }
  for (const [atomId, position] of options.fixedCoords) {
    coords.set(atomId, { ...position });
  }
  return coords;
}

/**
 * Applies the configured post-cleanup hook list to the current coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} policy - Resolved policy bundle.
 * @param {object} options - Hook options.
 * @param {number} options.bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, hookNudges: number}} Hook-adjusted coordinates and total hook nudges.
 */
function runPostCleanupHooks(layoutGraph, inputCoords, policy, options) {
  const hookRunners = new Map([
    ['ring-perimeter-correction', coords => runRingPerimeterCorrection(layoutGraph, coords, {
      bondLength: options.bondLength
    })],
    ['ligand-angle-tidy', coords => runLigandAngleTidy(layoutGraph, coords, {
      bondLength: options.bondLength
    })]
  ]);
  let coords = inputCoords;
  let hookNudges = 0;

  for (const hookName of policy.postCleanupHooks ?? []) {
    const runHook = hookRunners.get(hookName);
    if (!runHook) {
      continue;
    }
    const result = runHook(coords);
    coords = result.coords;
    hookNudges += result.nudges ?? 0;
  }

  return { coords, hookNudges };
}

/**
 * Classifies the current layout graph into a primary family and mixed-mode flag.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {{primaryFamily: string, mixedMode: boolean}} Family summary.
 */
export function classifyFamily(layoutGraph) {
  const threshold = layoutGraph.options.largeMoleculeThreshold;
  const ringAtomIds = new Set();
  for (const ring of layoutGraph.rings) {
    for (const atomId of ring.atomIds) {
      ringAtomIds.add(atomId);
    }
  }
  const hasNonRingHeavyAtoms = [...layoutGraph.atoms.values()].some(atom => atom.element !== 'H' && !ringAtomIds.has(atom.id));
  const exceedsLargeThreshold = exceedsLargeMoleculeThreshold(layoutGraph.traits, threshold, layoutGraph.components.length);
  const hasMacrocycle = findMacrocycleRings(layoutGraph.rings).length > 0;

  let primaryFamily = 'acyclic';
  if (exceedsLargeThreshold) {
    primaryFamily = 'large-molecule';
  } else if (layoutGraph.traits.containsMetal) {
    primaryFamily = 'organometallic';
  } else if (hasMacrocycle) {
    primaryFamily = 'macrocycle';
  } else if (layoutGraph.rings.length > 0) {
    const principalComponent = layoutGraph.components[0] ?? null;
    if (principalComponent) {
      primaryFamily = buildScaffoldPlan(layoutGraph, principalComponent).rootScaffold.family;
    } else if (layoutGraph.ringConnections.some(connection => connection.kind === 'bridged')) {
      primaryFamily = 'bridged';
    } else if (layoutGraph.ringConnections.some(connection => connection.kind === 'spiro')) {
      primaryFamily = 'spiro';
    } else if (layoutGraph.ringSystems.some(system => system.ringIds.length > 1)) {
      primaryFamily = 'fused';
    } else {
      primaryFamily = 'isolated-ring';
    }
  }

  return {
    primaryFamily,
    mixedMode: primaryFamily !== 'acyclic' && (hasNonRingHeavyAtoms || layoutGraph.ringSystems.length > 1)
  };
}

/**
 * Runs the current layout shell: options, topology analysis, standards
 * policy, and deterministic coordinate placement for the currently supported
 * core families (acyclic, isolated-ring, fused, and spiro).
 * @param {object} molecule - Molecule-like graph.
 * @param {object} [options] - Layout options.
 * @returns {object} Pipeline result.
 */
export function runPipeline(molecule, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const profile = resolveProfile(normalizedOptions.profile);
  if (isEmptyLayoutInput(molecule)) {
    const atomCount = moleculeAtomCount(molecule);
    return createEmptyPipelineResult(
      molecule,
      normalizedOptions,
      profile,
      atomCount === 0 ? 'empty-molecule' : 'invalid-molecule'
    );
  }
  const layoutGraph = createLayoutGraph(molecule, normalizedOptions);
  const familySummary = classifyFamily(layoutGraph);
  const policy = resolvePolicy(profile, {
    ...layoutGraph.traits,
    ...familySummary
  });
  const coords = buildInitialCoordsMap(normalizedOptions);
  const placement = layoutSupportedComponents(layoutGraph, policy);
  const cleanupPass = placement.placedComponentCount > 0
    ? runUnifiedCleanup(layoutGraph, placement.coords, {
      maxPasses: normalizedOptions.maxCleanupPasses,
      epsilon: normalizedOptions.bondLength * 0.001,
      bondLength: normalizedOptions.bondLength
    })
    : { coords: placement.coords, passes: 0, improvement: 0, overlapMoves: 0 };
  const labelClearance = placement.placedComponentCount > 0
    ? applyLabelClearance(layoutGraph, cleanupPass.coords, {
      bondLength: normalizedOptions.bondLength,
      labelMetrics: normalizedOptions.labelMetrics
    })
    : { coords: cleanupPass.coords, nudges: 0 };
  const symmetryTidy = placement.placedComponentCount > 0
    ? tidySymmetry(labelClearance.coords, {
      epsilon: normalizedOptions.bondLength * 0.01,
      layoutGraph
    })
    : { coords: labelClearance.coords, snappedCount: 0, junctionSnapCount: 0 };
  const stereoCleanup = placement.placedComponentCount > 0
    ? enforceAcyclicEZStereo(layoutGraph, symmetryTidy.coords, {
      bondLength: normalizedOptions.bondLength
    })
    : { coords: symmetryTidy.coords, reflections: 0 };
  const postCleanup = placement.placedComponentCount > 0
    ? runPostCleanupHooks(layoutGraph, stereoCleanup.coords, policy, {
      bondLength: normalizedOptions.bondLength
    })
    : { coords: stereoCleanup.coords, hookNudges: 0 };
  const cleanup = {
    coords: postCleanup.coords,
    passes: cleanupPass.passes,
    improvement: cleanupPass.improvement,
    overlapMoves: cleanupPass.overlapMoves,
    labelNudges: labelClearance.nudges,
    symmetrySnaps: symmetryTidy.snappedCount,
    junctionSnaps: symmetryTidy.junctionSnapCount,
    stereoReflections: stereoCleanup.reflections,
    postHookNudges: postCleanup.hookNudges
  };
  for (const [atomId, position] of cleanup.coords) {
    coords.set(atomId, position);
  }
  const ez = inspectEZStereo(layoutGraph, coords);
  const wedges = pickWedgeAssignments(layoutGraph, coords);
  const ringDependency = layoutGraph.rings.length > 0
    ? inspectRingDependency(molecule)
    : {
      ok: true,
      requiresDedicatedRingEngine: false,
      suspiciousSystemCount: 0,
      systems: [],
      rings: [],
      connections: []
    };
  const stereo = {
    ezCheckedBondCount: ez.checkedBondCount,
    ezResolvedBondCount: ez.resolvedBondCount,
    ezViolationCount: ez.violationCount,
    ezChecks: ez.checks,
    chiralCenterCount: wedges.chiralCenterCount,
    assignedCenterCount: wedges.assignedCenterCount,
    unassignedCenterCount: wedges.unassignedCenterCount,
    assignments: wedges.assignments,
    missingCenterIds: wedges.missingCenterIds
  };
  const audit = auditLayout(layoutGraph, coords, {
    bondLength: normalizedOptions.bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo
  });
  const qualityReport = createQualityReport({
    audit,
    cleanup,
    stereo,
    ringDependency,
    policy
  });
  const stage = placement.placedComponentCount === 0
    ? 'topology-ready'
    : placement.unplacedComponentCount === 0
      ? 'coordinates-ready'
      : 'partial-coordinates';

  return {
    molecule,
    coords,
    layoutGraph,
    metadata: {
      stage,
      profile,
      primaryFamily: familySummary.primaryFamily,
      mixedMode: familySummary.mixedMode,
      componentCount: layoutGraph.components.length,
      ringCount: layoutGraph.rings.length,
      ringSystemCount: layoutGraph.ringSystems.length,
      fixedAtomCount: normalizedOptions.fixedCoords.size,
      existingCoordCount: normalizedOptions.existingCoords.size,
      placedComponentCount: placement.placedComponentCount,
      unplacedComponentCount: placement.unplacedComponentCount,
      preservedComponentCount: placement.preservedComponentCount,
      placedFamilies: placement.placedFamilies,
      bondValidationClassCount: placement.bondValidationClasses.size,
      displayAssignmentCount: placement.displayAssignments.length,
      displayAssignments: placement.displayAssignments,
      policy,
      ringDependency,
      stereo,
      cleanupPasses: cleanup.passes,
      cleanupImprovement: cleanup.improvement,
      cleanupOverlapMoves: cleanup.overlapMoves,
      cleanupLabelNudges: cleanup.labelNudges,
      cleanupSymmetrySnaps: cleanup.symmetrySnaps,
      cleanupJunctionSnaps: cleanup.junctionSnaps,
      cleanupStereoReflections: cleanup.stereoReflections,
      cleanupPostHookNudges: cleanup.postHookNudges,
      audit,
      qualityReport
    }
  };
}
