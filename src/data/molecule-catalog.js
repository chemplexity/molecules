/** @module data/molecule-catalog */

import { moleculeCatalog } from './catalog/index.js';

export { moleculeCatalog };

function normalizeCollectionSearchValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Find a molecule collection by its stable collection id.
 * @param {string} collectionId - The collectionId value.
 * @returns {object|null} The computed result.
 */
export function getMoleculeCatalogById(collectionId) {
  const normalizedId = normalizeCollectionSearchValue(collectionId);
  if (!normalizedId) {
    return null;
  }
  return moleculeCatalog.find(collection => collection.id === normalizedId) ?? null;
}

/**
 * Search molecule entries across all collections.
 *
 * Matches against molecule `id`, `name`, `aliases`, `tags`, `smiles`, `inchi`,
 * and the parent collection `id`, `name`, and `tags`.
 * @param {string} query - The query structure.
 * @param {{
 *   collectionId?: string,
 *   exact?: boolean,
 *   limit?: number
 * }} [options] - Configuration options.
 * @returns {Array<{
 *   collectionId: string,
 *   collectionName: string,
 *   molecule: {
 *     id: string,
 *     name: string,
 *     smiles: string,
 *     inchi: string,
 *     tags: string[],
 *     aliases: string[]
 *   }
 * }>} Array of matching catalog entries.
 */
export function findMolecules(query, options = {}) {
  const normalizedQuery = normalizeCollectionSearchValue(query);
  if (!normalizedQuery) {
    return [];
  }

  const collectionFilter = options.collectionId ? normalizeCollectionSearchValue(options.collectionId) : '';
  const exact = options.exact === true;
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : Infinity;

  const results = [];
  for (const collection of moleculeCatalog) {
    if (collectionFilter && collection.id !== collectionFilter) {
      continue;
    }

    const collectionFields = [collection.id, collection.name, ...(collection.tags ?? [])];
    for (const molecule of collection.molecules) {
      const haystack = [molecule.id, molecule.name, molecule.smiles, molecule.inchi, ...(molecule.tags ?? []), ...(molecule.aliases ?? []), ...collectionFields].map(
        normalizeCollectionSearchValue
      );

      const matched = exact ? haystack.some(value => value === normalizedQuery) : haystack.some(value => value.includes(normalizedQuery));

      if (!matched) {
        continue;
      }

      results.push({
        collectionId: collection.id,
        collectionName: collection.name,
        molecule
      });
      if (results.length >= limit) {
        return results;
      }
    }
  }

  return results;
}

export default moleculeCatalog;
