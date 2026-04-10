/** @module placement/bond-validation */

import { BRIDGED_VALIDATION, getTemplateById } from '../templates/library.js';

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
 * @returns {'planar'|'bridged'} Validation class for the template.
 */
function templateValidationClass(templateId) {
  const template = templateId ? getTemplateById(templateId) : null;
  if (!template?.geometryValidation) {
    return 'planar';
  }
  return template.geometryValidation.maxBondLengthFactor === BRIDGED_VALIDATION.maxBondLengthFactor
    && template.geometryValidation.minBondLengthFactor === BRIDGED_VALIDATION.minBondLengthFactor
    ? 'bridged'
    : 'planar';
}

/**
 * Resolves the validation class implied by a placement result.
 * @param {string} family - Resolved placement family.
 * @param {string|null|undefined} placementMode - Placement mode returned by the family layouter.
 * @param {string|null} [templateId] - Matched template ID when available.
 * @returns {'planar'|'bridged'} Validation class for the placed bonds.
 */
export function resolvePlacementValidationClass(family, placementMode, templateId = null) {
  if (placementMode === 'projected-kamada-kawai') {
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
 * @param {'planar'|'bridged'} validationClass - Validation class to assign.
 * @param {Map<string, 'planar'|'bridged'>} [targetMap] - Optional output map to update.
 * @param {{overwrite?: boolean}} [options] - Assignment options.
 * @returns {Map<string, 'planar'|'bridged'>} Updated validation-class map.
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
 * Merges one bond-validation map into another.
 * @param {Map<string, 'planar'|'bridged'>} targetMap - Destination validation-class map.
 * @param {Map<string, 'planar'|'bridged'>|null|undefined} sourceMap - Source validation-class map.
 * @param {{overwrite?: boolean}} [options] - Merge options.
 * @returns {Map<string, 'planar'|'bridged'>} Updated destination map.
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
