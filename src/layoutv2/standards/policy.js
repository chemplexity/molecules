/** @module standards/policy */

import { defaultPolicy } from './defaults.js';

/**
 * Resolves the active standards-inspired policy bundle for a layout run.
 * This is intentionally a concrete policy struct, not a rule engine.
 * @param {string} profile - Normalized profile name.
 * @param {object} [traits] - Molecule/layout traits.
 * @returns {object} Resolved policy bundle.
 */
export function resolvePolicy(profile, traits = {}) {
  const policy = defaultPolicy();

  if (profile === 'macrocycle') {
    policy.macrocycleMode = 'ellipse';
  } else if (profile === 'organometallic') {
    policy.organometallicMode = 'ligand-first';
  } else if (profile === 'large-molecule') {
    policy.fragmentPackingMode = 'principal-auto';
  } else if (profile === 'reaction-fragment') {
    policy.orientationBias = 'reaction-flow';
  }

  if (traits.primaryFamily === 'bridged') {
    policy.bridgedMode = 'template-first';
  }
  if (traits.primaryFamily === 'macrocycle') {
    policy.macrocycleMode = 'ellipse';
  }
  if (traits.containsMetal) {
    policy.organometallicMode = 'ligand-first';
  }
  if (traits.hasDisconnectedComponents) {
    policy.fragmentPackingMode = traits.principalIsTall ? 'principal-below' : 'principal-right';
  }

  return policy;
}
