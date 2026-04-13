/** @module placement/fragment-packing */

import { computeBounds } from '../geometry/bounds.js';
import { createFragmentPlan } from '../model/fragment-plan.js';

function rolePriority(role) {
  switch (role) {
    case 'principal':
      return 0;
    case 'counter-ion':
      return 1;
    case 'spectator':
      return 2;
    case 'solvent-like':
      return 3;
    default:
      return 4;
  }
}

function compareFragmentPlans(firstPlacement, secondPlacement) {
  const roleDelta = rolePriority(firstPlacement.role) - rolePriority(secondPlacement.role);
  if (roleDelta !== 0) {
    return roleDelta;
  }
  return String(firstPlacement.componentId).localeCompare(String(secondPlacement.componentId), 'en', { numeric: true });
}

function resolvePrincipalFragment(componentPlacements) {
  return componentPlacements.find(placement => placement.role === 'principal')
    ?? componentPlacements.find(placement => placement.anchored)
    ?? componentPlacements[0]
    ?? null;
}

function resolvePackingMode(componentPlacements, requestedMode) {
  if (requestedMode && requestedMode !== 'principal-auto') {
    return requestedMode;
  }
  const principal = resolvePrincipalFragment(componentPlacements);
  if (!principal) {
    return 'principal-right';
  }
  const bounds = computeBounds(principal.coords, principal.atomIds);
  if (!bounds) {
    return 'principal-right';
  }
  return bounds.height > bounds.width ? 'principal-below' : 'principal-right';
}

/**
 * Packs disconnected component placements left-to-right, preserving anchored
 * components and shifting only the unanchored ones.
 * @param {object[]} componentPlacements - Per-component placement records.
 * @param {number} bondLength - Target bond length.
 * @param {object} [policy] - Standards-policy bundle.
 * @returns {Map<string, {x: number, y: number}>} Packed coordinates.
 */
export function packComponentPlacements(componentPlacements, bondLength, policy = {}) {
  const fragmentPlans = componentPlacements.map((placement, index) => createFragmentPlan({
    componentId: placement.componentId ?? `fragment:${index}`,
    atomIds: placement.atomIds,
    coords: placement.coords,
    anchored: placement.anchored,
    role: placement.role ?? (index === 0 ? 'principal' : 'spectator'),
    anchorPreference: policy.fragmentPackingMode ?? null
  }));
  const gap = bondLength * 3;
  const packed = new Map();
  let cursorX = 0;
  let cursorY = 0;
  const packingMode = resolvePackingMode(fragmentPlans, policy.fragmentPackingMode ?? 'principal-right');
  const principalFragment = resolvePrincipalFragment(fragmentPlans);

  const anchoredBounds = fragmentPlans
    .filter(placement => placement.anchored)
    .map(placement => computeBounds(placement.coords, placement.atomIds))
    .filter(Boolean);
  if (anchoredBounds.length > 0) {
    if (packingMode === 'principal-below') {
      cursorY = Math.min(...anchoredBounds.map(bounds => bounds.minY)) - gap;
    } else {
      cursorX = Math.max(...anchoredBounds.map(bounds => bounds.maxX)) + gap;
    }
  }

  const packedPlans = [...fragmentPlans].sort(compareFragmentPlans);
  const auxiliaryFragments = [];
  for (const placement of packedPlans) {
    const bounds = computeBounds(placement.coords, placement.atomIds);
    if (!bounds) {
      continue;
    }
    if (placement.anchored) {
      for (const [atomId, position] of placement.coords) {
        packed.set(atomId, position);
      }
      continue;
    }
    if (placement === principalFragment) {
      const dx = packingMode === 'principal-below' ? -bounds.centerX : cursorX - bounds.minX;
      const dy = packingMode === 'principal-below' ? cursorY - bounds.maxY : -bounds.centerY;
      for (const atomId of placement.atomIds) {
        const position = placement.coords.get(atomId);
        if (!position) {
          continue;
        }
        packed.set(atomId, { x: position.x + dx, y: position.y + dy });
      }
      if (packingMode === 'principal-below') {
        cursorY = (cursorY - bounds.maxY) - gap;
      } else {
        cursorX = (cursorX - bounds.minX) + bounds.width + gap;
      }
      continue;
    }
    auxiliaryFragments.push({ placement, bounds });
  }

  for (const { placement, bounds } of auxiliaryFragments) {
    const dx = packingMode === 'principal-below' ? -bounds.centerX : cursorX - bounds.minX;
    const dy = packingMode === 'principal-below' ? cursorY - bounds.maxY : -bounds.centerY;
    for (const atomId of placement.atomIds) {
      const position = placement.coords.get(atomId);
      if (!position) {
        continue;
      }
      packed.set(atomId, { x: position.x + dx, y: position.y + dy });
    }
    if (packingMode === 'principal-below') {
      cursorY -= bounds.height + gap;
    } else {
      cursorX += bounds.width + gap;
    }
  }

  return packed;
}
