/** @module templates/match */

import { findFirstSubgraphMapping } from '../../algorithms/vf2.js';
import { listTemplates } from './library.js';

function compareStrings(firstValue, secondValue) {
  return String(firstValue).localeCompare(String(secondValue), 'en', { numeric: true });
}

function getCandidateSubgraph(layoutGraph, candidate) {
  return layoutGraph.sourceMolecule.getSubgraph(candidate.atomIds);
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
 * Finds the first exact template match from a filtered template set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidate - Scaffold candidate.
 * @param {ReadonlyArray<object>} templates - Candidate template list.
 * @returns {object|null} Template-match metadata or `null`.
 */
function findTemplateMatchFromTemplates(layoutGraph, candidate, templates) {
  const target = getCandidateSubgraph(layoutGraph, candidate);
  for (const template of templates) {
    const mapping = findFirstSubgraphMapping(target, template.molecule, { limit: 1 });
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
