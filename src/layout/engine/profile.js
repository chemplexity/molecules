/** @module profile */

import { DEFAULT_PROFILE, LAYOUT_PROFILES } from './constants.js';

/**
 * Returns the normalized profile name.
 * @param {string|undefined|null} profile - Requested profile name.
 * @returns {string} The normalized profile.
 */
export function resolveProfile(profile = DEFAULT_PROFILE) {
  if (profile == null) {
    return DEFAULT_PROFILE;
  }
  if (typeof profile !== 'string' || !LAYOUT_PROFILES.includes(profile)) {
    throw new RangeError(`layout profile must be one of ${LAYOUT_PROFILES.join(', ')}, got ${JSON.stringify(profile)}.`);
  }
  return profile;
}
