/** @module scaffold/choose-scaffold */

import { buildScaffoldPlan } from '../model/scaffold-plan.js';

/**
 * Chooses the scaffold plan for a connected component.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @returns {object} Scaffold plan.
 */
export function chooseScaffoldPlan(layoutGraph, component) {
  return buildScaffoldPlan(layoutGraph, component);
}
