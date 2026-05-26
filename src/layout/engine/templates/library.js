/** @module templates/library */

import { TEMPLATE_LIBRARY } from './template-data.js';

export { PLANAR_VALIDATION } from './template-builders.js';

const TEMPLATE_BY_ID = new Map(TEMPLATE_LIBRARY.map(template => [template.id, template]));
const TEMPLATE_COORD_ENTRIES_CACHE = new WeakMap();

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
  return TEMPLATE_BY_ID.get(templateId) ?? null;
}

function templateCoordCacheKey(bondLength) {
  return Number.isFinite(bondLength) ? String(bondLength) : `${bondLength}`;
}

function cloneCoordEntries(entries) {
  const coords = new Map();
  for (const [atomId, position] of entries) {
    coords.set(atomId, {
      x: position.x,
      y: position.y
    });
  }
  return coords;
}

function scaledTemplateCoordEntries(template, bondLength) {
  let cache = TEMPLATE_COORD_ENTRIES_CACHE.get(template);
  if (!cache) {
    cache = new Map();
    TEMPLATE_COORD_ENTRIES_CACHE.set(template, cache);
  }
  const cacheKey = templateCoordCacheKey(bondLength);
  const cachedEntries = cache.get(cacheKey);
  if (cachedEntries) {
    return cachedEntries;
  }
  const coords = template.createCoords(bondLength);
  if (!coords) {
    return null;
  }
  const entries = Object.freeze(
    [...coords.entries()].map(([atomId, position]) =>
      Object.freeze([
        atomId,
        Object.freeze({
          x: position.x,
          y: position.y
        })
      ])
    )
  );
  cache.set(cacheKey, entries);
  return entries;
}

/**
 * Returns cached immutable scaled coordinate entries for a template when available.
 * @param {string|object} templateOrId - Template ID or descriptor.
 * @param {number} bondLength - Target depiction bond length.
 * @returns {ReadonlyArray<readonly [string, Readonly<{x: number, y: number}>]>|null} Scaled coordinate entries or `null`.
 */
export function getTemplateCoordEntries(templateOrId, bondLength) {
  const template = typeof templateOrId === 'string' ? getTemplateById(templateOrId) : templateOrId;
  if (!template || typeof template.createCoords !== 'function') {
    return null;
  }
  return scaledTemplateCoordEntries(template, bondLength);
}

/**
 * Returns scaled coordinate geometry for a template when available.
 * @param {string|object} templateOrId - Template ID or descriptor.
 * @param {number} bondLength - Target depiction bond length.
 * @returns {Map<string, {x: number, y: number}>|null} Scaled template coordinates or `null`.
 */
export function getTemplateCoords(templateOrId, bondLength) {
  const entries = getTemplateCoordEntries(templateOrId, bondLength);
  return entries ? cloneCoordEntries(entries) : null;
}
