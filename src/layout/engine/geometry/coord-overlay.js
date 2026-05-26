/** @module geometry/coord-overlay */

/**
 * Read-only Map-like coordinate view with sparse position overrides.
 *
 * Candidate scoring often changes one leaf atom or a small branch, then runs a
 * read-only audit before deciding whether to keep the move. This view avoids
 * cloning every coordinate for those short-lived probes while preserving the
 * Map methods used by layout/audit code.
 */
export class CoordOverlay {
  /**
   * @param {Map<string, {x: number, y: number}>|CoordOverlay} baseCoords - Base coordinate map or view.
   * @param {Map<string, {x: number, y: number}>} overrides - Sparse coordinate overrides.
   */
  constructor(baseCoords, overrides) {
    this.baseCoords = baseCoords;
    this.overrides = overrides;
    this.extraKeys = overlayExtraKeys(baseCoords, overrides);
    const singleOverride = overrides.size === 1 ? overrides.entries().next().value : null;
    this.singleOverrideAtomId = singleOverride?.[0] ?? null;
    this.singleOverridePosition = singleOverride?.[1] ?? null;
    this.size = (baseCoords.size ?? 0) + this.extraKeys.length;
  }

  get(atomId) {
    if (this.singleOverrideAtomId === atomId) {
      return this.singleOverridePosition;
    }
    return this.overrides.has(atomId) ? this.overrides.get(atomId) : this.baseCoords.get(atomId);
  }

  has(atomId) {
    if (this.singleOverrideAtomId === atomId) {
      return true;
    }
    return this.overrides.has(atomId) || this.baseCoords.has(atomId);
  }

  *keys() {
    for (const atomId of this.baseCoords.keys()) {
      yield atomId;
    }
    for (const atomId of this.extraKeys) {
      yield atomId;
    }
  }

  *values() {
    if (this.singleOverrideAtomId != null) {
      for (const [atomId, position] of this.baseCoords.entries()) {
        yield atomId === this.singleOverrideAtomId ? this.singleOverridePosition : position;
      }
      if (this.extraKeys.length > 0) {
        yield this.singleOverridePosition;
      }
      return;
    }
    for (const [atomId, position] of this.baseCoords.entries()) {
      yield this.overrides.has(atomId) ? this.overrides.get(atomId) : position;
    }
    for (const atomId of this.extraKeys) {
      yield this.overrides.get(atomId);
    }
  }

  *entries() {
    if (this.singleOverrideAtomId != null) {
      for (const [atomId, position] of this.baseCoords.entries()) {
        yield [atomId, atomId === this.singleOverrideAtomId ? this.singleOverridePosition : position];
      }
      if (this.extraKeys.length > 0) {
        yield [this.singleOverrideAtomId, this.singleOverridePosition];
      }
      return;
    }
    for (const [atomId, position] of this.baseCoords.entries()) {
      yield [atomId, this.overrides.has(atomId) ? this.overrides.get(atomId) : position];
    }
    for (const atomId of this.extraKeys) {
      yield [atomId, this.overrides.get(atomId)];
    }
  }

  forEach(callback, thisArg = undefined) {
    for (const [atomId, position] of this.entries()) {
      callback.call(thisArg, position, atomId, this);
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  /**
   * Materializes the overlay as a real Map. Use only when a downstream path
   * needs mutation; read-only scoring should consume the overlay directly.
   * @returns {Map<string, {x: number, y: number}>} Materialized coordinates.
   */
  toMap() {
    return new Map(this);
  }
}

function overlayExtraKeys(baseCoords, overrides) {
  const extraKeys = [];
  for (const atomId of overrides.keys()) {
    if (!baseCoords.has(atomId)) {
      extraKeys.push(atomId);
    }
  }
  return extraKeys;
}

/**
 * Returns a read-only coordinate view with one atom position overridden.
 * @param {Map<string, {x: number, y: number}>|CoordOverlay} baseCoords - Base coordinates.
 * @param {string} atomId - Atom id to override.
 * @param {{x: number, y: number}} position - Override position.
 * @returns {CoordOverlay} Coordinate overlay.
 */
export function coordOverlayWithOverride(baseCoords, atomId, position) {
  const overrides = new Map();
  overrides.set(atomId, position);
  return coordOverlayWithOverrides(baseCoords, overrides);
}

/**
 * Returns a read-only coordinate view with a sparse override map.
 * @param {Map<string, {x: number, y: number}>|CoordOverlay} baseCoords - Base coordinates.
 * @param {Map<string, {x: number, y: number}>} overrides - Sparse coordinate overrides.
 * @returns {CoordOverlay|Map<string, {x: number, y: number}>} Coordinate overlay or original base when empty.
 */
export function coordOverlayWithOverrides(baseCoords, overrides) {
  if (overrides.size === 0) {
    return baseCoords;
  }
  if (baseCoords instanceof CoordOverlay) {
    const mergedOverrides = new Map(baseCoords.overrides);
    for (const [atomId, position] of overrides) {
      mergedOverrides.set(atomId, position);
    }
    return new CoordOverlay(baseCoords.baseCoords, mergedOverrides);
  }
  return new CoordOverlay(baseCoords, overrides);
}
