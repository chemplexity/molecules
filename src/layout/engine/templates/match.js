/** @module templates/match */

import { createSubgraphIndex, createSubgraphQueryPlan, findSubgraphMappings } from '../../../algorithms/vf2.js';
import { defaultAtomMatch } from '../../../algorithms/subgraph.js';
import { listTemplates } from './library.js';

const templateElementSignatureCache = new WeakMap();
const frozenTemplateIndexCache = new WeakMap();
const templateQueryPlanCache = new WeakMap();
const candidateAtomIdsKeyCache = new WeakMap();
const candidateElementSignatureCache = new WeakMap();
const templateContextGroupsCache = new WeakMap();
const GEOMETRY_MAPPING_LIMIT = 64;
const GEOMETRY_MAPPING_SCORE_EPSILON = 1e-9;

function compareStrings(firstValue, secondValue) {
  return String(firstValue).localeCompare(String(secondValue), 'en', { numeric: true });
}

function atomIdsCacheKey(atomIds) {
  return [...atomIds]
    .map(atomId => String(atomId))
    .sort(compareStrings)
    .join('\u0001');
}

function candidateAtomIdsCacheKey(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return atomIdsCacheKey(candidate?.atomIds ?? []);
  }
  const cachedKey = candidateAtomIdsKeyCache.get(candidate);
  if (cachedKey != null) {
    return cachedKey;
  }
  const key = atomIdsCacheKey(candidate.atomIds ?? []);
  candidateAtomIdsKeyCache.set(candidate, key);
  return key;
}

function getTemplateMappingCache(layoutGraph, template) {
  if (!layoutGraph || !template || typeof template !== 'object') {
    return null;
  }
  const cacheByTemplate = layoutGraph._templateMappingCacheByTemplate ?? (layoutGraph._templateMappingCacheByTemplate = new WeakMap());
  let cache = cacheByTemplate.get(template);
  if (!cache) {
    cache = new Map();
    cacheByTemplate.set(template, cache);
  }
  return cache;
}

function cloneTemplateMapping(mapping) {
  return mapping instanceof Map ? new Map(mapping) : null;
}

function cachedTemplateMapping(layoutGraph, atomIds, template, atomIdsKey = atomIdsCacheKey(atomIds)) {
  const cache = getTemplateMappingCache(layoutGraph, template);
  if (!cache) {
    return null;
  }
  return cloneTemplateMapping(cache.get(atomIdsKey));
}

function rememberTemplateMapping(layoutGraph, atomIds, template, mapping, atomIdsKey = atomIdsCacheKey(atomIds)) {
  const cache = getTemplateMappingCache(layoutGraph, template);
  if (!cache || !(mapping instanceof Map)) {
    return;
  }
  cache.set(atomIdsKey, new Map(mapping));
}

function templateCompatible(template, candidate) {
  return template.family === candidate.family && template.atomCount === candidate.atomCount && template.bondCount === candidate.bondCount && template.ringCount === candidate.ringCount;
}

/**
 * Returns whether a template is graph-compatible with a candidate regardless of family.
 * @param {object} template - Template descriptor.
 * @param {object} candidate - Ring-system candidate.
 * @returns {boolean} True when graph counts are compatible.
 */
function templateCompatibleIgnoringFamily(template, candidate) {
  return template.atomCount === candidate.atomCount && template.bondCount === candidate.bondCount && template.ringCount === candidate.ringCount;
}

/**
 * Counts element symbols for a candidate atom list in the target layout graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @returns {Map<string, number>} Element-symbol counts.
 */
function countCandidateElements(layoutGraph, atomIds) {
  const counts = new Map();
  for (const atomId of atomIds) {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    counts.set(atom.name, (counts.get(atom.name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Counts element symbols for a template molecule.
 * @param {object} template - Template descriptor.
 * @returns {Map<string, number>} Element-symbol counts.
 */
function countTemplateElements(template) {
  const counts = new Map();
  for (const atom of template.molecule.atoms.values()) {
    counts.set(atom.name, (counts.get(atom.name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Encodes element-count maps into a deterministic lookup key.
 * @param {Map<string, number>} counts - Element counts.
 * @returns {string} Stable element-count signature.
 */
function elementCountsSignature(counts) {
  return [...counts.entries()]
    .sort(([firstElement], [secondElement]) => compareStrings(firstElement, secondElement))
    .map(([element, count]) => `${element}:${count}`)
    .join(',');
}

function candidateElementSignature(layoutGraph, atomIds) {
  return elementCountsSignature(countCandidateElements(layoutGraph, atomIds));
}

function getCandidateElementSignature(layoutGraph, candidate) {
  if (candidate?.elementSignature != null) {
    return candidate.elementSignature;
  }
  if (!candidate || typeof candidate !== 'object') {
    return candidateElementSignature(layoutGraph, candidate?.atomIds ?? []);
  }
  const cachedEntry = candidateElementSignatureCache.get(candidate);
  if (cachedEntry?.layoutGraph === layoutGraph) {
    return cachedEntry.signature;
  }
  const signature = candidateElementSignature(layoutGraph, candidate.atomIds ?? []);
  candidateElementSignatureCache.set(candidate, { layoutGraph, signature });
  return signature;
}

function templateElementSignature(template) {
  const cachedSignature = templateElementSignatureCache.get(template);
  if (cachedSignature != null) {
    return cachedSignature;
  }
  const signature = elementCountsSignature(countTemplateElements(template));
  templateElementSignatureCache.set(template, signature);
  return signature;
}

function templateIndexKey(template, includeFamily, elementSignature = templateElementSignature(template)) {
  const familyPart = includeFamily ? `${template.family}|` : '';
  return `${familyPart}${template.atomCount}|${template.bondCount}|${template.ringCount}|${elementSignature}`;
}

function candidateIndexKey(candidate, includeFamily, elementSignature) {
  const familyPart = includeFamily ? `${candidate.family}|` : '';
  return `${familyPart}${candidate.atomCount}|${candidate.bondCount}|${candidate.ringCount}|${elementSignature}`;
}

function addTemplateToIndex(index, key, template) {
  const templates = index.get(key);
  if (templates) {
    templates.push(template);
    return;
  }
  index.set(key, [template]);
}

function buildTemplateIndex(templates) {
  const byFamily = new Map();
  const ignoringFamily = new Map();
  for (const template of templates) {
    const elementSignature = templateElementSignature(template);
    addTemplateToIndex(byFamily, templateIndexKey(template, true, elementSignature), template);
    addTemplateToIndex(ignoringFamily, templateIndexKey(template, false, elementSignature), template);
  }
  return { byFamily, ignoringFamily };
}

function getTemplateIndex(templates) {
  if (!Object.isFrozen(templates)) {
    return buildTemplateIndex(templates);
  }
  const cachedIndex = frozenTemplateIndexCache.get(templates);
  if (cachedIndex) {
    return cachedIndex;
  }
  const index = buildTemplateIndex(templates);
  frozenTemplateIndexCache.set(templates, index);
  return index;
}

function getEligibleTemplates(layoutGraph, candidate, templates, includeFamily) {
  const elementSignature = getCandidateElementSignature(layoutGraph, candidate);
  return getEligibleTemplatesForSignature(candidate, templates, includeFamily, elementSignature);
}

function getEligibleTemplatesForSignature(candidate, templates, includeFamily, elementSignature) {
  const index = getTemplateIndex(templates);
  const key = candidateIndexKey(candidate, includeFamily, elementSignature);
  return (includeFamily ? index.byFamily : index.ignoringFamily).get(key) ?? [];
}

function templateQueryPlan(template) {
  const cachedPlan = templateQueryPlanCache.get(template);
  if (cachedPlan) {
    return cachedPlan;
  }
  const plan = createSubgraphQueryPlan(template.molecule);
  templateQueryPlanCache.set(template, plan);
  return plan;
}

function templateContextGroups(template) {
  const cachedGroups = templateContextGroupsCache.get(template);
  if (cachedGroups) {
    return cachedGroups;
  }

  const exocyclicNeighbors = template.matchContext?.exocyclicNeighbors ?? [];
  const mappedAtoms = template.matchContext?.mappedAtoms ?? [];
  const mappedBonds = template.matchContext?.mappedBonds ?? [];
  const groups = {
    exocyclicNeighbors,
    mappedAtoms,
    mappedBonds,
    mappedAtomsByTemplateAtomId: constraintsByTemplateAtomId(mappedAtoms),
    exocyclicNeighborsByTemplateAtomId: constraintsByTemplateAtomId(exocyclicNeighbors)
  };
  templateContextGroupsCache.set(template, groups);
  return groups;
}

function templateHasLateMatchContext(template) {
  return templateContextGroups(template).mappedBonds.length > 0;
}

function distanceBetween(firstPosition, secondPosition) {
  return Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
}

function angleBetween(previousPosition, currentPosition, nextPosition) {
  const firstVector = {
    x: previousPosition.x - currentPosition.x,
    y: previousPosition.y - currentPosition.y
  };
  const secondVector = {
    x: nextPosition.x - currentPosition.x,
    y: nextPosition.y - currentPosition.y
  };
  const firstMagnitude = Math.hypot(firstVector.x, firstVector.y);
  const secondMagnitude = Math.hypot(secondVector.x, secondVector.y);
  if (firstMagnitude <= 1e-12 || secondMagnitude <= 1e-12) {
    return 0;
  }
  const cosine = Math.max(-1, Math.min(1, (firstVector.x * secondVector.x + firstVector.y * secondVector.y) / (firstMagnitude * secondMagnitude)));
  return Math.acos(cosine) * (180 / Math.PI);
}

function mappedTemplateCoords(template, mapping) {
  if (!Array.isArray(template.normalizedCoords)) {
    return null;
  }
  const coords = new Map();
  for (const [templateAtomId, position] of template.normalizedCoords) {
    const targetAtomId = mapping.get(templateAtomId);
    if (!targetAtomId) {
      return null;
    }
    coords.set(targetAtomId, position);
  }
  return coords;
}

/**
 * Scores one automorphic template mapping against the target ring basis.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Set<string>} candidateAtomIdSet - Candidate ring-system atom IDs.
 * @param {object} template - Template descriptor with normalized geometry.
 * @param {Map<string, string>} mapping - Template atom ID to target atom ID mapping.
 * @returns {number} Lower score for mappings whose coordinates keep target rings readable.
 */
function scoreTemplateMappingGeometry(layoutGraph, candidateAtomIdSet, template, mapping) {
  const coords = mappedTemplateCoords(template, mapping);
  if (!coords) {
    return 0;
  }

  const minBondLengthFactor = template.geometryValidation?.minBondLengthFactor ?? 0.7;
  const maxBondLengthFactor = template.geometryValidation?.maxBondLengthFactor ?? 1.4;
  let score = 0;
  let ringCount = 0;
  for (const ring of layoutGraph.rings ?? []) {
    if (!ring.atomIds.every(atomId => candidateAtomIdSet.has(atomId) && coords.has(atomId))) {
      continue;
    }
    ringCount++;
    for (let index = 0; index < ring.atomIds.length; index++) {
      const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
      const atomId = ring.atomIds[index];
      const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      const angle = angleBetween(coords.get(previousAtomId), coords.get(atomId), coords.get(nextAtomId));
      const bondLength = distanceBetween(coords.get(atomId), coords.get(nextAtomId));
      score += Math.max(0, 75 - angle) ** 2;
      score += Math.max(0, angle - 150) ** 2;
      score += Math.max(0, Math.abs(angle - 110) - 38);
      score += Math.max(0, minBondLengthFactor - bondLength) * 100;
      score += Math.max(0, bondLength - maxBondLengthFactor) * 100;
    }
  }
  return ringCount > 0 ? score : 0;
}

/**
 * Counts exocyclic neighbours on a mapped target atom that satisfy one constraint.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Set<string>} candidateAtomIdSet - Ring-system atom IDs in the candidate.
 * @param {string} targetAtomId - Target atom ID in the source molecule.
 * @param {object} constraint - Exocyclic-neighbour constraint descriptor.
 * @returns {number} Count of matching exocyclic neighbours.
 */
function countMatchingExocyclicNeighbors(layoutGraph, candidateAtomIdSet, targetAtomId, constraint) {
  const sourceAtom = layoutGraph.sourceMolecule.atoms.get(targetAtomId);
  if (!sourceAtom) {
    return 0;
  }

  let count = 0;
  for (const bondId of sourceAtom.bonds) {
    const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }

    const neighborId = bond.atoms[0] === targetAtomId ? bond.atoms[1] : bond.atoms[0];
    if (candidateAtomIdSet.has(neighborId)) {
      continue;
    }

    const neighborAtom = layoutGraph.sourceMolecule.atoms.get(neighborId);
    if (!neighborAtom) {
      continue;
    }
    if (neighborAtom.name !== constraint.element) {
      continue;
    }
    if (constraint.bondOrder != null && (bond.properties.order ?? 1) !== constraint.bondOrder) {
      continue;
    }
    if (constraint.neighborDegree != null && neighborAtom.bonds.length !== constraint.neighborDegree) {
      continue;
    }
    count++;
  }

  return count;
}

/**
 * Returns whether one exocyclic-neighbour constraint is satisfied.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Set<string>} candidateAtomIdSet - Ring-system atom IDs in the candidate.
 * @param {Map<string, string>} mapping - Template atom ID to target atom ID mapping.
 * @param {object} constraint - Exocyclic-neighbour constraint descriptor.
 * @returns {boolean} True when the constraint is satisfied.
 */
function matchesExocyclicNeighborConstraint(layoutGraph, candidateAtomIdSet, mapping, constraint) {
  const targetAtomId = mapping.get(constraint.templateAtomId);
  if (!targetAtomId) {
    return false;
  }

  const matchCount = countMatchingExocyclicNeighbors(layoutGraph, candidateAtomIdSet, targetAtomId, constraint);
  const minCount = constraint.minCount ?? 1;
  const maxCount = constraint.maxCount ?? minCount;
  return matchCount >= minCount && matchCount <= maxCount;
}

/**
 * Returns whether one mapped-atom constraint is satisfied.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, string>} mapping - Template atom ID to target atom ID mapping.
 * @param {object} constraint - Mapped-atom constraint descriptor.
 * @returns {boolean} True when the mapped atom satisfies the constraint.
 */
function matchesMappedAtomConstraint(layoutGraph, mapping, constraint) {
  const targetAtomId = mapping.get(constraint.templateAtomId);
  if (!targetAtomId) {
    return false;
  }

  const targetAtom = layoutGraph.sourceMolecule.atoms.get(targetAtomId);
  if (!targetAtom) {
    return false;
  }

  if (constraint.element != null && targetAtom.name !== constraint.element) {
    return false;
  }
  if (constraint.charge != null && targetAtom.getCharge() !== constraint.charge) {
    return false;
  }
  if (constraint.aromatic != null && targetAtom.isAromatic() !== constraint.aromatic) {
    return false;
  }
  if (constraint.radical != null && targetAtom.getRadical() !== constraint.radical) {
    return false;
  }
  if (constraint.neighborDegree != null && targetAtom.bonds.length !== constraint.neighborDegree) {
    return false;
  }

  return true;
}

function targetAtomMatchesMappedAtomConstraint(targetAtom, constraint) {
  if (!targetAtom) {
    return false;
  }

  if (constraint.element != null && targetAtom.name !== constraint.element) {
    return false;
  }
  if (constraint.charge != null && targetAtom.getCharge() !== constraint.charge) {
    return false;
  }
  if (constraint.aromatic != null && targetAtom.isAromatic() !== constraint.aromatic) {
    return false;
  }
  if (constraint.radical != null && targetAtom.getRadical() !== constraint.radical) {
    return false;
  }
  if (constraint.neighborDegree != null && targetAtom.bonds.length !== constraint.neighborDegree) {
    return false;
  }

  return true;
}

function constraintsByTemplateAtomId(constraints) {
  const byTemplateAtomId = new Map();
  for (let index = 0; index < constraints.length; index++) {
    const constraint = constraints[index];
    const templateAtomId = constraint.templateAtomId;
    if (!templateAtomId) {
      continue;
    }
    const entries = byTemplateAtomId.get(templateAtomId) ?? [];
    entries.push({ constraint, index });
    byTemplateAtomId.set(templateAtomId, entries);
  }
  return byTemplateAtomId;
}

function createTemplateContextAtomMatch(layoutGraph, template, candidateAtomIdSet) {
  const { mappedAtoms, exocyclicNeighbors, mappedAtomsByTemplateAtomId, exocyclicNeighborsByTemplateAtomId } = templateContextGroups(template);
  if (mappedAtoms.length === 0 && exocyclicNeighbors.length === 0) {
    return null;
  }

  const exocyclicCountCache = new Map();

  return (queryAtom, targetAtom) => {
    if (!defaultAtomMatch(queryAtom, targetAtom)) {
      return false;
    }

    for (const { constraint } of mappedAtomsByTemplateAtomId.get(queryAtom.id) ?? []) {
      if (!targetAtomMatchesMappedAtomConstraint(targetAtom, constraint)) {
        return false;
      }
    }

    for (const { constraint, index } of exocyclicNeighborsByTemplateAtomId.get(queryAtom.id) ?? []) {
      const cacheKey = `${index}\u0001${targetAtom.id}`;
      let matchCount = exocyclicCountCache.get(cacheKey);
      if (matchCount == null) {
        matchCount = countMatchingExocyclicNeighbors(layoutGraph, candidateAtomIdSet, targetAtom.id, constraint);
        exocyclicCountCache.set(cacheKey, matchCount);
      }
      const minCount = constraint.minCount ?? 1;
      const maxCount = constraint.maxCount ?? minCount;
      if (matchCount < minCount || matchCount > maxCount) {
        return false;
      }
    }

    return true;
  };
}

/**
 * Returns whether one mapped-bond constraint is satisfied.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, string>} mapping - Template atom ID to target atom ID mapping.
 * @param {object} constraint - Mapped-bond constraint descriptor.
 * @returns {boolean} True when the mapped target bond satisfies the constraint.
 */
function matchesMappedBondConstraint(layoutGraph, mapping, constraint) {
  const [firstTemplateAtomId, secondTemplateAtomId] = constraint.templateAtomIds ?? [];
  const firstTargetAtomId = mapping.get(firstTemplateAtomId);
  const secondTargetAtomId = mapping.get(secondTemplateAtomId);
  if (!firstTargetAtomId || !secondTargetAtomId) {
    return false;
  }

  const targetBond = layoutGraph.sourceMolecule.getBond(firstTargetAtomId, secondTargetAtomId);
  if (!targetBond) {
    return false;
  }
  if (constraint.order != null && (targetBond.properties.order ?? 1) !== constraint.order) {
    return false;
  }
  if (constraint.ez != null && (layoutGraph.sourceMolecule.getEZStereo?.(targetBond.id) ?? null) !== constraint.ez) {
    return false;
  }

  return true;
}

/**
 * Returns whether a template mapping satisfies any extra template match context.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @param {object} template - Template descriptor.
 * @param {Map<string, string>} mapping - Template atom ID to target atom ID mapping.
 * @param {Set<string>|null} [candidateAtomIdSet] - Optional candidate atom ID set for context checks.
 * @returns {boolean} True when the mapping is context-compatible.
 */
function templateMatchesContext(layoutGraph, atomIds, template, mapping, candidateAtomIdSet = null) {
  const { exocyclicNeighbors, mappedAtoms, mappedBonds } = templateContextGroups(template);
  if (exocyclicNeighbors.length === 0 && mappedAtoms.length === 0 && mappedBonds.length === 0) {
    return true;
  }

  const contextAtomIdSet = candidateAtomIdSet ?? new Set(atomIds);
  return (
    exocyclicNeighbors.every(constraint => matchesExocyclicNeighborConstraint(layoutGraph, contextAtomIdSet, mapping, constraint)) &&
    mappedAtoms.every(constraint => matchesMappedAtomConstraint(layoutGraph, mapping, constraint)) &&
    mappedBonds.every(constraint => matchesMappedBondConstraint(layoutGraph, mapping, constraint))
  );
}

function findTemplateMappingInTarget(layoutGraph, atomIds, template, target, candidateAtomIdSet = null, targetIndex = null, atomIdsKey = atomIdsCacheKey(atomIds)) {
  const cachedMapping = cachedTemplateMapping(layoutGraph, atomIds, template, atomIdsKey);
  if (cachedMapping) {
    return cachedMapping;
  }

  const queryPlan = templateQueryPlan(template);
  const contextAtomIdSet = candidateAtomIdSet ?? new Set(atomIds);
  const atomMatch = createTemplateContextAtomMatch(layoutGraph, template, contextAtomIdSet);
  const rankGeometryMappings = template.rankGeometryMappings === true && Array.isArray(template.normalizedCoords);
  const limit = templateHasLateMatchContext(template) ? Infinity : rankGeometryMappings ? GEOMETRY_MAPPING_LIMIT : 1;
  const matchOptions = atomMatch ? { limit, targetIndex, atomMatch, ...queryPlan } : { limit, targetIndex, ...queryPlan };
  let bestMapping = null;
  let bestScore = Infinity;
  for (const mapping of findSubgraphMappings(target, template.molecule, matchOptions)) {
    if (templateMatchesContext(layoutGraph, atomIds, template, mapping, contextAtomIdSet)) {
      if (!rankGeometryMappings) {
        rememberTemplateMapping(layoutGraph, atomIds, template, mapping, atomIdsKey);
        return mapping;
      }
      const score = scoreTemplateMappingGeometry(layoutGraph, contextAtomIdSet, template, mapping);
      if (!bestMapping || score < bestScore - GEOMETRY_MAPPING_SCORE_EPSILON) {
        bestMapping = mapping;
        bestScore = score;
      }
    }
  }
  if (bestMapping) {
    rememberTemplateMapping(layoutGraph, atomIds, template, bestMapping, atomIdsKey);
    return bestMapping;
  }
  return null;
}

/**
 * Finds the first template-to-target atom mapping that satisfies template context.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @param {object} template - Template descriptor.
 * @returns {Map<string, string>|null} Template atom ID to target atom ID mapping or `null`.
 */
export function findTemplateMapping(layoutGraph, atomIds, template) {
  const atomIdsKey = atomIdsCacheKey(atomIds);
  const cachedMapping = cachedTemplateMapping(layoutGraph, atomIds, template, atomIdsKey);
  if (cachedMapping) {
    return cachedMapping;
  }
  const target = layoutGraph.sourceMolecule.getSubgraph(atomIds);
  return findTemplateMappingInTarget(layoutGraph, atomIds, template, target, null, createSubgraphIndex(target), atomIdsKey);
}

/**
 * Finds the first exact template match from a filtered template set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidate - Scaffold candidate.
 * @param {ReadonlyArray<object>} templates - Candidate template list.
 * @param {object|null} [target] - Optional candidate subgraph reused across template buckets.
 * @param {Set<string>|null} [candidateAtomIdSet] - Optional candidate atom IDs reused across context checks.
 * @param {object|null} [targetIndex] - Optional candidate subgraph VF2 index reused across template probes.
 * @returns {object|null} Template-match metadata or `null`.
 */
function findTemplateMatchFromTemplates(layoutGraph, candidate, templates, target = null, candidateAtomIdSet = null, targetIndex = null) {
  const targetGraph = target ?? layoutGraph.sourceMolecule.getSubgraph(candidate.atomIds);
  const targetGraphIndex = targetIndex ?? createSubgraphIndex(targetGraph);
  const contextAtomIdSet = candidateAtomIdSet ?? new Set(candidate.atomIds);
  const atomIdsKey = candidateAtomIdsCacheKey(candidate);
  for (const template of templates) {
    const mapping = findTemplateMappingInTarget(layoutGraph, candidate.atomIds, template, targetGraph, contextAtomIdSet, targetGraphIndex, atomIdsKey);
    if (mapping) {
      return {
        id: template.id,
        family: template.family,
        priority: template.priority,
        atomCount: template.atomCount,
        bondCount: template.bondCount,
        ringCount: template.ringCount,
        mappedAtomIds: [...mapping.values()].sort(compareStrings)
      };
    }
  }
  return null;
}

/**
 * Finds the best exact scaffold-template match, trying the heuristic family
 * bucket first and then the family-agnostic fallback while reusing candidate
 * indexing/search structures.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidate - Scaffold candidate.
 * @param {ReadonlyArray<object>} [templates] - Optional template list.
 * @returns {object|null} Template-match metadata or `null`.
 */
export function findBestTemplateMatch(layoutGraph, candidate, templates = listTemplates()) {
  if (!candidate || candidate.type !== 'ring-system') {
    return null;
  }

  const elementSignature = getCandidateElementSignature(layoutGraph, candidate);
  let target = null;
  let targetIndex = null;
  let candidateAtomIdSet = null;
  const findFromEligibleTemplates = eligibleTemplates => {
    if (eligibleTemplates.length === 0) {
      return null;
    }
    target ??= layoutGraph.sourceMolecule.getSubgraph(candidate.atomIds);
    targetIndex ??= createSubgraphIndex(target);
    candidateAtomIdSet ??= new Set(candidate.atomIds);
    return findTemplateMatchFromTemplates(layoutGraph, candidate, eligibleTemplates, target, candidateAtomIdSet, targetIndex);
  };

  const strictTemplates = getEligibleTemplatesForSignature(candidate, templates, true, elementSignature).filter(template => templateCompatible(template, candidate));
  const strictMatch = findFromEligibleTemplates(strictTemplates);
  if (strictMatch) {
    return strictMatch;
  }

  const fallbackTemplates = getEligibleTemplatesForSignature(candidate, templates, false, elementSignature).filter(template => templateCompatibleIgnoringFamily(template, candidate));
  return findFromEligibleTemplates(fallbackTemplates);
}

/**
 * Finds the best exact scaffold-template match for a ring-system candidate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidate - Scaffold candidate.
 * @param {ReadonlyArray<object>} [templates] - Optional template list.
 * @returns {object|null} Template-match metadata or `null`.
 */
export function findTemplateMatch(layoutGraph, candidate, templates = listTemplates()) {
  if (!candidate || candidate.type !== 'ring-system') {
    return null;
  }

  const eligibleTemplates = getEligibleTemplates(layoutGraph, candidate, templates, true).filter(template => templateCompatible(template, candidate));
  if (eligibleTemplates.length === 0) {
    return null;
  }

  return findTemplateMatchFromTemplates(layoutGraph, candidate, eligibleTemplates);
}

/**
 * Finds the best exact scaffold-template match for a ring-system candidate
 * even when the current heuristic family label is wrong.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidate - Scaffold candidate.
 * @param {ReadonlyArray<object>} [templates] - Optional template list.
 * @returns {object|null} Template-match metadata or `null`.
 */
export function findTemplateMatchIgnoringFamily(layoutGraph, candidate, templates = listTemplates()) {
  if (!candidate || candidate.type !== 'ring-system') {
    return null;
  }

  const eligibleTemplates = getEligibleTemplates(layoutGraph, candidate, templates, false).filter(template => templateCompatibleIgnoringFamily(template, candidate));
  if (eligibleTemplates.length === 0) {
    return null;
  }

  return findTemplateMatchFromTemplates(layoutGraph, candidate, eligibleTemplates);
}
