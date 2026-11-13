/** @module placement/bond-validation */

import { AUDIT_PLANAR_VALIDATION, BRIDGED_VALIDATION, FUSED_RESCUE_LIMITS } from '../constants.js';
import { getTemplateById } from '../templates/library.js';
import { buildScaffoldPlan } from '../model/scaffold-plan.js';
import { isMetalAtom } from '../topology/metal-centers.js';

/**
 * Returns whether a bond lies fully inside the requested atom set.
 * @param {object} bond - Bond descriptor.
 * @param {Set<string>} atomIdSet - Candidate atom IDs.
 * @returns {boolean} True when both bond endpoints are inside the set.
 */
function isInternalBond(bond, atomIdSet) {
  return atomIdSet.has(bond.a) && atomIdSet.has(bond.b);
}

/**
 * Resolves the validation class implied by a matched template.
 * @param {string|null} templateId - Matched template ID.
 * @returns {'planar'|'bridged'|'haptic'} Validation class for the template.
 */
function templateValidationClass(templateId) {
  const template = templateId ? getTemplateById(templateId) : null;
  if (!template?.geometryValidation) {
    return 'planar';
  }
  return template.geometryValidation.maxBondLengthFactor === BRIDGED_VALIDATION.maxBondLengthFactor && template.geometryValidation.minBondLengthFactor === BRIDGED_VALIDATION.minBondLengthFactor
    ? 'bridged'
    : 'planar';
}

/**
 * Resolves the validation class implied by a placement result.
 * @param {string} family - Resolved placement family.
 * @param {string|null|undefined} placementMode - Placement mode returned by the family layouter.
 * @param {string|null} [templateId] - Matched template ID when available.
 * @returns {'planar'|'bridged'|'haptic'} Validation class for the placed bonds.
 */
export function resolvePlacementValidationClass(family, placementMode, templateId = null) {
  if (placementMode === 'projected-kamada-kawai' || placementMode === 'kamada-kawai-cage' || placementMode === 'pericondensed') {
    return 'bridged';
  }
  if (placementMode === 'constructed-bridged' || placementMode === 'constructed-aromatic-capped-fused-square-bridge') {
    return 'bridged';
  }
  if (placementMode === 'template') {
    if (family === 'bridged' && !templateId) {
      return 'bridged';
    }
    return templateValidationClass(templateId);
  }
  return 'planar';
}

/**
 * Assigns one validation class to every bond internal to the requested atom set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} atomIds - Atom IDs whose internal bonds should be tagged.
 * @param {'planar'|'bridged'|'haptic'} validationClass - Validation class to assign.
 * @param {Map<string, 'planar'|'bridged'|'haptic'>} [targetMap] - Optional output map to update.
 * @param {{overwrite?: boolean}} [options] - Assignment options.
 * @returns {Map<string, 'planar'|'bridged'|'haptic'>} Updated validation-class map.
 */
export function assignBondValidationClass(layoutGraph, atomIds, validationClass, targetMap = new Map(), options = {}) {
  const atomIdSet = new Set(atomIds);
  const overwrite = options.overwrite ?? true;
  for (const bond of layoutGraph.bonds.values()) {
    if (!isInternalBond(bond, atomIdSet)) {
      continue;
    }
    if (!overwrite && targetMap.has(bond.id)) {
      continue;
    }
    targetMap.set(bond.id, validationClass);
  }
  return targetMap;
}

/**
 * Returns whether a fused scaffold can use the same bounded bridged fallback
 * considered by fresh mixed-family placement.
 * @param {object} candidate - Fused ring-system scaffold candidate.
 * @returns {boolean} True when the fused topology is eligible.
 */
function supportsProjectedFusedFallback(candidate) {
  if (candidate.family !== 'fused' || candidate.templateId) {
    return false;
  }
  const atomCount = candidate.atomCount ?? candidate.atomIds.length;
  const ringCount = candidate.ringCount ?? candidate.ringIds.length;
  return (
    (atomCount <= FUSED_RESCUE_LIMITS.compactTricyclicMaxAtomCount && ringCount >= 3) ||
    (atomCount <= FUSED_RESCUE_LIMITS.compactTetracyclicMaxAtomCount && ringCount >= 4) ||
    (atomCount <= FUSED_RESCUE_LIMITS.compactCageMaxAtomCount && ringCount >= FUSED_RESCUE_LIMITS.compactCageMinRingCount) ||
    ringCount >= FUSED_RESCUE_LIMITS.largeCageMinRingCount ||
    ringCount >= Math.ceil(atomCount / 2)
  );
}

/**
 * Detects preserved projected geometry from bounded placement fallbacks. This
 * covers hybrid macrocycles whose dedicated placer cannot cover the whole ring
 * system and compact fused cages whose planar placement was replaced by a
 * bridged/KK candidate. Multiple planar failures are required so an isolated
 * malformed bond cannot relax an otherwise planar scaffold. Fused candidates
 * must also contain both compression and extension, distinguishing a projected
 * cage pose from uniform scaling of an ordinary fused layout. Multi-ring metal
 * macrocycles may also retain projected covalent geometry even when their
 * coordination-ring basis has only one connection kind; donor links themselves
 * are excluded from the covalent geometry evidence.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidate - Ring-system scaffold candidate.
 * @param {Map<string, {x: number, y: number}>|null} coords - Preserved coordinates.
 * @returns {boolean} True when bridged validation reconstructs the fallback mode.
 */
function hasProjectedFallbackGeometry(layoutGraph, candidate, coords) {
  if (!coords || candidate.templateId) {
    return false;
  }
  const ringIds = new Set(candidate.ringIds);
  const connectionKinds = new Set(layoutGraph.ringConnections.filter(connection => ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)).map(connection => connection.kind));
  const projectedMetalMacrocycle = candidate.family === 'macrocycle' && candidate.ringIds.length >= 3 && candidate.atomIds.some(id => isMetalAtom(layoutGraph.sourceMolecule.atoms.get(id)));
  const projectedHybridMacrocycle = candidate.family === 'macrocycle' && (connectionKinds.size >= 2 || projectedMetalMacrocycle);
  const projectedFusedFallback = supportsProjectedFusedFallback(candidate);
  if (!projectedHybridMacrocycle && !projectedFusedFallback) {
    return false;
  }

  const atomIds = new Set(candidate.atomIds);
  const bondLength = layoutGraph.options.bondLength;
  let planarFailureCount = 0;
  let compressedPlanarFailureCount = 0;
  let stretchedPlanarFailureCount = 0;
  let totalDeviation = 0;
  let sampleCount = 0;
  for (const bond of layoutGraph.bonds.values()) {
    if (!isInternalBond(bond, atomIds)) {
      continue;
    }
    // Coordination links do not participate in the covalent bond-length audit.
    // Their projected donor radii must not veto reconstruction of the organic
    // macrocycle's validation class.
    if (projectedMetalMacrocycle && (bond.kind !== 'covalent' || [bond.a, bond.b].some(id => layoutGraph.atoms.get(id)?.element === 'H'))) {
      continue;
    }
    const first = coords.get(bond.a);
    const second = coords.get(bond.b);
    if (!first || !second) {
      return false;
    }
    const ratio = Math.hypot(second.x - first.x, second.y - first.y) / bondLength;
    if (!Number.isFinite(ratio) || ratio < BRIDGED_VALIDATION.minBondLengthFactor || ratio > BRIDGED_VALIDATION.maxBondLengthFactor) {
      return false;
    }
    if (ratio < AUDIT_PLANAR_VALIDATION.minBondLengthFactor || ratio > AUDIT_PLANAR_VALIDATION.maxBondLengthFactor) {
      planarFailureCount++;
      if (ratio < AUDIT_PLANAR_VALIDATION.minBondLengthFactor) {
        compressedPlanarFailureCount++;
      } else {
        stretchedPlanarFailureCount++;
      }
    }
    totalDeviation += Math.abs(ratio - 1);
    sampleCount++;
  }
  return (
    planarFailureCount >= 2 &&
    sampleCount > 0 &&
    totalDeviation / sampleCount <= BRIDGED_VALIDATION.maxMeanDeviation &&
    (!(projectedFusedFallback || projectedMetalMacrocycle) || (compressedPlanarFailureCount > 0 && stretchedPlanarFailureCount > 0))
  );
}

/**
 * Reconstructs validation classes for a component whose coordinates are retained.
 * Matched templates keep their declared geometry; unmatched bridged scaffolds
 * use projected validation. Only bonds internal to those ring systems receive
 * that class, leaving branches and ordinary planar scaffolds strictly planar.
 * Reuses the topology/template scaffold plan without generating coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{atomIds: string[]}} component - Preserved connected component.
 * @param {Map<string, 'planar'|'bridged'|'haptic'>} [targetMap] - Output map.
 * @param {Map<string, {x: number, y: number}>|null} [coords] - Preserved coordinates used to reconstruct projected hybrid macrocycles.
 * @returns {Map<string, 'planar'|'bridged'|'haptic'>} Updated validation classes.
 */
export function assignPreservedBondValidationClasses(layoutGraph, component, targetMap = new Map(), coords = null) {
  assignBondValidationClass(layoutGraph, component.atomIds, 'planar', targetMap, { overwrite: false });
  for (const candidate of buildScaffoldPlan(layoutGraph, component).candidates) {
    if (candidate.type !== 'ring-system') {
      continue;
    }
    const validationClass = candidate.templateId
      ? resolvePlacementValidationClass(candidate.family, 'template', candidate.templateId)
      : candidate.family === 'bridged' || hasProjectedFallbackGeometry(layoutGraph, candidate, coords)
        ? 'bridged'
        : 'planar';
    if (validationClass !== 'planar') {
      assignBondValidationClass(layoutGraph, candidate.atomIds, validationClass, targetMap);
    }
  }
  return targetMap;
}

/**
 * Merges one bond-validation map into another.
 * @param {Map<string, 'planar'|'bridged'|'haptic'>} targetMap - Destination validation-class map.
 * @param {Map<string, 'planar'|'bridged'|'haptic'>|null|undefined} sourceMap - Source validation-class map.
 * @param {{overwrite?: boolean}} [options] - Merge options.
 * @returns {Map<string, 'planar'|'bridged'|'haptic'>} Updated destination map.
 */
export function mergeBondValidationClasses(targetMap, sourceMap, options = {}) {
  if (!sourceMap) {
    return targetMap;
  }
  const overwrite = options.overwrite ?? true;
  for (const [bondId, validationClass] of sourceMap) {
    if (!overwrite && targetMap.has(bondId)) {
      continue;
    }
    targetMap.set(bondId, validationClass);
  }
  return targetMap;
}
