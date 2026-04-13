/** @module templates/library */

import { TEMPLATE_LIBRARY } from './template-data.js';

export { PLANAR_VALIDATION } from './template-builders.js';

/**
 * Returns the internal scaffold-template library in deterministic order.
 * @returns {ReadonlyArray<object>} Template descriptors.
 */
export function listTemplates() {
  return TEMPLATE_LIBRARY;
}

/**
 * Returns a scaffold template by ID.
 * @param {string} templateId - Template identifier.
 * @returns {object|null} Template descriptor or `null`.
 */
export function getTemplateById(templateId) {
  return TEMPLATE_LIBRARY.find(template => template.id === templateId) ?? null;
}

/**
 * Returns scaled coordinate geometry for a template when available.
 * @param {string|object} templateOrId - Template ID or descriptor.
 * @param {number} bondLength - Target depiction bond length.
 * @returns {Map<string, {x: number, y: number}>|null} Scaled template coordinates or `null`.
 */
export function getTemplateCoords(templateOrId, bondLength) {
  const template = typeof templateOrId === 'string' ? getTemplateById(templateOrId) : templateOrId;
  if (!template || typeof template.createCoords !== 'function') {
    return null;
  }
  return template.createCoords(bondLength);
}
