/** @module standards/policy */

import { defaultPolicy } from './defaults.js';

/**
 * Appends a post-cleanup hook name when it is not already enabled.
 * @param {object} policy - Mutable policy bundle.
 * @param {string} hookName - Hook identifier.
 * @returns {void}
 */
function ensurePostCleanupHook(policy, hookName) {
  if (!policy.postCleanupHooks.includes(hookName)) {
    policy.postCleanupHooks.push(hookName);
  }
}

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
    ensurePostCleanupHook(policy, 'ring-perimeter-correction');
    ensurePostCleanupHook(policy, 'ring-terminal-hetero-tidy');
  } else if (profile === 'organometallic') {
    policy.organometallicMode = 'ligand-first';
    ensurePostCleanupHook(policy, 'ligand-angle-tidy');
  } else if (profile === 'large-molecule') {
    policy.fragmentPackingMode = 'principal-auto';
  } else if (profile === 'reaction-fragment') {
    policy.orientationBias = 'reaction-flow';
  }

  if (traits.primaryFamily === 'bridged') {
    policy.bridgedMode = 'template-first';
    if (traits.mixedMode) {
      ensurePostCleanupHook(policy, 'bridged-bond-tidy');
    }
  }
  if (traits.primaryFamily === 'macrocycle') {
    policy.macrocycleMode = 'ellipse';
    ensurePostCleanupHook(policy, 'ring-perimeter-correction');
    ensurePostCleanupHook(policy, 'ring-terminal-hetero-tidy');
  }
  if ((traits.ringCount ?? 0) > 0 && traits.primaryFamily !== 'macrocycle') {
    ensurePostCleanupHook(policy, 'ring-substituent-tidy');
  }
  if (traits.containsMetal) {
    policy.organometallicMode = 'ligand-first';
    ensurePostCleanupHook(policy, 'ligand-angle-tidy');
  }
  if (traits.containsOrthogonalHypervalentCenter) {
    ensurePostCleanupHook(policy, 'hypervalent-angle-tidy');
  }
  if (traits.hasDisconnectedComponents) {
    policy.fragmentPackingMode = traits.principalIsTall ? 'principal-below' : 'principal-right';
  }

  return policy;
}
