/** @module model/fragment-plan */

/**
 * Creates a fragment-packing descriptor.
 * @param {object} input - Fragment-plan input.
 * @param {string} input.componentId - Component or fragment ID.
 * @param {string[]} input.atomIds - Participating atom IDs.
 * @param {Map<string, {x: number, y: number}>} input.coords - Fragment coordinates.
 * @param {boolean} [input.anchored] - Whether the fragment is already anchored.
 * @param {string} [input.role] - Fragment role.
 * @param {string|null} [input.anchorPreference] - Preferred packing direction.
 * @returns {{componentId: string, atomIds: string[], coords: Map<string, {x: number, y: number}>, anchored: boolean, role: string, anchorPreference: string|null}} Fragment plan.
 */
export function createFragmentPlan(input) {
  return {
    componentId: input.componentId,
    atomIds: [...input.atomIds],
    coords: new Map([...input.coords.entries()].map(([atomId, position]) => [atomId, { ...position }])),
    anchored: input.anchored ?? false,
    role: input.role ?? 'spectator',
    anchorPreference: input.anchorPreference ?? null
  };
}
