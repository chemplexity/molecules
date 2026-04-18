/** @module pipeline */

import { normalizeOptions } from './options.js';
import { resolveProfile } from './profile.js';
import { createLayoutGraphFromNormalized } from './model/layout-graph.js';
import { resolvePolicy } from './standards/profile-policy.js';
import { layoutSupportedComponents } from './placement/component-layout.js';
import { applyLabelClearance } from './cleanup/label-clearance.js';
import { runBridgedBondTidy } from './cleanup/bridged-bond-tidy.js';
import { measureOrthogonalHypervalentDeviation, runHypervalentAngleTidy } from './cleanup/hypervalent-angle-tidy.js';
import { runLigandAngleTidy } from './cleanup/ligand-angle-tidy.js';
import { runLocalCleanup } from './cleanup/local-rotation.js';
import { runRingPerimeterCorrection } from './cleanup/ring-perimeter-correction.js';
import { measureRingSubstituentPresentationPenalty, runRingSubstituentTidy } from './cleanup/ring-substituent-tidy.js';
import { runRingTerminalHeteroTidy } from './cleanup/ring-terminal-hetero-tidy.js';
import { collectCutSubtree } from './cleanup/subtree-utils.js';
import { tidySymmetry } from './cleanup/symmetry-tidy.js';
import { runUnifiedCleanup } from './cleanup/unified-cleanup.js';
import { auditLayout } from './audit/audit.js';
import { findSevereOverlaps, measureLayoutCost } from './audit/invariants.js';
import { createQualityReport } from './model/quality-report.js';
import { collectProtectedEZAtomIds, inspectEZStereo } from './stereo/ez.js';
import { enforceAcyclicEZStereo } from './stereo/enforcement.js';
import { pickWedgeAssignments } from './stereo/wedge-selection.js';
import { inspectRingDependency } from './topology/ring-dependency.js';
import { exceedsLargeComponentThreshold, exceedsLargeMoleculeThreshold } from './topology/large-blocks.js';
import { findMacrocycleRings } from './topology/macrocycles.js';
import { buildScaffoldPlan } from './model/scaffold-plan.js';
import { packComponentPlacements } from './placement/fragment-packing.js';
import { measureSmallRingExteriorGapSpreadPenalty } from './placement/branch-placement.js';
import { PROTECTED_CLEANUP_STAGE_LIMITS } from './constants.js';
import { add, rotate, sub } from './geometry/vec2.js';
import { levelCoords, normalizeOrientation } from './orientation.js';

const ATTACHED_RING_ROTATION_TIDY_ANGLES = [
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
];

/**
 * Returns the current high-resolution time when available, with a Date fallback
 * for runtimes that do not expose the Performance API.
 * @returns {number} Current time in milliseconds.
 */
function nowMs() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function getSmallRingExteriorPenaltyAtomIds(layoutGraph) {
  if (!layoutGraph) {
    return [];
  }
  if (Array.isArray(layoutGraph._smallRingExteriorPenaltyAtomIds)) {
    return layoutGraph._smallRingExteriorPenaltyAtomIds;
  }

  const atomIds = [];
  for (const [atomId, atom] of layoutGraph.atoms ?? []) {
    if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4) {
      continue;
    }
    const anchorRings = layoutGraph.atomToRings.get(atomId) ?? [];
    if (anchorRings.length !== 1) {
      continue;
    }
    const ringSize = anchorRings[0]?.atomIds?.length ?? 0;
    if (ringSize < 3 || ringSize > 4) {
      continue;
    }
    atomIds.push(atomId);
  }
  layoutGraph._smallRingExteriorPenaltyAtomIds = atomIds;
  return atomIds;
}

function expandFocusAtomIds(layoutGraph, atomIds, depth = 1) {
  const expandedAtomIds = new Set(atomIds);
  let frontierAtomIds = new Set(atomIds);

  for (let level = 0; level < depth; level++) {
    const nextFrontierAtomIds = new Set();
    for (const atomId of frontierAtomIds) {
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (expandedAtomIds.has(neighborAtomId)) {
          continue;
        }
        expandedAtomIds.add(neighborAtomId);
        nextFrontierAtomIds.add(neighborAtomId);
      }
    }
    frontierAtomIds = nextFrontierAtomIds;
    if (frontierAtomIds.size === 0) {
      break;
    }
  }

  return expandedAtomIds;
}

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
    ezSupportedBondCount: 0,
    ezUnsupportedBondCount: 0,
    ezResolvedBondCount: 0,
    ezViolationCount: 0,
    ezChecks: [],
    annotatedCenterCount: 0,
    chiralCenterCount: 0,
    assignedCenterCount: 0,
    unassignedCenterCount: 0,
    assignments: [],
    missingCenterIds: [],
    unsupportedCenterCount: 0,
    unsupportedCenterIds: []
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
    minSevereOverlapDistance: null,
    worstOverlapDeficit: 0,
    severeOverlapPenalty: 0,
    labelOverlapCount: 0,
    maxBondLengthDeviation: 0,
    meanBondLengthDeviation: 0,
    bondLengthFailureCount: 0,
    mildBondLengthFailureCount: 0,
    severeBondLengthFailureCount: 0,
    bondLengthSampleCount: 0,
    collapsedMacrocycleCount: 0,
    stereoContradiction: false,
    bridgedReadabilityFailure: false,
    ringSubstituentReadabilityFailureCount: 0,
    inwardRingSubstituentCount: 0,
    outwardAxisRingSubstituentFailureCount: 0,
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
      ...(normalizedOptions.auditTelemetry
        ? {
            placementFamily: null,
            placementMode: null,
            placementModes: [],
            componentPlacements: [],
            placementAudit: null,
            stageTelemetry: {
              selectedGeometryStage: null,
              selectedStage: null,
              firstDirtyStage: null,
              finalDirtyStage: null,
              stageAudits: {}
            }
          }
        : {}),
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

function selectPrimaryPlacement(componentPlacements = []) {
  return componentPlacements.find(detail => detail.role === 'principal' && detail.placed && !detail.preserved)
    ?? componentPlacements.find(detail => detail.placed && !detail.preserved)
    ?? componentPlacements.find(detail => detail.placed)
    ?? componentPlacements[0]
    ?? null;
}

function buildPlacementTelemetry(placement) {
  const componentPlacements = placement.componentPlacements ?? [];
  const primaryPlacement = selectPrimaryPlacement(componentPlacements);
  return {
    placementFamily: primaryPlacement?.family ?? null,
    placementMode: primaryPlacement?.placementMode ?? null,
    placementModes: [...new Set(componentPlacements.map(detail => detail.placementMode).filter(Boolean))],
    componentPlacements
  };
}

function buildStageTelemetry(stageEntries, selectedGeometryStage, selectedStage) {
  const stageAudits = Object.fromEntries(stageEntries.map(entry => [entry.name, entry.audit]));
  const firstDirtyStage = stageEntries.find(entry => entry.audit?.ok === false)?.name ?? null;
  return {
    selectedGeometryStage,
    selectedStage,
    firstDirtyStage,
    finalDirtyStage: stageAudits[selectedStage]?.ok === false ? selectedStage : null,
    stageAudits
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

function repackFinalDisconnectedComponents(layoutGraph, coords, placement, policy, bondLength) {
  if ((layoutGraph.components?.length ?? 0) <= 1) {
    return coords;
  }

  const placementDetailsById = new Map((placement.componentPlacements ?? []).map(detail => [detail.componentId, detail]));
  const componentPlacements = [];
  for (const component of layoutGraph.components ?? []) {
    const atomIds = component.atomIds.filter(atomId => coords.has(atomId));
    if (atomIds.length === 0) {
      continue;
    }
    const detail = placementDetailsById.get(component.id) ?? null;
    componentPlacements.push({
      componentId: component.id,
      atomIds,
      coords: new Map(atomIds.map(atomId => [atomId, { ...coords.get(atomId) }])),
      anchored: detail?.anchored === true,
      role: component.role,
      heavyAtomCount: component.heavyAtomCount ?? detail?.heavyAtomCount ?? 0,
      netCharge: component.netCharge ?? 0,
      containsMetal: detail?.containsMetal === true
    });
  }

  if (componentPlacements.length <= 1) {
    return coords;
  }

  return packComponentPlacements(componentPlacements, bondLength, {
    ...policy,
    fragmentPackingMode: 'principal-right'
  });
}

function isRingJunctionStereoAssignment(layoutGraph, assignment) {
  const molecule = layoutGraph?.sourceMolecule ?? null;
  const bond = layoutGraph?.bonds.get(assignment?.bondId) ?? null;
  const centerId = assignment?.centerId ?? null;
  if (!molecule || !bond || !centerId) {
    return false;
  }

  const otherAtomId = bond.a === centerId ? bond.b : (bond.b === centerId ? bond.a : null);
  if (!otherAtomId || layoutGraph.atoms.get(otherAtomId)?.element === 'H') {
    return false;
  }

  const centerAtom = molecule.atoms.get(centerId);
  if (!centerAtom) {
    return false;
  }

  const ringNeighborCount = centerAtom
    .getNeighbors(molecule)
    .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && (layoutGraph.atomToRings.get(neighborAtom.id)?.length ?? 0) > 0)
    .length;
  return ringNeighborCount >= 3;
}

/**
 * Returns whether the pipeline should auto-orient the final generated pose.
 * Existing or fixed coordinates preserve the user's frame, so only fresh
 * stereochemical ring-junction layouts get the whole-molecule orientation
 * pass. This avoids rotating ordinary side-chain stereocenters away from the
 * canonical heterocycle and zigzag orientations they already had before the
 * ring-junction display pass was added.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} normalizedOptions - Normalized pipeline options.
 * @returns {boolean} True when the final coordinates should be auto-oriented.
 */
function shouldAutoOrientFinalCoords(layoutGraph, coords, normalizedOptions) {
  if (normalizedOptions.fixedCoords.size > 0 || normalizedOptions.existingCoords.size > 0) {
    return false;
  }
  const molecule = layoutGraph?.sourceMolecule ?? null;
  if (!(typeof molecule?.getChiralCenters === 'function' && molecule.getChiralCenters().length > 0)) {
    return false;
  }
  return pickWedgeAssignments(layoutGraph, coords).assignments.some(assignment => isRingJunctionStereoAssignment(layoutGraph, assignment));
}

/**
 * Applies the final display-orientation pass to generated coordinates.
 * This is a whole-molecule rotation only, so it preserves local geometry while
 * improving page orientation for visible stereobonds.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} molecule - Molecule-like graph.
 * @returns {Map<string, {x: number, y: number}>} Oriented coordinate map.
 */
function orientFinalCoords(inputCoords, molecule) {
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  normalizeOrientation(coords, molecule);
  levelCoords(coords, molecule);
  return coords;
}

/**
 * Returns a timing accumulator when enabled.
 * @param {boolean} enabled - Whether timing should be recorded.
 * @returns {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} Timing accumulator.
 */
function createTimingState(enabled) {
  if (!enabled) {
    return null;
  }
  return {
    enabled: true,
    startTime: nowMs(),
    placementMs: 0,
    cleanupMs: 0,
    labelClearanceMs: 0,
    stereoMs: 0,
    auditMs: 0
  };
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
    [
      'ring-perimeter-correction',
      coords =>
        runRingPerimeterCorrection(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'bridged-bond-tidy',
      coords =>
        runBridgedBondTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'hypervalent-angle-tidy',
      coords =>
        runHypervalentAngleTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'ligand-angle-tidy',
      coords =>
        runLigandAngleTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'ring-substituent-tidy',
      coords =>
        runRingSubstituentTidy(layoutGraph, coords, {
          bondLength: options.bondLength,
          frozenAtomIds: options.frozenAtomIds
        })
    ],
    [
      'ring-terminal-hetero-tidy',
      coords =>
        runRingTerminalHeteroTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ]
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

const CLEANUP_BOND_PROTECTED_PRIMARY_FAMILIES = new Set(['large-molecule', 'macrocycle', 'bridged', 'fused', 'organometallic']);

/**
 * Returns whether cleanup should preserve bond integrity more aggressively for
 * the current layout family.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} placement - Placement result.
 * @returns {boolean} True when cleanup should prefer pre-cleanup geometry over new bond failures.
 */
function shouldProtectCleanupBondIntegrity(familySummary, placement) {
  return placement.placedFamilies.includes('large-molecule') || CLEANUP_BOND_PROTECTED_PRIMARY_FAMILIES.has(familySummary.primaryFamily);
}

/**
 * Audits one cleanup-stage coordinate snapshot against geometry-only checks.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {object} placement - Placement result.
 * @param {number} bondLength - Target bond length.
 * @returns {object} Geometry audit summary.
 */
function auditCleanupStage(layoutGraph, coords, placement, bondLength) {
  return auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
}

/**
 * Measures the total small-ring exterior-gap presentation penalty across the
 * current coordinate map.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {Set<string>|null} [focusAtomIds] - Optional local scoring focus.
 * @returns {number} Total small-ring exterior-gap penalty.
 */
function measureTotalSmallRingExteriorGapPenalty(layoutGraph, coords, focusAtomIds = null) {
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  let penalty = 0;
  for (const atomId of getSmallRingExteriorPenaltyAtomIds(layoutGraph)) {
    if (!coords.has(atomId) || (focusSet && !focusSet.has(atomId))) {
      continue;
    }
    penalty += measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, atomId);
  }
  return penalty;
}

/**
 * Measures a presentation-only tie-breaker for cleanup stages whose audit
 * outcomes are otherwise identical.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {{focusAtomIds?: Set<string>|null, includeSmallRingExteriorPenalty?: boolean}} [options] - Optional local scoring focus.
 * @returns {number} Ring-substituent plus hypervalent-angle presentation penalty.
 */
function measureCleanupStagePresentationPenalty(layoutGraph, coords, options = {}) {
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  const includeSmallRingExteriorPenalty = options.includeSmallRingExteriorPenalty !== false;
  return (
    measureRingSubstituentPresentationPenalty(layoutGraph, coords, { focusAtomIds })
    + measureOrthogonalHypervalentDeviation(layoutGraph, coords, { focusAtomIds })
    + (includeSmallRingExteriorPenalty ? measureTotalSmallRingExteriorGapPenalty(layoutGraph, coords, focusAtomIds) : 0)
  );
}

function rigidDescriptorKey(descriptor) {
  return `${descriptor.anchorAtomId}|${descriptor.rootAtomId}|${descriptor.subtreeAtomIds.join(',')}`;
}

/**
 * Collects the movable singly attached ring-containing subtrees that can be
 * rotated late around their exocyclic attachment bonds to improve local
 * presentation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>|null} [frozenAtomIds] - Atoms that cleanup must not move.
 * @returns {Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>} Unique movable descriptors.
 */
function collectMovableAttachedRingDescriptors(layoutGraph, coords, frozenAtomIds = null) {
  const uniqueDescriptors = new Map();
  const ringAtomIds = new Set();
  for (const ring of layoutGraph.rings ?? []) { for (const atomId of ring.atomIds) { ringAtomIds.add(atomId); } }

  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }

    for (const [anchorAtomId, rootAtomId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
      if (subtreeAtomIds.length === 0 || subtreeAtomIds.length >= coords.size) {
        continue;
      }
      const heavyAtomCount = subtreeAtomIds.reduce(
        (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
        0
      );
      if (
        heavyAtomCount === 0
        || heavyAtomCount > 18
        || !subtreeAtomIds.some(atomId => ringAtomIds.has(atomId))
        || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))
        || (frozenAtomIds && subtreeAtomIds.some(atomId => frozenAtomIds.has(atomId)))
      ) {
        continue;
      }

      const descriptor = {
        anchorAtomId,
        rootAtomId,
        subtreeAtomIds
      };
      uniqueDescriptors.set(rigidDescriptorKey(descriptor), descriptor);
    }
  }
  return [...uniqueDescriptors.values()];
}

/**
 * Rotates a rigid attached ring subtree around its exocyclic attachment bond.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}} descriptor - Rigid subtree descriptor.
 * @param {number} rotation - Rotation delta in radians.
 * @returns {Map<string, {x: number, y: number}>|null} Rotated coordinates, or null when unavailable.
 */
function buildAttachedRingRotationCandidate(inputCoords, descriptor, rotation) {
  const anchorPosition = inputCoords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const rotatedCoords = new Map();
  for (const [atomId, position] of inputCoords) { rotatedCoords.set(atomId, { x: position.x, y: position.y }); }
  for (const atomId of descriptor.subtreeAtomIds) {
    const position = inputCoords.get(atomId);
    if (!position) {
      continue;
    }
    rotatedCoords.set(atomId, add(anchorPosition, rotate(sub(position, anchorPosition), rotation)));
  }
  return rotatedCoords;
}

/**
 * Rotates singly attached ring blocks around their exocyclic attachment bonds
 * when doing so lowers the final presentation penalty without introducing new
 * severe overlaps. Each rigid rotation is immediately followed by
 * `ring-substituent-tidy` so exact carbonyl and imine leaves can snap into the
 * space opened by the ring-block move.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Touchup options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Set<string>|null} [options.frozenAtomIds] - Atoms that cleanup must not move.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Touchup result.
 */
function runAttachedRingRotationTouchup(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > 60) {
    return { coords: inputCoords, nudges: 0 };
  }

  const descriptors = collectMovableAttachedRingDescriptors(layoutGraph, inputCoords, frozenAtomIds);
  if (descriptors.length === 0) {
    return { coords: inputCoords, nudges: 0 };
  }

  const baseOverlapCount = findSevereOverlaps(layoutGraph, inputCoords, bondLength).length;
  let bestCandidate = null;

  for (const descriptor of descriptors) {
    const focusAtomIds = expandFocusAtomIds(
      layoutGraph,
      new Set([descriptor.anchorAtomId, descriptor.rootAtomId, ...descriptor.subtreeAtomIds])
    );
    const basePresentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, inputCoords, {
      focusAtomIds,
      includeSmallRingExteriorPenalty: false
    });
    const baseSmallRingExteriorPenalty = measureTotalSmallRingExteriorGapPenalty(layoutGraph, inputCoords, focusAtomIds);
    for (const rotation of ATTACHED_RING_ROTATION_TIDY_ANGLES) {
      if (Math.abs(rotation) <= 1e-9) {
        continue;
      }
      const rotatedCoords = buildAttachedRingRotationCandidate(inputCoords, descriptor, rotation);
      if (!rotatedCoords) {
        continue;
      }
      const ringSubstituentTouchup = runRingSubstituentTidy(layoutGraph, rotatedCoords, {
        bondLength,
        frozenAtomIds,
        focusAtomIds
      });
      const localLeafTouchup = runLocalCleanup(layoutGraph, ringSubstituentTouchup.coords, {
        maxPasses: 2,
        epsilon: bondLength * 0.001,
        bondLength,
        frozenAtomIds,
        focusAtomIds
      });
      const candidateCoords = localLeafTouchup.coords;
      const overlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
      if (overlapCount > baseOverlapCount) {
        continue;
      }
      const smallRingExteriorPenalty = measureTotalSmallRingExteriorGapPenalty(layoutGraph, candidateCoords, focusAtomIds);
      if (smallRingExteriorPenalty > baseSmallRingExteriorPenalty + 1e-6) {
        continue;
      }
      const presentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, candidateCoords, {
        focusAtomIds,
        includeSmallRingExteriorPenalty: false
      });
      if (presentationPenalty >= basePresentationPenalty - 1e-6) {
        continue;
      }
      const presentationImprovement = basePresentationPenalty - presentationPenalty;
      const layoutCost = measureLayoutCost(layoutGraph, candidateCoords, bondLength);
      if (
        !bestCandidate
        || overlapCount < bestCandidate.overlapCount
        || (
          overlapCount === bestCandidate.overlapCount
          && presentationImprovement > bestCandidate.presentationImprovement + 1e-6
        )
        || (
          overlapCount === bestCandidate.overlapCount
          && Math.abs(presentationImprovement - bestCandidate.presentationImprovement) <= 1e-6
          && layoutCost < bestCandidate.layoutCost - 1e-6
        )
      ) {
        bestCandidate = {
          coords: candidateCoords,
          nudges: ringSubstituentTouchup.nudges + localLeafTouchup.passes + 1,
          overlapCount,
          presentationImprovement,
          layoutCost
        };
      }
    }
  }

  return bestCandidate
    ? {
        coords: bestCandidate.coords,
        nudges: bestCandidate.nudges
      }
    : { coords: inputCoords, nudges: 0 };
}

/**
 * Audits a late cleanup/stereo candidate against full geometry + stereo checks.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {object} placement - Placement result.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, stereo: object, audit: object}} Full stage audit payload.
 */
function auditFinalStereoStage(molecule, layoutGraph, coords, placement, bondLength) {
  const { stereo } = runStereoPhase(molecule, layoutGraph, coords);
  const audit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo
  });
  return {
    coords,
    stereo,
    audit,
    presentationPenalty: measureCleanupStagePresentationPenalty(layoutGraph, coords)
  };
}

/**
 * Returns whether one final stereo/touchup candidate should replace another.
 * @param {{coords: Map<string, {x: number, y: number}>, stereo: object, audit: object}} candidate - Candidate stage.
 * @param {{coords: Map<string, {x: number, y: number}>, stereo: object, audit: object}|null} incumbent - Current best stage.
 * @param {{allowPresentationTieBreak?: boolean}} [options] - Optional comparison toggles.
 * @returns {boolean} True when the candidate is safer overall.
 */
function isPreferredFinalStereoStage(candidate, incumbent, options = {}) {
  const allowPresentationTieBreak = options.allowPresentationTieBreak === true;
  if (!incumbent) {
    return true;
  }
  if (incumbent.audit.bondLengthFailureCount === 0 && candidate.audit.bondLengthFailureCount > 0) {
    return false;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok;
  }
  if (candidate.audit.stereoContradiction !== incumbent.audit.stereoContradiction) {
    return incumbent.audit.stereoContradiction;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount < incumbent.audit.bondLengthFailureCount;
  }
  if (Math.abs(candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation) > 1e-9) {
    return candidate.audit.maxBondLengthDeviation < incumbent.audit.maxBondLengthDeviation;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount < incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (candidate.audit.inwardRingSubstituentCount !== incumbent.audit.inwardRingSubstituentCount) {
    return candidate.audit.inwardRingSubstituentCount < incumbent.audit.inwardRingSubstituentCount;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount < incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.labelOverlapCount !== incumbent.audit.labelOverlapCount) {
    return candidate.audit.labelOverlapCount < incumbent.audit.labelOverlapCount;
  }
  if (allowPresentationTieBreak && Math.abs((candidate.presentationPenalty ?? 0) - (incumbent.presentationPenalty ?? 0)) > 1e-9) {
    return (candidate.presentationPenalty ?? 0) < (incumbent.presentationPenalty ?? 0);
  }
  return false;
}

/**
 * Merges the base frozen-atom set with an optional extra set used for a
 * narrower cleanup probe. Returns null when no freezing is needed.
 * @param {Set<string>|null|undefined} baseFrozenAtomIds - Existing frozen atoms.
 * @param {Set<string>|null|undefined} extraFrozenAtomIds - Additional frozen atoms.
 * @returns {Set<string>|null} Merged frozen atom ids, or null when empty.
 */
function mergeFrozenAtomIds(baseFrozenAtomIds, extraFrozenAtomIds) {
  const merged = new Set(baseFrozenAtomIds ?? []);
  for (const atomId of extraFrozenAtomIds ?? []) {
    merged.add(atomId);
  }
  return merged.size > 0 ? merged : null;
}

/**
 * Returns whether a mixed fused cleanup candidate should beat the protected
 * incumbent by removing all severe overlaps without introducing any new audit
 * failures and while staying within a modest bond-drift window.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}} candidate - Candidate stage.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}} incumbent - Current best stage.
 * @returns {boolean} True when the overlap-clean fused mixed candidate is safe to prefer.
 */
function shouldPreferFusedMixedOverlapCleanupStage(familySummary, candidate, incumbent) {
  if (familySummary.primaryFamily !== 'fused' || familySummary.mixedMode === false) {
    return false;
  }
  if (incumbent.audit.severeOverlapCount === 0 || candidate.audit.severeOverlapCount !== 0) {
    return false;
  }
  if (candidate.audit.ok !== true || candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return false;
  }
  if (candidate.audit.labelOverlapCount > incumbent.audit.labelOverlapCount) {
    return false;
  }
  return (
    candidate.audit.maxBondLengthDeviation <= PROTECTED_CLEANUP_STAGE_LIMITS.maxFusedMixedBondDeviationForOverlapWin
    && candidate.audit.meanBondLengthDeviation <= PROTECTED_CLEANUP_STAGE_LIMITS.maxFusedMixedMeanDeviationForOverlapWin
  );
}

/**
 * Returns whether a cleanup candidate should beat the incumbent by removing
 * severe overlaps without adding any new outward-axis ring-substituent misses.
 * A small inward-only readability tradeoff is still visible, but protected
 * families should not keep a clearly dirtier overlap state just to avoid that.
 * @param {{audit: object}} candidate - Candidate stage.
 * @param {{audit: object}} incumbent - Current best stage.
 * @returns {boolean} True when the overlap win is worth preferring.
 */
function shouldPreferOverlapWinOverAddedInwardReadability(candidate, incumbent) {
  if (!incumbent || candidate.audit.severeOverlapCount >= incumbent.audit.severeOverlapCount) {
    return false;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return false;
  }
  if (candidate.audit.maxBondLengthDeviation > incumbent.audit.maxBondLengthDeviation + 1e-9) {
    return false;
  }
  if (candidate.audit.outwardAxisRingSubstituentFailureCount !== incumbent.audit.outwardAxisRingSubstituentFailureCount) {
    return false;
  }
  if (candidate.audit.labelOverlapCount > incumbent.audit.labelOverlapCount) {
    return false;
  }
  return candidate.audit.inwardRingSubstituentCount <= incumbent.audit.inwardRingSubstituentCount + 1;
}

/**
 * Returns whether one cleanup-stage candidate should replace the current
 * protected-family incumbent. Bond integrity and macrocycle stability outrank
 * overlap reduction in this comparison, except when a mixed fused candidate
 * cleanly removes severe overlaps without adding bond failures or excessive
 * overall drift.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} placement - Placement result.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}} candidate - Candidate stage.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}|null} incumbent - Current best stage.
 * @returns {boolean} True when the candidate is safer and should be selected.
 */
function isPreferredProtectedCleanupStage(familySummary, placement, candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.audit.collapsedMacrocycleCount !== incumbent.audit.collapsedMacrocycleCount) {
    return candidate.audit.collapsedMacrocycleCount < incumbent.audit.collapsedMacrocycleCount;
  }
  if (incumbent.audit.bondLengthFailureCount === 0 && candidate.audit.bondLengthFailureCount > 0) {
    return false;
  }
  const bondDeviationIncrease = candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation;
  const overlapReduction = incumbent.audit.severeOverlapCount - candidate.audit.severeOverlapCount;
  const bondFailureIncrease = candidate.audit.bondLengthFailureCount - incumbent.audit.bondLengthFailureCount;
  if (
    familySummary.primaryFamily === 'bridged'
    && familySummary.mixedMode === false
    && placement.placedFamilies.every(family => family === 'bridged')
    && overlapReduction > 0
    && bondFailureIncrease > 0
    && bondFailureIncrease <= PROTECTED_CLEANUP_STAGE_LIMITS.maxBondFailureIncreaseForOverlapWin
    && bondDeviationIncrease <= PROTECTED_CLEANUP_STAGE_LIMITS.maxBondDeviationIncrease
  ) {
    return true;
  }
  if (shouldPreferFusedMixedOverlapCleanupStage(familySummary, candidate, incumbent)) {
    return true;
  }
  if (shouldPreferOverlapWinOverAddedInwardReadability(candidate, incumbent)) {
    return true;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount < incumbent.audit.bondLengthFailureCount;
  }
  if (Math.abs(bondDeviationIncrease) > 1e-9) {
    return candidate.audit.maxBondLengthDeviation < incumbent.audit.maxBondLengthDeviation;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount < incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (candidate.audit.inwardRingSubstituentCount !== incumbent.audit.inwardRingSubstituentCount) {
    return candidate.audit.inwardRingSubstituentCount < incumbent.audit.inwardRingSubstituentCount;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount < incumbent.audit.severeOverlapCount;
  }
  return false;
}

/**
 * Returns whether one generic cleanup-stage candidate should replace another.
 * This keeps the safest geometry-oriented stage instead of blindly trusting the
 * latest cleanup pass when later hooks or one-pass touchups make the result
 * worse.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}} candidate - Candidate stage.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}|null} incumbent - Current best stage.
 * @returns {boolean} True when the candidate is safer overall.
 */
function isPreferredCleanupGeometryStage(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok;
  }
  if (candidate.audit.collapsedMacrocycleCount !== incumbent.audit.collapsedMacrocycleCount) {
    return candidate.audit.collapsedMacrocycleCount < incumbent.audit.collapsedMacrocycleCount;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount < incumbent.audit.bondLengthFailureCount;
  }
  if (Math.abs(candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation) > 1e-9) {
    return candidate.audit.maxBondLengthDeviation < incumbent.audit.maxBondLengthDeviation;
  }
  if (shouldPreferOverlapWinOverAddedInwardReadability(candidate, incumbent)) {
    return true;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount < incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (candidate.audit.inwardRingSubstituentCount !== incumbent.audit.inwardRingSubstituentCount) {
    return candidate.audit.inwardRingSubstituentCount < incumbent.audit.inwardRingSubstituentCount;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount < incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.labelOverlapCount !== incumbent.audit.labelOverlapCount) {
    return candidate.audit.labelOverlapCount < incumbent.audit.labelOverlapCount;
  }
  return false;
}

/**
 * Runs the cleanup-oriented pipeline stages after initial component placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} placement - Placement result.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} policy - Resolved policy bundle.
 * @param {object} normalizedOptions - Normalized pipeline options.
 * @param {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} [timingState] - Optional timing accumulator.
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number, overlapMoves: number, labelNudges: number, symmetrySnaps: number, junctionSnaps: number, stereoReflections: number, postHookNudges: number, placementAudit?: object|null, stageTelemetry?: object|null}} Cleanup summary.
 */
function runCleanupPhase(layoutGraph, placement, familySummary, policy, normalizedOptions, timingState = null) {
  const includeStageTelemetry = normalizedOptions.auditTelemetry === true;
  if (placement.placedComponentCount === 0) {
    return {
      coords: placement.coords,
      passes: 0,
      improvement: 0,
      overlapMoves: 0,
      labelNudges: 0,
      symmetrySnaps: 0,
      junctionSnaps: 0,
      stereoReflections: 0,
      postHookNudges: 0,
      ...(includeStageTelemetry
        ? {
            placementAudit: null,
            stageTelemetry: buildStageTelemetry([], null, null)
          }
        : {})
    };
  }

  const cleanupStart = timingState ? nowMs() : 0;
  const protectBondIntegrity = shouldProtectCleanupBondIntegrity(familySummary, placement);
  const shouldAuditStages = true;
  const cleanupMaxPasses =
    placement.placedFamilies.every(family => family === 'large-molecule')
      ? Math.min(normalizedOptions.maxCleanupPasses, 3)
      : normalizedOptions.maxCleanupPasses;
  const cleanupPass = runUnifiedCleanup(layoutGraph, placement.coords, {
    maxPasses: cleanupMaxPasses,
    epsilon: normalizedOptions.bondLength * 0.001,
    bondLength: normalizedOptions.bondLength,
    protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
    protectBondIntegrity,
    cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
    frozenAtomIds: placement.frozenAtomIds
  });
  const labelClearanceStart = timingState ? nowMs() : 0;
  const labelClearance = applyLabelClearance(layoutGraph, cleanupPass.coords, {
    bondLength: normalizedOptions.bondLength,
    labelMetrics: normalizedOptions.labelMetrics
  });
  if (timingState) {
    timingState.labelClearanceMs = nowMs() - labelClearanceStart;
  }
  const symmetryTidy = tidySymmetry(labelClearance.coords, {
    epsilon: normalizedOptions.bondLength * 0.01,
    layoutGraph
  });
  const stereoCleanup = enforceAcyclicEZStereo(layoutGraph, symmetryTidy.coords, {
    bondLength: normalizedOptions.bondLength
  });
  const postCleanup = runPostCleanupHooks(layoutGraph, stereoCleanup.coords, policy, {
    bondLength: normalizedOptions.bondLength,
    frozenAtomIds: placement.frozenAtomIds
  });
  const postHookCleanup =
    postCleanup.hookNudges > 0
      ? runUnifiedCleanup(layoutGraph, postCleanup.coords, {
          maxPasses: 1,
          epsilon: normalizedOptions.bondLength * 0.001,
          bondLength: normalizedOptions.bondLength,
          protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
          protectBondIntegrity,
          cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
          frozenAtomIds: placement.frozenAtomIds
        })
        : {
          coords: postCleanup.coords,
          passes: 0,
          improvement: 0,
          overlapMoves: 0
        };

  const stageEntries = [];
  const placementStage = {
    name: 'placement',
    coords: placement.coords,
    audit: shouldAuditStages ? auditCleanupStage(layoutGraph, placement.coords, placement, normalizedOptions.bondLength) : null
  };
  const cleanupStage = {
    name: 'cleanup',
    coords: cleanupPass.coords,
    audit: shouldAuditStages ? auditCleanupStage(layoutGraph, cleanupPass.coords, placement, normalizedOptions.bondLength) : null
  };
  const postHookCleanupStage = {
    name: 'postHookCleanup',
    coords: postHookCleanup.coords,
    audit: shouldAuditStages ? auditCleanupStage(layoutGraph, postHookCleanup.coords, placement, normalizedOptions.bondLength) : null
  };
  const postCleanupStage = {
    name: 'postCleanup',
    coords: postCleanup.coords,
    audit: shouldAuditStages ? auditCleanupStage(layoutGraph, postCleanup.coords, placement, normalizedOptions.bondLength) : null
  };
  if (placementStage.audit) {
    stageEntries.push({ name: placementStage.name, audit: placementStage.audit });
  }
  if (cleanupStage.audit) {
    stageEntries.push({ name: cleanupStage.name, audit: cleanupStage.audit });
  }
  if (postCleanupStage.audit) {
    stageEntries.push({ name: postCleanupStage.name, audit: postCleanupStage.audit });
  }
  if (postHookCleanupStage.audit) {
    stageEntries.push({ name: postHookCleanupStage.name, audit: postHookCleanupStage.audit });
  }

  let coords = postHookCleanup.coords;
  let selectedGeometryStage = postHookCleanupStage.name;
  let preferredStage = placementStage;
  const stageComparator = protectBondIntegrity
    ? (candidate, incumbent) => isPreferredProtectedCleanupStage(familySummary, placement, candidate, incumbent)
    : isPreferredCleanupGeometryStage;
  for (const candidateStage of [cleanupStage, postCleanupStage, postHookCleanupStage]) {
    if (stageComparator(candidateStage, preferredStage)) {
      preferredStage = candidateStage;
    }
  }
  coords = preferredStage.coords;
  selectedGeometryStage = preferredStage.name;
  const selectedGeometryStereoStage = {
    name: 'selectedGeometryStereo',
    ...auditFinalStereoStage(layoutGraph.sourceMolecule, layoutGraph, coords, placement, normalizedOptions.bondLength)
  };
  stageEntries.push({ name: selectedGeometryStereoStage.name, audit: selectedGeometryStereoStage.audit });
  const finalStereoCleanup = enforceAcyclicEZStereo(layoutGraph, coords, {
    bondLength: normalizedOptions.bondLength
  });
  const stereoCleanupStage = {
    name: 'stereoCleanup',
    ...auditFinalStereoStage(layoutGraph.sourceMolecule, layoutGraph, finalStereoCleanup.coords, placement, normalizedOptions.bondLength)
  };
  stageEntries.push({ name: stereoCleanupStage.name, audit: stereoCleanupStage.audit });
  let finalStereoStage = selectedGeometryStereoStage;
  if (isPreferredFinalStereoStage(stereoCleanupStage, finalStereoStage)) {
    finalStereoStage = stereoCleanupStage;
  }
  const totalStereoRescueCount = stereoCleanup.reflections + finalStereoCleanup.reflections;
  const stereoProtectedTouchupFrozenAtomIds = mergeFrozenAtomIds(
    placement.frozenAtomIds,
    collectProtectedEZAtomIds(layoutGraph)
  );
  let stereoProtectedTouchupCleanup = {
    coords: finalStereoCleanup.coords,
    passes: 0,
    improvement: 0,
    overlapMoves: 0
  };
  let stereoTouchupCleanup = {
    coords: finalStereoCleanup.coords,
    passes: 0,
    improvement: 0,
    overlapMoves: 0
  };
  let postTouchupStereoCleanup = {
    coords: finalStereoCleanup.coords,
    reflections: 0
  };
  if (
    totalStereoRescueCount > 0
    && finalStereoStage.audit.stereoContradiction === false
    && finalStereoStage.audit.bondLengthFailureCount === 0
    && finalStereoStage.audit.severeOverlapCount > 0
  ) {
    if (stereoProtectedTouchupFrozenAtomIds) {
      stereoProtectedTouchupCleanup = runUnifiedCleanup(layoutGraph, finalStereoCleanup.coords, {
        maxPasses: 1,
        epsilon: normalizedOptions.bondLength * 0.001,
        bondLength: normalizedOptions.bondLength,
        protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
        protectBondIntegrity: true,
        cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
        frozenAtomIds: stereoProtectedTouchupFrozenAtomIds
      });
      const protectedTouchupStage = {
        name: 'stereoProtectedTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          stereoProtectedTouchupCleanup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: protectedTouchupStage.name, audit: protectedTouchupStage.audit });
      if (isPreferredFinalStereoStage(protectedTouchupStage, finalStereoStage)) {
        finalStereoStage = protectedTouchupStage;
      }
    }
    stereoTouchupCleanup = runUnifiedCleanup(layoutGraph, finalStereoCleanup.coords, {
      maxPasses: 1,
      epsilon: normalizedOptions.bondLength * 0.001,
      bondLength: normalizedOptions.bondLength,
      protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
      protectBondIntegrity: true,
      cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
      frozenAtomIds: placement.frozenAtomIds
    });
    const touchupStage = {
      name: 'stereoTouchup',
      ...auditFinalStereoStage(
        layoutGraph.sourceMolecule,
        layoutGraph,
        stereoTouchupCleanup.coords,
        placement,
        normalizedOptions.bondLength
      )
    };
    stageEntries.push({ name: touchupStage.name, audit: touchupStage.audit });
    if (isPreferredFinalStereoStage(touchupStage, finalStereoStage)) {
      finalStereoStage = touchupStage;
    }
    postTouchupStereoCleanup = enforceAcyclicEZStereo(layoutGraph, stereoTouchupCleanup.coords, {
      bondLength: normalizedOptions.bondLength
    });
    const postTouchupStereoStage = {
      name: 'postTouchupStereo',
      ...auditFinalStereoStage(
        layoutGraph.sourceMolecule,
        layoutGraph,
        postTouchupStereoCleanup.coords,
        placement,
        normalizedOptions.bondLength
      )
    };
    stageEntries.push({ name: postTouchupStereoStage.name, audit: postTouchupStereoStage.audit });
    if (isPreferredFinalStereoStage(postTouchupStereoStage, finalStereoStage)) {
      finalStereoStage = postTouchupStereoStage;
    }
  }
  let acceptedFinalHypervalentTouchup = {
    coords: finalStereoStage.coords,
    nudges: 0
  };
  let acceptedFinalHypervalentRingSubstituentTouchup = {
    coords: finalStereoStage.coords,
    nudges: 0
  };
  if (policy.postCleanupHooks?.includes('hypervalent-angle-tidy')) {
    const finalHypervalentTouchup = runHypervalentAngleTidy(layoutGraph, finalStereoStage.coords);
    if (finalHypervalentTouchup.nudges > 0) {
      const finalHypervalentStage = {
        name: 'finalHypervalentTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          finalHypervalentTouchup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: finalHypervalentStage.name, audit: finalHypervalentStage.audit });
      if (isPreferredFinalStereoStage(finalHypervalentStage, finalStereoStage, { allowPresentationTieBreak: true })) {
        finalStereoStage = finalHypervalentStage;
        acceptedFinalHypervalentTouchup = finalHypervalentTouchup;
      }
      if (policy.postCleanupHooks?.includes('ring-substituent-tidy')) {
        const finalHypervalentRingSubstituentTouchup = runRingSubstituentTidy(layoutGraph, finalHypervalentTouchup.coords, {
          bondLength: normalizedOptions.bondLength,
          frozenAtomIds: placement.frozenAtomIds
        });
        if (finalHypervalentRingSubstituentTouchup.nudges > 0) {
          const finalHypervalentRingSubstituentStage = {
            name: 'finalHypervalentRingSubstituentTouchup',
            ...auditFinalStereoStage(
              layoutGraph.sourceMolecule,
              layoutGraph,
              finalHypervalentRingSubstituentTouchup.coords,
              placement,
              normalizedOptions.bondLength
            )
          };
          stageEntries.push({ name: finalHypervalentRingSubstituentStage.name, audit: finalHypervalentRingSubstituentStage.audit });
          if (isPreferredFinalStereoStage(finalHypervalentRingSubstituentStage, finalStereoStage, { allowPresentationTieBreak: true })) {
            finalStereoStage = finalHypervalentRingSubstituentStage;
            acceptedFinalHypervalentTouchup = finalHypervalentTouchup;
            acceptedFinalHypervalentRingSubstituentTouchup = finalHypervalentRingSubstituentTouchup;
          }
        }
      }
    }
  }
  let acceptedFinalRingSubstituentTouchup = {
    coords: finalStereoStage.coords,
    nudges: 0
  };
  if (policy.postCleanupHooks?.includes('ring-substituent-tidy')) {
    const finalRingSubstituentTouchup = runRingSubstituentTidy(layoutGraph, finalStereoStage.coords, {
      bondLength: normalizedOptions.bondLength,
      frozenAtomIds: placement.frozenAtomIds
    });
    if (finalRingSubstituentTouchup.nudges > 0) {
      const finalRingSubstituentStage = {
        name: 'finalRingSubstituentTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          finalRingSubstituentTouchup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: finalRingSubstituentStage.name, audit: finalRingSubstituentStage.audit });
      if (isPreferredFinalStereoStage(finalRingSubstituentStage, finalStereoStage, { allowPresentationTieBreak: true })) {
        finalStereoStage = finalRingSubstituentStage;
        acceptedFinalRingSubstituentTouchup = finalRingSubstituentTouchup;
      }
    }
  }
  let acceptedFinalAttachedRingRotationTouchup = {
    coords: finalStereoStage.coords,
    nudges: 0
  };
  if (policy.postCleanupHooks?.includes('ring-substituent-tidy')) {
    const finalAttachedRingRotationTouchup = runAttachedRingRotationTouchup(layoutGraph, finalStereoStage.coords, {
      bondLength: normalizedOptions.bondLength,
      frozenAtomIds: placement.frozenAtomIds
    });
    if (finalAttachedRingRotationTouchup.nudges > 0) {
      const finalAttachedRingRotationStage = {
        name: 'finalAttachedRingRotationTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          finalAttachedRingRotationTouchup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: finalAttachedRingRotationStage.name, audit: finalAttachedRingRotationStage.audit });
      if (isPreferredFinalStereoStage(finalAttachedRingRotationStage, finalStereoStage, { allowPresentationTieBreak: true })) {
        finalStereoStage = finalAttachedRingRotationStage;
        acceptedFinalAttachedRingRotationTouchup = finalAttachedRingRotationTouchup;
      }
    }
  }
  let acceptedFinalRingTerminalHeteroTouchup = {
    coords: finalStereoStage.coords,
    nudges: 0
  };
  if (policy.postCleanupHooks?.includes('ring-terminal-hetero-tidy')) {
    const finalRingTerminalHeteroTouchup = runRingTerminalHeteroTidy(layoutGraph, finalStereoStage.coords, {
      bondLength: normalizedOptions.bondLength
    });
    if (finalRingTerminalHeteroTouchup.nudges > 0) {
      const finalRingTerminalHeteroStage = {
        name: 'finalRingTerminalHeteroTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          finalRingTerminalHeteroTouchup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: finalRingTerminalHeteroStage.name, audit: finalRingTerminalHeteroStage.audit });
      if (isPreferredFinalStereoStage(finalRingTerminalHeteroStage, finalStereoStage)) {
        finalStereoStage = finalRingTerminalHeteroStage;
        acceptedFinalRingTerminalHeteroTouchup = finalRingTerminalHeteroTouchup;
      }
    }
  }
  let acceptedFinalPostRingHypervalentTouchup = {
    coords: finalStereoStage.coords,
    nudges: 0
  };
  if (policy.postCleanupHooks?.includes('hypervalent-angle-tidy')) {
    const finalPostRingHypervalentTouchup = runHypervalentAngleTidy(layoutGraph, finalStereoStage.coords);
    if (finalPostRingHypervalentTouchup.nudges > 0) {
      const finalPostRingHypervalentStage = {
        name: 'finalPostRingHypervalentTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          finalPostRingHypervalentTouchup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: finalPostRingHypervalentStage.name, audit: finalPostRingHypervalentStage.audit });
      if (isPreferredFinalStereoStage(finalPostRingHypervalentStage, finalStereoStage, { allowPresentationTieBreak: true })) {
        finalStereoStage = finalPostRingHypervalentStage;
        acceptedFinalPostRingHypervalentTouchup = finalPostRingHypervalentTouchup;
      }
    }
  }
  coords = finalStereoStage.coords;
  if (timingState) {
    timingState.cleanupMs = nowMs() - cleanupStart;
  }

  return {
    coords,
    passes: cleanupPass.passes + postHookCleanup.passes + stereoProtectedTouchupCleanup.passes + stereoTouchupCleanup.passes,
    improvement: cleanupPass.improvement + postHookCleanup.improvement + stereoProtectedTouchupCleanup.improvement + stereoTouchupCleanup.improvement,
    overlapMoves: cleanupPass.overlapMoves + postHookCleanup.overlapMoves + stereoProtectedTouchupCleanup.overlapMoves + stereoTouchupCleanup.overlapMoves,
    labelNudges: labelClearance.nudges,
    symmetrySnaps: symmetryTidy.snappedCount,
    junctionSnaps: symmetryTidy.junctionSnapCount,
    stereoReflections: stereoCleanup.reflections + finalStereoCleanup.reflections + postTouchupStereoCleanup.reflections,
    postHookNudges:
      postCleanup.hookNudges
      + (acceptedFinalHypervalentTouchup.nudges ?? 0)
      + (acceptedFinalHypervalentRingSubstituentTouchup.nudges ?? 0)
      + (acceptedFinalRingSubstituentTouchup.nudges ?? 0)
      + (acceptedFinalAttachedRingRotationTouchup.nudges ?? 0)
      + (acceptedFinalRingTerminalHeteroTouchup.nudges ?? 0)
      + (acceptedFinalPostRingHypervalentTouchup.nudges ?? 0),
    ...(includeStageTelemetry
      ? {
          placementAudit: placementStage.audit,
          stageTelemetry: buildStageTelemetry(stageEntries, selectedGeometryStage, finalStereoStage.name)
        }
      : {})
  };
}

/**
 * Builds stereo metadata after cleanup-adjusted coordinates are finalized.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Finalized coordinates.
 * @param {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} [timingState] - Optional timing accumulator.
 * @returns {{ringDependency: object, stereo: object}} Stereo and ring-dependency metadata.
 */
function runStereoPhase(molecule, layoutGraph, coords, timingState = null) {
  const stereoStart = timingState ? nowMs() : 0;
  const ez = inspectEZStereo(layoutGraph, coords);
  const wedges = pickWedgeAssignments(layoutGraph, coords);
  const ringDependency =
    layoutGraph.rings.length > 0
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
    ezSupportedBondCount: ez.supportedCheckCount,
    ezUnsupportedBondCount: ez.unsupportedCheckCount,
    ezResolvedBondCount: ez.resolvedBondCount,
    ezViolationCount: ez.violationCount,
    ezChecks: ez.checks,
    annotatedCenterCount: wedges.annotatedCenterCount,
    chiralCenterCount: wedges.chiralCenterCount,
    assignedCenterCount: wedges.assignedCenterCount,
    unassignedCenterCount: wedges.unassignedCenterCount,
    assignments: wedges.assignments,
    missingCenterIds: wedges.missingCenterIds,
    unsupportedCenterCount: wedges.unsupportedCenterCount,
    unsupportedCenterIds: wedges.unsupportedCenterIds
  };
  if (timingState) {
    timingState.stereoMs = nowMs() - stereoStart;
  }

  return { ringDependency, stereo };
}

/**
 * Builds the final pipeline return object and metadata envelope.
 * @param {object} molecule - Molecule-like graph.
 * @param {Map<string, {x: number, y: number}>} coords - Finalized coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} normalizedOptions - Normalized pipeline options.
 * @param {string} profile - Resolved profile name.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} policy - Resolved policy bundle.
 * @param {object} placement - Placement result.
 * @param {object} cleanup - Cleanup summary.
 * @param {object} ringDependency - Ring dependency metadata.
 * @param {object} stereo - Stereo metadata.
 * @param {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} [timingState] - Optional timing accumulator.
 * @returns {object} Final pipeline result.
 */
function buildPipelineResult(molecule, coords, layoutGraph, normalizedOptions, profile, familySummary, policy, placement, cleanup, ringDependency, stereo, timingState = null) {
  const auditStart = timingState ? nowMs() : 0;
  const audit = auditLayout(layoutGraph, coords, {
    bondLength: normalizedOptions.bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo
  });
  if (timingState) {
    timingState.auditMs = nowMs() - auditStart;
  }
  const qualityReport = createQualityReport({
    audit,
    cleanup,
    stereo,
    ringDependency,
    policy
  });
  const stage = placement.placedComponentCount === 0 ? 'topology-ready' : placement.unplacedComponentCount === 0 ? 'coordinates-ready' : 'partial-coordinates';
  const placementTelemetry = normalizedOptions.auditTelemetry ? buildPlacementTelemetry(placement) : null;

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
      ...(placementTelemetry
        ? {
            placementFamily: placementTelemetry.placementFamily,
            placementMode: placementTelemetry.placementMode,
            placementModes: placementTelemetry.placementModes,
            componentPlacements: placementTelemetry.componentPlacements,
            placementAudit: cleanup.placementAudit ?? null,
            stageTelemetry: cleanup.stageTelemetry ?? buildStageTelemetry([], null, null)
          }
        : {}),
      qualityReport,
      ...(timingState
        ? {
            timing: {
              totalMs: nowMs() - timingState.startTime,
              placementMs: timingState.placementMs,
              cleanupMs: timingState.cleanupMs,
              labelClearanceMs: timingState.labelClearanceMs,
              stereoMs: timingState.stereoMs,
              auditMs: timingState.auditMs
            }
          }
        : {})
    }
  };
}

/**
 * Classifies the current layout graph into a primary family and mixed-mode flag.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {{primaryFamily: string, mixedMode: boolean}} Family summary.
 */
export function classifyFamily(layoutGraph) {
  const threshold = layoutGraph.options.largeMoleculeThreshold;
  const ringAtomIds =
    layoutGraph.ringAtomIds
    ?? new Set((layoutGraph.rings ?? []).flatMap(ring => ring.atomIds));
  const hasNonRingHeavyAtoms = [...layoutGraph.atoms.values()].some(atom => atom.element !== 'H' && !ringAtomIds.has(atom.id));
  const exceedsLargeThreshold =
    exceedsLargeMoleculeThreshold(layoutGraph.traits, threshold, layoutGraph.components.length)
    || layoutGraph.components.some(component => exceedsLargeComponentThreshold(layoutGraph, component));
  const hasMacrocycle = findMacrocycleRings(layoutGraph.rings).length > 0;

  let primaryFamily = 'acyclic';
  if (layoutGraph.traits.containsMetal) {
    primaryFamily = 'organometallic';
  } else if (hasMacrocycle) {
    primaryFamily = 'macrocycle';
  } else if (exceedsLargeThreshold) {
    primaryFamily = 'large-molecule';
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
  const timingState = createTimingState(normalizedOptions.timing);
  const profile = resolveProfile(normalizedOptions.profile);
  if (isEmptyLayoutInput(molecule)) {
    const atomCount = moleculeAtomCount(molecule);
    return createEmptyPipelineResult(molecule, normalizedOptions, profile, atomCount === 0 ? 'empty-molecule' : 'invalid-molecule');
  }
  const workingMolecule = typeof molecule?.clone === 'function' ? molecule.clone() : molecule;
  const layoutGraph = createLayoutGraphFromNormalized(workingMolecule, normalizedOptions);
  const familySummary = classifyFamily(layoutGraph);
  const policy = resolvePolicy(profile, {
    ...layoutGraph.traits,
    ...familySummary
  });
  const coords = buildInitialCoordsMap(normalizedOptions);
  const placementStart = timingState ? nowMs() : 0;
  const placement = layoutSupportedComponents(layoutGraph, policy);
  if (timingState) {
    timingState.placementMs = nowMs() - placementStart;
  }
  const cleanup = runCleanupPhase(layoutGraph, placement, familySummary, policy, normalizedOptions, timingState);
  for (const [atomId, position] of cleanup.coords) {
    coords.set(atomId, position);
  }
  const repackedCoords = repackFinalDisconnectedComponents(
    layoutGraph,
    coords,
    placement,
    policy,
    normalizedOptions.bondLength
  );
  const finalCoords = shouldAutoOrientFinalCoords(layoutGraph, repackedCoords, normalizedOptions)
    ? orientFinalCoords(repackedCoords, workingMolecule)
    : repackedCoords;
  const { ringDependency, stereo } = runStereoPhase(workingMolecule, layoutGraph, finalCoords, timingState);
  return buildPipelineResult(
    molecule,
    finalCoords,
    layoutGraph,
    normalizedOptions,
    profile,
    familySummary,
    policy,
    placement,
    cleanup,
    ringDependency,
    stereo,
    timingState
  );
}
