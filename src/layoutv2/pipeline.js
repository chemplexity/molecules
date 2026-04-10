/** @module pipeline */

import { normalizeOptions } from './options.js';
import { resolveProfile } from './profile.js';
import { createLayoutGraph } from './model/layout-graph.js';
import { resolvePolicy } from './standards/profile-policy.js';
import { layoutSupportedComponents } from './placement/component-layout.js';
import { applyLabelClearance } from './cleanup/label-clearance.js';
import { runLocalCleanup } from './cleanup/local-rotation.js';
import { resolveOverlaps } from './cleanup/overlap-resolution.js';
import { tidySymmetry } from './cleanup/symmetry-tidy.js';
import { auditLayout } from './audit/audit.js';
import { createQualityReport } from './model/quality-report.js';
import { inspectEZStereo } from './stereo/ez.js';
import { enforceAcyclicEZStereo } from './stereo/enforcement.js';
import { pickWedgeAssignments } from './stereo/wedge-selection.js';
import { inspectRingDependency } from './topology/ring-dependency.js';
import { exceedsLargeMoleculeThreshold } from './topology/large-blocks.js';
import { findMacrocycleRings } from './topology/macrocycles.js';
import { buildScaffoldPlan } from './model/scaffold-plan.js';

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
  const layoutGraph = createLayoutGraph(molecule, normalizedOptions);
  const profile = resolveProfile(normalizedOptions.profile);
  const familySummary = classifyFamily(layoutGraph);
  const policy = resolvePolicy(profile, {
    ...layoutGraph.traits,
    ...familySummary
  });
  const coords = buildInitialCoordsMap(normalizedOptions);
  const placement = layoutSupportedComponents(layoutGraph, policy);
  const overlapResolution = placement.placedComponentCount > 0
    ? resolveOverlaps(layoutGraph, placement.coords, {
      bondLength: normalizedOptions.bondLength
    })
    : { coords: placement.coords, moves: 0 };
  const cleanupPass = placement.placedComponentCount > 0
    ? runLocalCleanup(layoutGraph, overlapResolution.coords, {
      maxPasses: normalizedOptions.maxCleanupPasses,
      bondLength: normalizedOptions.bondLength
    })
    : { coords: overlapResolution.coords, passes: 0, improvement: 0 };
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
  const cleanup = {
    coords: stereoCleanup.coords,
    passes: cleanupPass.passes,
    improvement: cleanupPass.improvement,
    overlapMoves: overlapResolution.moves,
    labelNudges: labelClearance.nudges,
    symmetrySnaps: symmetryTidy.snappedCount,
    junctionSnaps: symmetryTidy.junctionSnapCount,
    stereoReflections: stereoCleanup.reflections
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
      audit,
      qualityReport
    }
  };
}
