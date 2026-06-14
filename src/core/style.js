/** @module core/style */

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFAULT_RING_FILL_OPACITY = 0.25;

function _expandHexColor(value) {
  const hex = value.toLowerCase();
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

/**
 * Returns whether the value is a supported serialized style color.
 * @param {unknown} value - Candidate color value.
 * @returns {boolean} True when the value is a supported color.
 */
export function isStyleColor(value) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

/**
 * Normalizes an optional style color.
 * @param {unknown} value - Candidate color value.
 * @returns {string|null} Normalized hex color, or null when omitted.
 */
export function normalizeStyleColor(value) {
  if (value == null || value === '') {
    return null;
  }
  if (!isStyleColor(value)) {
    throw new RangeError(`Style color must be #rgb or #rrggbb, got ${JSON.stringify(value)}.`);
  }
  return _expandHexColor(value);
}

/**
 * Normalizes an optional opacity value.
 * @param {unknown} value - Candidate opacity value.
 * @returns {number|null} Clamped opacity, or null when omitted.
 */
export function normalizeOpacity(value) {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new RangeError(`Style opacity must be a finite number, got ${JSON.stringify(value)}.`);
  }
  return Math.min(1, Math.max(0, numeric));
}

/**
 * Normalizes an atom or bond visual style object.
 * @param {object|null|undefined} style - Candidate style object.
 * @returns {{color?: string, opacity?: number}|null} Normalized style, or null when empty.
 */
export function normalizeVisualStyle(style) {
  if (style == null) {
    return null;
  }
  if (typeof style !== 'object' || Array.isArray(style)) {
    throw new TypeError(`Style must be an object or null, got ${JSON.stringify(style)}.`);
  }
  const normalized = {};
  const color = normalizeStyleColor(style.color);
  const opacity = normalizeOpacity(style.opacity);
  if (color !== null) {
    normalized.color = color;
  }
  if (opacity !== null) {
    normalized.opacity = opacity;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

/**
 * Normalizes an atom visual style object.
 * @param {object|null|undefined} style - Candidate style object.
 * @returns {{color?: string, opacity?: number}|null} Normalized style.
 */
export function normalizeAtomStyle(style) {
  return normalizeVisualStyle(style);
}

/**
 * Normalizes a bond visual style object.
 * @param {object|null|undefined} style - Candidate style object.
 * @returns {{color?: string, opacity?: number}|null} Normalized style.
 */
export function normalizeBondStyle(style) {
  return normalizeVisualStyle(style);
}

/**
 * Returns a defensive copy of a normalized visual style.
 * @param {object|null|undefined} style - Style object.
 * @returns {{color?: string, opacity?: number}|null} Style clone.
 */
export function cloneVisualStyle(style) {
  const normalized = normalizeVisualStyle(style);
  return normalized ? { ...normalized } : null;
}

/**
 * Returns a stable sorted ring atom-id key.
 * @param {Iterable<string>} atomIds - Ring atom ids.
 * @returns {string} Stable key.
 */
export function ringAtomKey(atomIds) {
  return [...atomIds].sort().join('\0');
}

/**
 * Returns a DOM/SVG-safe id for a ring-fill atom set.
 * @param {Iterable<string>} atomIds - Ring atom ids.
 * @returns {string} Safe renderer id.
 */
export function ringFillDomId(atomIds) {
  return `ring-fill:${normalizeRingAtomIds(atomIds).map(atomId => encodeURIComponent(atomId)).join('|')}`;
}

/**
 * Normalizes ring atom ids for storage.
 * @param {Iterable<string>} atomIds - Candidate atom ids.
 * @returns {string[]} Canonically sorted atom ids.
 */
export function normalizeRingAtomIds(atomIds) {
  if (!atomIds || typeof atomIds[Symbol.iterator] !== 'function') {
    throw new TypeError('Ring fill atomIds must be an iterable of atom ids.');
  }
  const unique = [...new Set([...atomIds].map(atomId => String(atomId)))].filter(atomId => atomId.length > 0);
  if (unique.length < 3) {
    throw new RangeError('Ring fill atomIds must contain at least three unique atom ids.');
  }
  return unique.sort();
}

/**
 * Normalizes a molecule-level ring-fill style entry.
 * @param {object} entry - Ring fill entry.
 * @returns {{id: string, atomIds: string[], color: string, opacity: number}} Normalized ring fill.
 */
export function normalizeRingFillStyle(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('Ring fill style must be an object.');
  }
  const atomIds = normalizeRingAtomIds(entry.atomIds);
  const color = normalizeStyleColor(entry.color);
  if (color === null) {
    throw new RangeError('Ring fill style requires a color.');
  }
  const opacity = normalizeOpacity(entry.opacity) ?? DEFAULT_RING_FILL_OPACITY;
  const id = entry.id == null || entry.id === '' ? `ring-fill:${ringAtomKey(atomIds)}` : String(entry.id);
  return { id, atomIds, color, opacity };
}

/**
 * Resolves a stored style color without throwing during rendering.
 * @param {object|null|undefined} style - Stored style object.
 * @returns {string|null} Color override, or null.
 */
export function styleColor(style) {
  return isStyleColor(style?.color) ? _expandHexColor(style.color) : null;
}

/**
 * Resolves a stored opacity without throwing during rendering.
 * @param {object|null|undefined} style - Stored style object.
 * @param {number} [fallback] - Fallback opacity.
 * @returns {number} Opacity value.
 */
export function styleOpacity(style, fallback = 1) {
  if (style?.opacity == null || style.opacity === '') {
    return fallback;
  }
  const numeric = Number(style.opacity);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, numeric));
}
