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

/**
 * Returns the sign of a fragment charge as `-1`, `0`, or `1`.
 * @param {number} value - Net fragment charge.
 * @returns {number} Charge sign bucket.
 */
function chargeSign(value) {
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}

/**
 * Returns whether a fragment should become the visual packing hub for an ionic
 * multi-component layout.
 * @param {object} candidate - Fragment plan candidate.
 * @param {object[]} componentPlacements - All fragment plans.
 * @returns {boolean} `true` when the candidate should anchor the packing.
 */
function isIonicHubCandidate(candidate, componentPlacements) {
  const candidateSign = chargeSign(candidate.netCharge ?? 0);
  if (candidateSign === 0 || !(candidate.containsMetal || (candidate.heavyAtomCount ?? 0) <= 3)) {
    return false;
  }
  const chargedPeers = componentPlacements.filter(placement => placement !== candidate && chargeSign(placement.netCharge ?? 0) !== 0);
  if (chargedPeers.length < 2) {
    return false;
  }
  if (!chargedPeers.every(placement => chargeSign(placement.netCharge ?? 0) === -candidateSign)) {
    return false;
  }
  const oppositeMagnitude = chargedPeers.reduce((sum, placement) => sum + Math.abs(placement.netCharge ?? 0), 0);
  return oppositeMagnitude >= Math.abs(candidate.netCharge ?? 0);
}

/**
 * Sorts ionic hub candidates by metal-likeness, charge magnitude, and size.
 * @param {object} firstPlacement - First fragment plan.
 * @param {object} secondPlacement - Second fragment plan.
 * @returns {number} Comparison result.
 */
function compareIonicHubCandidates(firstPlacement, secondPlacement) {
  if (!!firstPlacement.containsMetal !== !!secondPlacement.containsMetal) {
    return firstPlacement.containsMetal ? -1 : 1;
  }
  const chargeDelta = Math.abs(secondPlacement.netCharge ?? 0) - Math.abs(firstPlacement.netCharge ?? 0);
  if (chargeDelta !== 0) {
    return chargeDelta;
  }
  const sizeDelta = (firstPlacement.heavyAtomCount ?? 0) - (secondPlacement.heavyAtomCount ?? 0);
  if (sizeDelta !== 0) {
    return sizeDelta;
  }
  return compareFragmentPlans(firstPlacement, secondPlacement);
}

function resolvePrincipalFragment(componentPlacements) {
  const anchoredPrincipal =
    componentPlacements.find(placement => placement.role === 'principal' && placement.anchored) ?? componentPlacements.find(placement => placement.anchored) ?? null;
  if (anchoredPrincipal) {
    return anchoredPrincipal;
  }

  const ionicHub = componentPlacements.filter(placement => isIonicHubCandidate(placement, componentPlacements)).sort(compareIonicHubCandidates)[0] ?? null;
  if (ionicHub) {
    return ionicHub;
  }

  return componentPlacements.find(placement => placement.role === 'principal') ?? componentPlacements.find(placement => placement.anchored) ?? componentPlacements[0] ?? null;
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
 * Writes a translated fragment into the packed coordinate map.
 * @param {Map<string, {x: number, y: number}>} packed - Packed coordinate map.
 * @param {object} placement - Fragment plan.
 * @param {number} dx - X translation.
 * @param {number} dy - Y translation.
 * @returns {void}
 */
function translateFragment(packed, placement, dx, dy) {
  for (const atomId of placement.atomIds) {
    const position = placement.coords.get(atomId);
    if (!position) {
      continue;
    }
    packed.set(atomId, { x: position.x + dx, y: position.y + dy });
  }
}

/**
 * Packs auxiliary fragments on both sides of a central principal fragment.
 * @param {Map<string, {x: number, y: number}>} packed - Packed coordinate map.
 * @param {object} principalFragment - Central fragment plan.
 * @param {{minX: number, maxX: number, minY: number, maxY: number, centerX: number, centerY: number}} principalBounds - Principal fragment bounds.
 * @param {Array<{placement: object, bounds: {minX: number, maxX: number, minY: number, maxY: number, centerX: number, centerY: number}}>} auxiliaryFragments - Auxiliary fragments with bounds.
 * @param {number} gap - Inter-fragment gap distance.
 * @param {string} packingMode - Packing direction mode.
 * @returns {void}
 */
function packBalancedAroundPrincipal(packed, principalFragment, principalBounds, auxiliaryFragments, gap, packingMode) {
  translateFragment(packed, principalFragment, -principalBounds.centerX, -principalBounds.centerY);

  if (packingMode === 'principal-below') {
    let lowerEdge = principalBounds.minY - principalBounds.centerY;
    let upperEdge = principalBounds.maxY - principalBounds.centerY;
    for (const { placement, bounds } of auxiliaryFragments) {
      const lowerSpan = Math.abs(lowerEdge);
      const upperSpan = Math.abs(upperEdge);
      const placeAbove = upperSpan <= lowerSpan;
      const dx = -bounds.centerX;
      const dy = placeAbove ? upperEdge + gap - bounds.minY : lowerEdge - gap - bounds.maxY;
      translateFragment(packed, placement, dx, dy);
      if (placeAbove) {
        upperEdge = dy + bounds.maxY;
      } else {
        lowerEdge = dy + bounds.minY;
      }
    }
    return;
  }

  let leftEdge = principalBounds.minX - principalBounds.centerX;
  let rightEdge = principalBounds.maxX - principalBounds.centerX;
  for (const { placement, bounds } of auxiliaryFragments) {
    const leftSpan = Math.abs(leftEdge);
    const rightSpan = Math.abs(rightEdge);
    const placeRight = rightSpan <= leftSpan;
    const dx = placeRight ? rightEdge + gap - bounds.minX : leftEdge - gap - bounds.maxX;
    const dy = -bounds.centerY;
    translateFragment(packed, placement, dx, dy);
    if (placeRight) {
      rightEdge = dx + bounds.maxX;
    } else {
      leftEdge = dx + bounds.minX;
    }
  }
}

/**
 * Packs disconnected component placements while preserving anchored
 * components and shifting only the unanchored ones.
 * @param {object[]} componentPlacements - Per-component placement records.
 * @param {number} bondLength - Target bond length.
 * @param {object} [policy] - Standards-policy bundle.
 * @returns {Map<string, {x: number, y: number}>} Packed coordinates.
 */
export function packComponentPlacements(componentPlacements, bondLength, policy = {}) {
  const fragmentPlans = componentPlacements.map((placement, index) =>
    createFragmentPlan({
      componentId: placement.componentId ?? `fragment:${index}`,
      atomIds: placement.atomIds,
      coords: placement.coords,
      anchored: placement.anchored,
      role: placement.role ?? (index === 0 ? 'principal' : 'spectator'),
      anchorPreference: policy.fragmentPackingMode ?? null,
      heavyAtomCount: placement.heavyAtomCount ?? 0,
      netCharge: placement.netCharge ?? 0,
      containsMetal: placement.containsMetal ?? false
    })
  );
  const gap = bondLength * 2;
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
      let minY = anchoredBounds[0].minY;
      for (let i = 1; i < anchoredBounds.length; i++) { if (anchoredBounds[i].minY < minY) { minY = anchoredBounds[i].minY; } }
      cursorY = minY - gap;
    } else {
      let maxX = anchoredBounds[0].maxX;
      for (let i = 1; i < anchoredBounds.length; i++) { if (anchoredBounds[i].maxX > maxX) { maxX = anchoredBounds[i].maxX; } }
      cursorX = maxX + gap;
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
      translateFragment(packed, placement, dx, dy);
      if (packingMode === 'principal-below') {
        cursorY = dy + bounds.minY - gap;
      } else {
        cursorX = dx + bounds.maxX + gap;
      }
      continue;
    }
    auxiliaryFragments.push({ placement, bounds });
  }

  if (principalFragment && !principalFragment.anchored && auxiliaryFragments.length >= 2 && isIonicHubCandidate(principalFragment, fragmentPlans)) {
    packed.clear();
    const principalBounds = computeBounds(principalFragment.coords, principalFragment.atomIds);
    if (principalBounds) {
      packBalancedAroundPrincipal(packed, principalFragment, principalBounds, auxiliaryFragments, gap, packingMode);
      return packed;
    }
  }

  for (const { placement, bounds } of auxiliaryFragments) {
    const dx = packingMode === 'principal-below' ? -bounds.centerX : cursorX - bounds.minX;
    const dy = packingMode === 'principal-below' ? cursorY - bounds.maxY : -bounds.centerY;
    translateFragment(packed, placement, dx, dy);
    if (packingMode === 'principal-below') {
      cursorY -= bounds.height + gap;
    } else {
      cursorX += bounds.width + gap;
    }
  }

  return packed;
}
