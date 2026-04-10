/** @module templates/match */

import { findSubgraphMappings } from '../../algorithms/vf2.js';
import { listTemplates } from './library.js';

function compareStrings(firstValue, secondValue) {
  return String(firstValue).localeCompare(String(secondValue), 'en', { numeric: true });
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
 * Returns whether a template mapping satisfies any extra template match context.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @param {object} template - Template descriptor.
 * @param {Map<string, string>} mapping - Template atom ID to target atom ID mapping.
 * @returns {boolean} True when the mapping is context-compatible.
 */
function templateMatchesContext(layoutGraph, atomIds, template, mapping) {
  const exocyclicNeighbors = template.matchContext?.exocyclicNeighbors ?? [];
  if (exocyclicNeighbors.length === 0) {
    return true;
  }

  const candidateAtomIdSet = new Set(atomIds);
  return exocyclicNeighbors.every(constraint => matchesExocyclicNeighborConstraint(layoutGraph, candidateAtomIdSet, mapping, constraint));
}

/**
 * Finds the first template-to-target atom mapping that satisfies template context.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @param {object} template - Template descriptor.
 * @returns {Map<string, string>|null} Template atom ID to target atom ID mapping or `null`.
 */
export function findTemplateMapping(layoutGraph, atomIds, template) {
  const target = layoutGraph.sourceMolecule.getSubgraph(atomIds);
  for (const mapping of findSubgraphMappings(target, template.molecule, { limit: Infinity })) {
    if (templateMatchesContext(layoutGraph, atomIds, template, mapping)) {
      return mapping;
    }
  }
  return null;
}

/**
 * Finds the first exact template match from a filtered template set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidate - Scaffold candidate.
 * @param {ReadonlyArray<object>} templates - Candidate template list.
 * @returns {object|null} Template-match metadata or `null`.
 */
function findTemplateMatchFromTemplates(layoutGraph, candidate, templates) {
  for (const template of templates) {
    const mapping = findTemplateMapping(layoutGraph, candidate.atomIds, template);
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

  const eligibleTemplates = templates.filter(template => templateCompatible(template, candidate));
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

  const eligibleTemplates = templates.filter(template => templateCompatibleIgnoringFamily(template, candidate));
  if (eligibleTemplates.length === 0) {
    return null;
  }

  return findTemplateMatchFromTemplates(layoutGraph, candidate, eligibleTemplates);
}
