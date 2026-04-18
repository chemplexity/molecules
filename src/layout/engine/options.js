/** @module options */

import { DEFAULT_BOND_LENGTH, DEFAULT_LARGE_MOLECULE_THRESHOLD, DEFAULT_MAX_CLEANUP_PASSES } from './constants.js';
import { resolveProfile } from './profile.js';

function cloneCoordsMap(value, optionName) {
  if (value == null) {
    return new Map();
  }
  if (!(value instanceof Map)) {
    throw new TypeError(`${optionName} must be a Map or null.`);
  }
  const cloned = new Map();
  for (const [atomId, coords] of value) {
    if (!coords || typeof coords !== 'object' || !Number.isFinite(coords.x) || !Number.isFinite(coords.y)) {
      throw new TypeError(`${optionName} entries must be { x, y } objects with finite numeric coordinates.`);
    }
    cloned.set(atomId, { x: coords.x, y: coords.y });
  }
  return cloned;
}

function cloneStringSet(value, optionName) {
  if (value == null) {
    return null;
  }
  if (!(value instanceof Set)) {
    throw new TypeError(`${optionName} must be a Set or null.`);
  }
  const cloned = new Set();
  for (const entry of value) {
    cloned.add(String(entry));
  }
  return cloned;
}

/**
 * Normalizes the large-molecule threshold option bag.
 * @param {object|undefined|null} threshold - Optional threshold overrides.
 * @returns {{heavyAtomCount: number, ringSystemCount: number, blockCount: number}} The normalized threshold.
 */
export function normalizeLargeMoleculeThreshold(threshold = null) {
  if (threshold == null) {
    return { ...DEFAULT_LARGE_MOLECULE_THRESHOLD };
  }
  if (typeof threshold !== 'object') {
    throw new TypeError('largeMoleculeThreshold must be an object when provided.');
  }
  const merged = {
    ...DEFAULT_LARGE_MOLECULE_THRESHOLD,
    ...threshold
  };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`largeMoleculeThreshold.${key} must be a positive integer, got ${JSON.stringify(value)}.`);
    }
  }
  return merged;
}

/**
 * Returns a normalized option bag.
 * @param {object} [options] - Caller-supplied options.
 * @returns {object} The normalized option bag.
 */
export function normalizeOptions(options = {}) {
  if (options == null || typeof options !== 'object') {
    throw new TypeError('layout options must be an object.');
  }
  const bondLength = options.bondLength ?? DEFAULT_BOND_LENGTH;
  if (!Number.isFinite(bondLength) || bondLength <= 0) {
    throw new RangeError(`bondLength must be a positive finite number, got ${JSON.stringify(bondLength)}.`);
  }
  const maxCleanupPasses = options.maxCleanupPasses ?? DEFAULT_MAX_CLEANUP_PASSES;
  if (!Number.isInteger(maxCleanupPasses) || maxCleanupPasses < 0) {
    throw new RangeError(`maxCleanupPasses must be a non-negative integer, got ${JSON.stringify(maxCleanupPasses)}.`);
  }
  const timing = options.timing ?? false;
  if (typeof timing !== 'boolean') {
    throw new TypeError(`timing must be a boolean, got ${JSON.stringify(timing)}.`);
  }
  const auditTelemetry = options.auditTelemetry ?? false;
  if (typeof auditTelemetry !== 'boolean') {
    throw new TypeError(`auditTelemetry must be a boolean, got ${JSON.stringify(auditTelemetry)}.`);
  }
  const finalLandscapeOrientation = options.finalLandscapeOrientation ?? false;
  if (typeof finalLandscapeOrientation !== 'boolean') {
    throw new TypeError(`finalLandscapeOrientation must be a boolean, got ${JSON.stringify(finalLandscapeOrientation)}.`);
  }
  return {
    bondLength,
    suppressH: options.suppressH ?? true,
    fixedCoords: cloneCoordsMap(options.fixedCoords, 'fixedCoords'),
    existingCoords: cloneCoordsMap(options.existingCoords, 'existingCoords'),
    preserveFixed: options.preserveFixed ?? true,
    labelMetrics: options.labelMetrics ?? null,
    profile: resolveProfile(options.profile),
    largeMoleculeThreshold: normalizeLargeMoleculeThreshold(options.largeMoleculeThreshold),
    maxCleanupPasses,
    finalLandscapeOrientation,
    timing,
    auditTelemetry,
    touchedAtoms: cloneStringSet(options.touchedAtoms, 'touchedAtoms'),
    touchedBonds: cloneStringSet(options.touchedBonds, 'touchedBonds')
  };
}
