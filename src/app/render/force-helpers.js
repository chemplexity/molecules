/** @module app/render/force-helpers */

import { atomRadius, renderBondOrder } from './helpers.js';

export const FORCE_LAYOUT_BOND_LENGTH = 41;
export const FORCE_LAYOUT_H_BOND_LENGTH = 20;
export const FORCE_LAYOUT_MULTIPLE_BOND_FACTOR = 0.93;
export const FORCE_LAYOUT_AROMATIC_BOND_FACTOR = 0.96;
export const FORCE_LAYOUT_HEAVY_ANCHOR_RADIUS = 4;
export const FORCE_LAYOUT_HEAVY_ANCHOR_STRENGTH = 0.68;
export const FORCE_LAYOUT_HEAVY_REPULSION = -28;
export const FORCE_LAYOUT_H_REPULSION = -25;
export const FORCE_LAYOUT_HH_REPULSION_DISTANCE = 40;
export const FORCE_LAYOUT_HH_REPULSION_STRENGTH = 30.0;
export const FORCE_LAYOUT_H_PLACEMENT_STRENGTH = 0.22;
export const FORCE_LAYOUT_FIT_PAD = 40;
export const FORCE_LAYOUT_INITIAL_FIT_PAD = 14;
export const FORCE_LAYOUT_INITIAL_H_RADIUS_SCALE = 0.4;
export const FORCE_LAYOUT_INITIAL_ZOOM_MULTIPLIER = 1.3;
export const FORCE_LAYOUT_KEEP_IN_VIEW_ALPHA_MIN = 0.08;
export const FORCE_LAYOUT_INITIAL_KEEP_IN_VIEW_TICKS = 8;
export const FORCE_LAYOUT_EDIT_KEEP_IN_VIEW_TICKS = 24;
export const FORCE_LAYOUT_INITIAL_SETTLE_TICKS = 26;
export const FORCE_LAYOUT_INITIAL_SETTLE_ALPHA = 0.7;
export const FORCE_LAYOUT_INITIAL_RESTART_ALPHA = 0.08;
export const FORCE_LAYOUT_EDIT_RESTART_ALPHA = 0.005;
const FORCE_LAYOUT_HEAVY_ANCHOR_SOFT_RATIO = 0.14;

/**
 * Converts a Molecule instance into a plain graph object with node and link arrays suitable for D3 force simulation.
 * @param {object} molecule - Molecule instance with `atoms` and `bonds` Maps.
 * @returns {{nodes: Array<object>, links: Array<object>}} Graph with D3-compatible nodes and links.
 */
export function convertMolecule(molecule) {
  const atomEntries = [...molecule.atoms.entries()];
  const idToIndex = new Map(atomEntries.map(([id], index) => [id, index]));

  const nodes = atomEntries.map(([id, atom]) => ({
    id,
    name: atom.name,
    protons: atom.properties.protons,
    charge: atom.getCharge(),
    aromatic: atom.isAromatic(),
    anchorX: null,
    anchorY: null
  }));

  const links = [...molecule.bonds.values()].map(bond => ({
    id: bond.id,
    source: idToIndex.get(bond.atoms[0]),
    target: idToIndex.get(bond.atoms[1]),
    order: renderBondOrder(bond),
    aromatic: bond.properties.aromatic ?? false
  }));

  return { nodes, links };
}

/**
 * Returns true when the given force-simulation node represents a hydrogen atom.
 * @param {{name?: string}} node - A force-simulation node object.
 * @returns {boolean} True if the node's name is `'H'`.
 */
export function isHydrogenNode(node) {
  return node?.name === 'H';
}

/**
 * Returns the ideal link distance (in pixels) for a force-simulation bond based on whether either endpoint is hydrogen and the bond order.
 * @param {{source: object, target: object, order: number}} link - A force-simulation link with resolved source/target node objects.
 * @returns {number} Distance in pixels.
 */
export function forceLinkDistance(link) {
  const source = typeof link.source === 'object' ? link.source : null;
  const target = typeof link.target === 'object' ? link.target : null;
  let distance = isHydrogenNode(source) || isHydrogenNode(target) ? FORCE_LAYOUT_H_BOND_LENGTH : FORCE_LAYOUT_BOND_LENGTH;

  if (link.order === 3) {
    distance *= FORCE_LAYOUT_MULTIPLE_BOND_FACTOR * 0.92;
  } else if (link.order === 2) {
    distance *= FORCE_LAYOUT_MULTIPLE_BOND_FACTOR;
  } else if (link.order === 1.5) {
    distance *= FORCE_LAYOUT_AROMATIC_BOND_FACTOR;
  }

  return distance;
}

/**
 * Creates a D3 custom force that pulls heavy atoms toward their anchor positions within a given radius.
 * @param {number} [radius] - Distance from anchor within which the soft force applies.
 * @param {number} [strength] - Base strength coefficient for the anchor pull.
 * @returns {object} D3-compatible force function with an `initialize` method.
 */
export function createForceAnchorRadiusForce(radius = FORCE_LAYOUT_HEAVY_ANCHOR_RADIUS, strength = FORCE_LAYOUT_HEAVY_ANCHOR_STRENGTH) {
  let nodes = [];
  const softStrength = strength * FORCE_LAYOUT_HEAVY_ANCHOR_SOFT_RATIO;
  const hardStrength = Math.max(0, strength - softStrength);
  function force(alpha) {
    for (const node of nodes) {
      if (isHydrogenNode(node)) {
        continue;
      }
      if (!Number.isFinite(node.anchorX) || !Number.isFinite(node.anchorY)) {
        continue;
      }
      if (node.fx != null || node.fy != null) {
        continue;
      }
      const dx = node.x - node.anchorX;
      const dy = node.y - node.anchorY;
      const dist = Math.hypot(dx, dy);
      const inv = 1 / dist;
      if (!(dist > 1e-6)) {
        continue;
      }
      const pull = (dist * softStrength + Math.max(0, dist - radius) * hardStrength) * alpha;
      node.vx -= dx * inv * pull;
      node.vy -= dy * inv * pull;
    }
  }
  force.initialize = initialNodes => {
    nodes = initialNodes;
  };
  return force;
}

/**
 * Creates a D3 custom force that repels unrelated hydrogen nodes from each other when they are within a maximum distance.
 * @param {number} [maxDistance] - Maximum distance at which the repulsion force acts.
 * @param {number} [strength] - Strength coefficient for the repulsion.
 * @param {Array<object>} [links] - Simulation links, preferably after D3 link resolution.
 * @returns {object} D3-compatible force function with `initialize` and `links` methods.
 */
export function createForceHydrogenRepulsionForce(maxDistance = FORCE_LAYOUT_HH_REPULSION_DISTANCE, strength = FORCE_LAYOUT_HH_REPULSION_STRENGTH, links = []) {
  let nodes = [];
  let currentLinks = links;
  const maxDistanceSq = maxDistance * maxDistance;

  const resolveNode = value => {
    if (typeof value === 'object') {
      return value;
    }
    return Array.isArray(nodes) ? nodes[value] : null;
  };

  function force(alpha) {
    const hydrogens = nodes.filter(node => isHydrogenNode(node) && node.fx == null && node.fy == null);
    const parentByHydrogen = new Map();
    for (const link of currentLinks) {
      const source = resolveNode(link.source);
      const target = resolveNode(link.target);
      if (!source || !target) {
        continue;
      }
      const sourceIsHydrogen = isHydrogenNode(source);
      const targetIsHydrogen = isHydrogenNode(target);
      if (sourceIsHydrogen && !targetIsHydrogen) {
        parentByHydrogen.set(source, target.id ?? target);
      } else if (targetIsHydrogen && !sourceIsHydrogen) {
        parentByHydrogen.set(target, source.id ?? source);
      }
    }

    for (let i = 0; i < hydrogens.length; i++) {
      const a = hydrogens[i];
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) {
        continue;
      }
      for (let j = i + 1; j < hydrogens.length; j++) {
        const b = hydrogens[j];
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) {
          continue;
        }
        const parentA = parentByHydrogen.get(a);
        if (parentA !== undefined && parentA === parentByHydrogen.get(b)) {
          continue;
        }
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq >= maxDistanceSq) {
          continue;
        }
        if (distSq < 1e-6) {
          dx = 1e-3;
          dy = 0;
          distSq = dx * dx;
        }
        const dist = Math.sqrt(distSq);
        const overlap = (maxDistance - dist) / maxDistance;
        const push = overlap * strength * alpha;
        const ux = dx / dist;
        const uy = dy / dist;
        a.vx -= ux * push;
        a.vy -= uy * push;
        b.vx += ux * push;
        b.vy += uy * push;
      }
    }
  }
  force.initialize = initialNodes => {
    nodes = initialNodes;
  };
  force.links = value => {
    if (value === undefined) {
      return currentLinks;
    }
    currentLinks = value;
    return force;
  };
  return force;
}

/**
 * Creates a D3 custom force that keeps terminal hydrogens in stable open
 * angular slots around their current heavy-atom parent.
 * @param {Array<object>} [links] - Simulation links, preferably after D3 link resolution.
 * @param {object} [options] - Placement options.
 * @param {number} [options.distance] - Target H-parent distance.
 * @param {number} [options.strength] - Pull strength toward the target slot when rigid placement is disabled.
 * @param {boolean} [options.rigid] - When true, places hydrogens directly on parent-relative slots.
 * @returns {object} D3-compatible force function with `initialize` and `links` methods.
 */
export function createForceHydrogenPlacementForce(links = [], { distance = FORCE_LAYOUT_H_BOND_LENGTH, strength = FORCE_LAYOUT_H_PLACEMENT_STRENGTH, rigid = true } = {}) {
  let nodes = [];
  let currentLinks = links;

  const resolveNode = value => {
    if (typeof value === 'object') {
      return value;
    }
    return Array.isArray(nodes) ? nodes[value] : null;
  };

  function force(alpha) {
    const hydrogensByParent = new Map();
    const occupiedAnglesByParent = new Map();

    for (const link of currentLinks) {
      const source = resolveNode(link.source);
      const target = resolveNode(link.target);
      if (!source || !target) {
        continue;
      }
      const sourceIsHydrogen = isHydrogenNode(source);
      const targetIsHydrogen = isHydrogenNode(target);
      if (sourceIsHydrogen && !targetIsHydrogen) {
        if (!hydrogensByParent.has(target)) {
          hydrogensByParent.set(target, []);
        }
        hydrogensByParent.get(target).push(source);
      } else if (targetIsHydrogen && !sourceIsHydrogen) {
        if (!hydrogensByParent.has(source)) {
          hydrogensByParent.set(source, []);
        }
        hydrogensByParent.get(source).push(target);
      } else if (!sourceIsHydrogen && !targetIsHydrogen && Number.isFinite(source.x) && Number.isFinite(source.y) && Number.isFinite(target.x) && Number.isFinite(target.y)) {
        if (!occupiedAnglesByParent.has(source)) {
          occupiedAnglesByParent.set(source, []);
        }
        if (!occupiedAnglesByParent.has(target)) {
          occupiedAnglesByParent.set(target, []);
        }
        occupiedAnglesByParent.get(source).push(Math.atan2(target.y - source.y, target.x - source.x));
        occupiedAnglesByParent.get(target).push(Math.atan2(source.y - target.y, source.x - target.x));
      }
    }

    for (const [parent, hydrogens] of hydrogensByParent) {
      if (!Number.isFinite(parent.x) || !Number.isFinite(parent.y)) {
        continue;
      }
      const sortedHydrogens = [...hydrogens].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const angles = chooseOpenAngles(occupiedAnglesByParent.get(parent) ?? [], sortedHydrogens.length);
      sortedHydrogens.forEach((hydrogenNode, index) => {
        if (hydrogenNode.fx != null || hydrogenNode.fy != null) {
          return;
        }
        let angle = angles[index] ?? (Math.PI * 2 * index) / sortedHydrogens.length;
        if (hydrogenNode.forcePlacementParentId === parent.id && Number.isFinite(hydrogenNode.forcePlacementAngle)) {
          angle = hydrogenNode.forcePlacementAngle;
        } else {
          hydrogenNode.forcePlacementParentId = parent.id;
          hydrogenNode.forcePlacementAngle = angle;
        }
        const targetX = parent.x + Math.cos(angle) * distance;
        const targetY = parent.y + Math.sin(angle) * distance;
        if (rigid || !Number.isFinite(hydrogenNode.x) || !Number.isFinite(hydrogenNode.y)) {
          hydrogenNode.x = targetX;
          hydrogenNode.y = targetY;
          hydrogenNode.vx = 0;
          hydrogenNode.vy = 0;
          return;
        }
        hydrogenNode.vx -= (hydrogenNode.x - targetX) * strength * alpha;
        hydrogenNode.vy -= (hydrogenNode.y - targetY) * strength * alpha;
      });
    }
  }

  force.initialize = initialNodes => {
    nodes = initialNodes;
  };
  force.links = value => {
    if (value === undefined) {
      return currentLinks;
    }
    currentLinks = value;
    return force;
  };
  return force;
}

/**
 * Returns true when two D3 zoom transforms differ by more than the given epsilon in any of x, y, or k.
 * @param {object|null} a - First zoom transform (or null).
 * @param {object|null} b - Second zoom transform (or null).
 * @param {number} [epsilon] - Tolerance for floating-point comparison.
 * @returns {boolean} True if the transforms are meaningfully different.
 */
export function zoomTransformsDiffer(a, b, epsilon = 0.001) {
  if (!a || !b) {
    return true;
  }
  return Math.abs(a.k - b.k) > epsilon || Math.abs(a.x - b.x) > epsilon || Math.abs(a.y - b.y) > epsilon;
}

function normalizeAngle(theta) {
  let angle = theta % (Math.PI * 2);
  if (angle < 0) {
    angle += Math.PI * 2;
  }
  return angle;
}

function chooseOpenAngles(occupiedAngles, count) {
  if (count <= 0) {
    return [];
  }
  if (!occupiedAngles.length) {
    return Array.from({ length: count }, (_, index) => (Math.PI * 2 * index) / count);
  }

  const working = occupiedAngles.map(normalizeAngle);
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const sorted = [...working].sort((a, b) => a - b);
    let bestAngle = sorted[0];
    let bestGap = -1;
    for (let idx = 0; idx < sorted.length; idx++) {
      const start = sorted[idx];
      const end = idx === sorted.length - 1 ? sorted[0] + Math.PI * 2 : sorted[idx + 1];
      const gap = end - start;
      if (gap > bestGap) {
        bestGap = gap;
        bestAngle = normalizeAngle(start + gap / 2);
      }
    }
    working.push(bestAngle);
    chosen.push(bestAngle);
  }
  return chosen;
}

/**
 * Positions hydrogen nodes radially around their parent heavy atom, choosing open angles not occupied by other bonds.
 * @param {object} parentNode - The parent heavy-atom simulation node with finite x/y coordinates.
 * @param {Array<object>} hydrogens - Hydrogen simulation nodes to reposition.
 * @param {Array<object>} links - All current simulation links (used to determine occupied angles).
 * @param {object} [options] - Optional placement parameters.
 * @param {number} [options.distance] - Radial distance from parent at which to place each hydrogen.
 * @param {Set<string>} [options.excludeIds] - Node IDs to exclude when computing occupied angles.
 * @param {Array<object>} [options.nodes] - Full node array, required when link source/target are indices rather than objects.
 */
export function placeHydrogensAroundParent(parentNode, hydrogens, links, { distance = FORCE_LAYOUT_H_BOND_LENGTH, excludeIds = null, nodes = null } = {}) {
  if (!parentNode || !Number.isFinite(parentNode.x) || !Number.isFinite(parentNode.y) || hydrogens.length === 0) {
    return;
  }
  const excluded = excludeIds ?? new Set();
  const occupiedAngles = [];
  for (const link of links) {
    const source = typeof link.source === 'object' ? link.source : Array.isArray(nodes) ? nodes[link.source] : null;
    const target = typeof link.target === 'object' ? link.target : Array.isArray(nodes) ? nodes[link.target] : null;
    if (source !== parentNode && target !== parentNode) {
      continue;
    }
    const other = source === parentNode ? target : source;
    if (!other || excluded.has(other.id)) {
      continue;
    }
    if (!Number.isFinite(other.x) || !Number.isFinite(other.y)) {
      continue;
    }
    occupiedAngles.push(Math.atan2(other.y - parentNode.y, other.x - parentNode.x));
  }
  const angles = chooseOpenAngles(occupiedAngles, hydrogens.length);
  hydrogens.forEach((hydrogenNode, index) => {
    const angle = angles[index] ?? (Math.PI * 2 * index) / hydrogens.length;
    hydrogenNode.x = parentNode.x + Math.cos(angle) * distance;
    hydrogenNode.y = parentNode.y + Math.sin(angle) * distance;
    hydrogenNode.anchorX = hydrogenNode.x;
    hydrogenNode.anchorY = hydrogenNode.y;
    hydrogenNode.forcePlacementParentId = parentNode.id;
    hydrogenNode.forcePlacementAngle = angle;
  });
}

/**
 * Repositions every explicit hydrogen in a force graph around its current parent atom.
 * @param {{nodes: Array<object>, links: Array<object>}} graph - Force graph with resolved or index-based links.
 * @param {object} [options] - Optional reseating parameters.
 * @param {boolean} [options.resetVelocity] - When true, clears hydrogen velocity after reseating.
 * @returns {void}
 */
export function reseatForceGraphHydrogens(graph, { resetVelocity = true } = {}) {
  if (!graph?.nodes?.length || !graph?.links?.length) {
    return;
  }
  const hydrogenGroups = new Map();
  for (const link of graph.links) {
    const source = typeof link.source === 'object' ? link.source : graph.nodes[link.source];
    const target = typeof link.target === 'object' ? link.target : graph.nodes[link.target];
    if (!source || !target) {
      continue;
    }
    if (isHydrogenNode(source) && !isHydrogenNode(target)) {
      if (!hydrogenGroups.has(target)) {
        hydrogenGroups.set(target, []);
      }
      hydrogenGroups.get(target).push(source);
    } else if (isHydrogenNode(target) && !isHydrogenNode(source)) {
      if (!hydrogenGroups.has(source)) {
        hydrogenGroups.set(source, []);
      }
      hydrogenGroups.get(source).push(target);
    }
  }

  for (const [parentNode, hydrogens] of hydrogenGroups) {
    placeHydrogensAroundParent(parentNode, hydrogens, graph.links, {
      distance: FORCE_LAYOUT_H_BOND_LENGTH,
      excludeIds: new Set(hydrogens.map(node => node.id)),
      nodes: graph.nodes
    });
    if (resetVelocity) {
      for (const hydrogenNode of hydrogens) {
        hydrogenNode.vx = 0;
        hydrogenNode.vy = 0;
      }
    }
  }
}

/**
 * Creates a bundle of force-layout helper functions bound to the simulation and plot context.
 * @param {object} context - Context providing `simulation`, `plotEl`, `d3`, `viewportFitPadding`, `generate2dCoords`, `alignReaction2dProductOrientation`, `spreadReaction2dProductComponents`, and `centerReaction2dPairCoords`.
 * @returns {object} Object with `buildForceAnchorLayout`, `convertMolecule`, `seedForceNodePositions`, `forceLinkDistance`, `forceAnchorRadius`, `forceHydrogenRepulsion`, `forceHydrogenPlacement`, `forceFitTransform`, `isHydrogenNode`, `zoomTransformsDiffer`, `placeHydrogensAroundParent`, `reseatForceGraphHydrogens`, `patchForceNodePositions`, and `reseatHydrogensAroundPatched`.
 */
export function createForceHelpers(context) {
  function forceFitTransform(nodes, pad = FORCE_LAYOUT_FIT_PAD, { hydrogenRadiusScale = 1, scaleMultiplier = 1, maxScale = 30 } = {}) {
    if (!nodes?.length) {
      return null;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const r = atomRadius(node.protons) * (isHydrogenNode(node) ? hydrogenRadiusScale : 1);
      if (node.x - r < minX) {
        minX = node.x - r;
      }
      if (node.x + r > maxX) {
        maxX = node.x + r;
      }
      if (node.y - r < minY) {
        minY = node.y - r;
      }
      if (node.y + r > maxY) {
        maxY = node.y + r;
      }
    }
    const width = context.plotEl.clientWidth || 600;
    const height = context.plotEl.clientHeight || 400;
    const pads = context.viewportFitPadding(pad);
    const horizontalPad = Math.max(pad, (pads.left + pads.right) / 2);
    const verticalPad = Math.max(pad, (pads.top + pads.bottom) / 2);
    const fitWidth = Math.max(1, width - horizontalPad * 2);
    const fitHeight = Math.max(1, height - verticalPad * 2);
    const exactFitScale = Math.min(fitWidth / (maxX - minX || 1), fitHeight / (maxY - minY || 1), maxScale);
    const scale = exactFitScale < 1 ? exactFitScale : Math.min(scaleMultiplier, exactFitScale, maxScale);
    const centerX = width / 2;
    const centerY = height / 2;
    const tx = centerX - ((minX + maxX) / 2) * scale;
    const ty = centerY - ((minY + maxY) / 2) * scale;
    return context.d3.zoomIdentity.translate(tx, ty).scale(scale);
  }

  function buildForceAnchorLayout(molecule) {
    const seedMol = molecule.clone();
    seedMol.hideHydrogens();
    context.generate2dCoords(seedMol, {
      suppressH: true,
      bondLength: 1.5
    });
    context.alignReaction2dProductOrientation(seedMol);
    context.spreadReaction2dProductComponents(seedMol, 1.5);
    context.centerReaction2dPairCoords(seedMol, 1.5);
    const anchors = new Map();
    for (const [id, atom] of seedMol.atoms) {
      if (atom.name === 'H' || atom.visible === false) {
        continue;
      }
      if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
        continue;
      }
      anchors.set(id, { x: atom.x, y: atom.y });
    }
    return anchors;
  }

  function seedForceNodePositions(graph, _molecule, anchorLayout, { previousNodePositions = null } = {}) {
    const width = context.plotEl.clientWidth || 600;
    const height = context.plotEl.clientHeight || 400;
    const anchorEntries = [...anchorLayout.values()];
    const idToNode = new Map(graph.nodes.map(node => [node.id, node]));

    if (anchorEntries.length > 0) {
      let cx2d = 0;
      let cy2d = 0;
      for (const pos of anchorEntries) {
        cx2d += pos.x;
        cy2d += pos.y;
      }
      cx2d /= anchorEntries.length;
      cy2d /= anchorEntries.length;

      for (const [id, pos] of anchorLayout) {
        const node = idToNode.get(id);
        if (!node) {
          continue;
        }
        node.anchorX = width / 2 + (pos.x - cx2d) * (FORCE_LAYOUT_BOND_LENGTH / 1.5);
        node.anchorY = height / 2 - (pos.y - cy2d) * (FORCE_LAYOUT_BOND_LENGTH / 1.5);
        node.x = node.anchorX;
        node.y = node.anchorY;
      }
    }

    const hydrogenGroups = new Map();
    for (const bond of graph.links) {
      const source = graph.nodes[bond.source];
      const target = graph.nodes[bond.target];
      if (isHydrogenNode(source) && !isHydrogenNode(target)) {
        if (!hydrogenGroups.has(target.id)) {
          hydrogenGroups.set(target.id, []);
        }
        hydrogenGroups.get(target.id).push(source);
      } else if (isHydrogenNode(target) && !isHydrogenNode(source)) {
        if (!hydrogenGroups.has(source.id)) {
          hydrogenGroups.set(source.id, []);
        }
        hydrogenGroups.get(source.id).push(target);
      }
    }

    for (const [parentId, hydrogens] of hydrogenGroups) {
      const parentNode = idToNode.get(parentId);
      placeHydrogensAroundParent(parentNode, hydrogens, graph.links, {
        distance: FORCE_LAYOUT_H_BOND_LENGTH,
        excludeIds: new Set(hydrogens.map(node => node.id)),
        nodes: graph.nodes
      });
    }

    if (previousNodePositions) {
      for (const node of graph.nodes) {
        const previous = previousNodePositions.get(node.id);
        if (!previous) {
          continue;
        }
        node.x = previous.x;
        node.y = previous.y;
        node.vx = 0;
        node.vy = 0;
        node.fx = previous.fx;
        node.fy = previous.fy;
        node.anchorX = Number.isFinite(previous.anchorX) ? previous.anchorX : node.anchorX;
        node.anchorY = Number.isFinite(previous.anchorY) ? previous.anchorY : node.anchorY;
        if (isHydrogenNode(node)) {
          node.forcePlacementParentId = previous.forcePlacementParentId ?? node.forcePlacementParentId;
          node.forcePlacementAngle = Number.isFinite(previous.forcePlacementAngle) ? previous.forcePlacementAngle : node.forcePlacementAngle;
        }
        if (!isHydrogenNode(node) && !Number.isFinite(node.anchorX) && Number.isFinite(previous.x) && Number.isFinite(previous.y)) {
          node.anchorX = previous.x;
          node.anchorY = previous.y;
        }
      }

      for (const link of graph.links) {
        const source = graph.nodes[link.source];
        const target = graph.nodes[link.target];
        const sourcePlaced = Number.isFinite(source?.x) && Number.isFinite(source?.y);
        const targetPlaced = Number.isFinite(target?.x) && Number.isFinite(target?.y);
        if (sourcePlaced && !targetPlaced) {
          target.x = source.x;
          target.y = source.y;
        } else if (targetPlaced && !sourcePlaced) {
          source.x = target.x;
          source.y = target.y;
        }
        if (sourcePlaced && !Number.isFinite(target?.anchorX) && !isHydrogenNode(target)) {
          target.anchorX = source.x;
          target.anchorY = source.y;
        } else if (targetPlaced && !Number.isFinite(source?.anchorX) && !isHydrogenNode(source)) {
          source.anchorX = target.x;
          source.anchorY = target.y;
        }
      }
    }
  }

  function patchForceNodePositions(patchPos, { setAnchors = true, alpha = 0.18, restart = true } = {}) {
    if (!patchPos?.size) {
      return;
    }
    for (const node of context.simulation.nodes()) {
      const pos = patchPos.get(node.id);
      if (!pos) {
        continue;
      }
      if (Number.isFinite(pos.x)) {
        node.x = pos.x;
      }
      if (Number.isFinite(pos.y)) {
        node.y = pos.y;
      }
      node.vx = 0;
      node.vy = 0;
      if (setAnchors && !isHydrogenNode(node) && Number.isFinite(node.x) && Number.isFinite(node.y)) {
        node.anchorX = node.x;
        node.anchorY = node.y;
      }
    }
    if (restart) {
      context.simulation.alpha(Math.max(context.simulation.alpha(), alpha)).restart();
    }
  }

  function reseatHydrogensAroundPatched(patchPos, { resetVelocity = true } = {}) {
    if (!patchPos?.size) {
      return;
    }
    const allNodes = context.simulation.nodes();
    const allLinks = context.simulation.force('link').links();
    const nodeById = new Map(allNodes.map(node => [node.id, node]));
    for (const [parentId] of patchPos) {
      const parentNode = nodeById.get(parentId);
      if (!parentNode || !Number.isFinite(parentNode.x)) {
        continue;
      }
      const hChildren = allLinks
        .map(link => (link.source?.id === parentId && isHydrogenNode(link.target) ? link.target : link.target?.id === parentId && isHydrogenNode(link.source) ? link.source : null))
        .filter(Boolean);
      if (hChildren.length > 0) {
        placeHydrogensAroundParent(parentNode, hChildren, allLinks, {
          distance: FORCE_LAYOUT_H_BOND_LENGTH,
          excludeIds: new Set(hChildren.map(node => node.id))
        });
        if (resetVelocity) {
          for (const hydrogenNode of hChildren) {
            hydrogenNode.vx = 0;
            hydrogenNode.vy = 0;
          }
        }
      }
    }
  }

  return {
    buildForceAnchorLayout,
    convertMolecule,
    seedForceNodePositions,
    forceLinkDistance,
    forceAnchorRadius: createForceAnchorRadiusForce,
    forceHydrogenRepulsion: createForceHydrogenRepulsionForce,
    forceHydrogenPlacement: createForceHydrogenPlacementForce,
    forceFitTransform,
    isHydrogenNode,
    zoomTransformsDiffer,
    placeHydrogensAroundParent,
    reseatForceGraphHydrogens,
    patchForceNodePositions,
    reseatHydrogensAroundPatched
  };
}
