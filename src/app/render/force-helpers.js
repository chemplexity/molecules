/** @module app/render/force-helpers */

import { atomRadius, renderBondOrder } from './helpers.js';

export const FORCE_LAYOUT_BOND_LENGTH = 41;
export const FORCE_LAYOUT_H_BOND_LENGTH = 20;
export const FORCE_LAYOUT_MULTIPLE_BOND_FACTOR = 0.93;
export const FORCE_LAYOUT_AROMATIC_BOND_FACTOR = 0.96;
export const FORCE_LAYOUT_HEAVY_ANCHOR_RADIUS = 1.25;
export const FORCE_LAYOUT_HEAVY_ANCHOR_STRENGTH = 1.15;
export const FORCE_LAYOUT_HEAVY_REPULSION = -14;
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
export const FORCE_LAYOUT_INITIAL_SETTLE_TICKS = 12;
export const FORCE_LAYOUT_INITIAL_SETTLE_ALPHA = 0.35;
export const FORCE_LAYOUT_INITIAL_RESTART_ALPHA = 0.02;
export const FORCE_LAYOUT_EDIT_RESTART_ALPHA = 0.005;
const FORCE_LAYOUT_HEAVY_ANCHOR_SOFT_RATIO = 0.14;
const FORCE_LAYOUT_REFERENCE_BOND_LENGTH = 1.5;

/**
 * Returns the force-layout scale factor implied by a line-layout bond length.
 * @param {number} [layoutBondLength] - Line-layout bond length in molecule units.
 * @returns {number} Force-layout scale relative to the default 1.5 unit bond length.
 */
export function forceLayoutBondScale(layoutBondLength = FORCE_LAYOUT_REFERENCE_BOND_LENGTH) {
  const parsed = Number(layoutBondLength);
  return Number.isFinite(parsed) && parsed > 0 ? parsed / FORCE_LAYOUT_REFERENCE_BOND_LENGTH : 1;
}

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

  const links = [...molecule.bonds.values()].map(bond => {
    const aromatic = bond.properties.aromatic ?? false;
    const renderOrder = renderBondOrder(bond);
    return {
      id: bond.id,
      source: idToIndex.get(bond.atoms[0]),
      target: idToIndex.get(bond.atoms[1]),
      order: aromatic ? 1.5 : renderOrder,
      renderOrder,
      aromatic
    };
  });

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
 * @param {object} [options] - Optional distance controls.
 * @param {number} [options.layoutBondLength] - Active line-layout bond length used to scale force distances.
 * @returns {number} Distance in pixels.
 */
export function forceLinkDistance(link, options = {}) {
  const source = typeof link.source === 'object' ? link.source : null;
  const target = typeof link.target === 'object' ? link.target : null;
  const scale = forceLayoutBondScale(options.layoutBondLength);
  let distance = (isHydrogenNode(source) || isHydrogenNode(target) ? FORCE_LAYOUT_H_BOND_LENGTH : FORCE_LAYOUT_BOND_LENGTH) * scale;

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

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function forceConverterNodeList(forceNodesOrGraph) {
  if (Array.isArray(forceNodesOrGraph)) {
    return forceNodesOrGraph;
  }
  if (forceNodesOrGraph?.nodes instanceof Map) {
    return [...forceNodesOrGraph.nodes.values()];
  }
  if (Array.isArray(forceNodesOrGraph?.nodes)) {
    return forceNodesOrGraph.nodes;
  }
  if (forceNodesOrGraph instanceof Map) {
    return [...forceNodesOrGraph.values()];
  }
  return [];
}

function centroid(points, fallback = { x: 0, y: 0 }) {
  const finitePoints = points.filter(isFinitePoint);
  if (finitePoints.length === 0) {
    return fallback;
  }
  let x = 0;
  let y = 0;
  for (const point of finitePoints) {
    x += point.x;
    y += point.y;
  }
  return {
    x: x / finitePoints.length,
    y: y / finitePoints.length
  };
}

function forceConverterHydrogenParentId(molecule, hydrogenAtom) {
  for (const bondId of hydrogenAtom?.bonds ?? []) {
    const bond = molecule?.bonds?.get?.(bondId);
    if (!bond?.atoms) {
      continue;
    }
    const otherId = bond.atoms[0] === hydrogenAtom.id ? bond.atoms[1] : bond.atoms[1] === hydrogenAtom.id ? bond.atoms[0] : null;
    const otherAtom = molecule?.atoms?.get?.(otherId);
    if (otherAtom && otherAtom.name !== 'H') {
      return otherId;
    }
  }
  return null;
}

function shouldIncludeLineHydrogen(atom, hydrogenMode) {
  if (atom.name !== 'H') {
    return true;
  }
  if (hydrogenMode === 'omit') {
    return false;
  }
  if (hydrogenMode === 'preserve') {
    return true;
  }
  return atom.visible !== false;
}

function isStereoDisplayBond(bond) {
  const displayAs = bond?.properties?.display?.as;
  return displayAs === 'wedge' || displayAs === 'dash';
}

function visibleHeavyNeighborCount(atom, molecule, excludedAtomId = null) {
  return atom.getNeighbors(molecule).filter(neighbor => neighbor && neighbor.id !== excludedAtomId && neighbor.name !== 'H' && neighbor.visible !== false).length;
}

function shouldReanchorChiralTerminalNeighbor(atom, molecule, centerId) {
  return (
    atom?.name !== 'H' &&
    atom?.visible !== false &&
    !(typeof atom.isInRing === 'function' && atom.isInRing(molecule)) &&
    visibleHeavyNeighborCount(atom, molecule, centerId) === 0
  );
}

function finiteForcePointFromNode(node, xKey = 'x', yKey = 'y') {
  if (!node || !Number.isFinite(node[xKey]) || !Number.isFinite(node[yKey])) {
    return null;
  }
  return { x: node[xKey], y: node[yKey] };
}

/**
 * Converts stored 2D/line molecule coordinates into force-layout pixel coordinates.
 *
 * Heavy atoms are scaled around the heavy-atom centroid and receive matching
 * anchors. Hydrogens default to stable parent-relative force slots so hidden
 * implicit hydrogens do not inherit stale or coincident 2D coordinates.
 * @param {object} molecule - Molecule with atom coordinates in 2D layout units.
 * @param {object} [options] - Conversion options.
 * @param {number} [options.bondLength] - Source 2D bond length in molecule coordinate units.
 * @param {number} [options.forceBondLength] - Target force heavy-heavy bond length in pixels.
 * @param {{x: number, y: number}} [options.forceCenter] - Target force-coordinate center.
 * @param {'stable'|'preserve'|'omit'} [options.hydrogenMode] - Hydrogen conversion strategy.
 * @param {number} [options.hydrogenDistance] - Parent-H force distance in pixels.
 * @returns {{coords: Map<string, object>, nodes: Array<object>, links: Array<object>, lineAnchorCoords: Map<string, object>, forceAnchorCoords: Map<string, object>, scale: number, lineCenter: {x: number, y: number}, forceCenter: {x: number, y: number}}} Converted force-coordinate data.
 */
export function convertLineCoordsToForceLayout(
  molecule,
  {
    bondLength = FORCE_LAYOUT_REFERENCE_BOND_LENGTH,
    forceBondLength = FORCE_LAYOUT_BOND_LENGTH * forceLayoutBondScale(bondLength),
    forceCenter = { x: 0, y: 0 },
    hydrogenMode = 'stable',
    hydrogenDistance = FORCE_LAYOUT_H_BOND_LENGTH * forceLayoutBondScale(bondLength)
  } = {}
) {
  const coords = new Map();
  const nodes = [];
  const links = [];
  const lineAnchorCoords = new Map();
  const forceAnchorCoords = new Map();
  const nodeById = new Map();
  const scale = forceBondLength / bondLength;
  const atoms = molecule?.atoms instanceof Map ? [...molecule.atoms.values()] : [];
  const heavyAtoms = atoms.filter(atom => atom.name !== 'H' && atom.visible !== false && isFinitePoint(atom));
  const lineCenter = centroid(heavyAtoms, centroid(atoms.filter(isFinitePoint)));

  for (const atom of atoms) {
    if (atom.name === 'H') {
      continue;
    }
    if (atom.visible === false || !isFinitePoint(atom)) {
      continue;
    }
    const x = forceCenter.x + (atom.x - lineCenter.x) * scale;
    const y = forceCenter.y - (atom.y - lineCenter.y) * scale;
    const node = {
      id: atom.id,
      name: atom.name,
      protons: atom.properties?.protons,
      charge: typeof atom.getCharge === 'function' ? atom.getCharge() : atom.properties?.charge ?? 0,
      aromatic: typeof atom.isAromatic === 'function' ? atom.isAromatic() : atom.properties?.aromatic === true,
      x,
      y,
      anchorX: x,
      anchorY: y
    };
    coords.set(atom.id, { x, y, anchorX: x, anchorY: y });
    lineAnchorCoords.set(atom.id, { x: atom.x, y: atom.y });
    forceAnchorCoords.set(atom.id, { x, y });
    nodes.push(node);
    nodeById.set(atom.id, node);
  }

  for (const bond of molecule?.bonds?.values?.() ?? []) {
    const source = nodeById.get(bond.atoms?.[0]);
    const target = nodeById.get(bond.atoms?.[1]);
    if (source && target) {
      const aromatic = bond.properties?.aromatic === true;
      const renderOrder = renderBondOrder(bond);
      links.push({ id: bond.id, source, target, order: aromatic ? 1.5 : renderOrder, renderOrder, aromatic });
    }
  }

  const hydrogenGroups = new Map();
  for (const atom of atoms) {
    if (atom.name !== 'H' || hydrogenMode === 'omit') {
      continue;
    }
    const parentId = forceConverterHydrogenParentId(molecule, atom);
    const parentNode = nodeById.get(parentId);
    if (!parentNode) {
      continue;
    }
    let node = null;
    if (hydrogenMode === 'preserve' && isFinitePoint(atom)) {
      const x = forceCenter.x + (atom.x - lineCenter.x) * scale;
      const y = forceCenter.y - (atom.y - lineCenter.y) * scale;
      node = { id: atom.id, name: atom.name, protons: atom.properties?.protons, x, y, anchorX: x, anchorY: y };
      coords.set(atom.id, { x, y, anchorX: x, anchorY: y });
    } else {
      node = { id: atom.id, name: atom.name, protons: atom.properties?.protons };
      if (!hydrogenGroups.has(parentNode)) {
        hydrogenGroups.set(parentNode, []);
      }
      hydrogenGroups.get(parentNode).push(node);
    }
    nodes.push(node);
    nodeById.set(atom.id, node);
    links.push({ id: `${parentId}:${atom.id}`, source: parentNode, target: node, order: 1, aromatic: false });
  }

  for (const [parentNode, hydrogens] of hydrogenGroups) {
    hydrogens.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    placeHydrogensAroundParent(parentNode, hydrogens, links, {
      distance: hydrogenDistance,
      excludeIds: new Set(hydrogens.map(node => node.id))
    });
    for (const hydrogenNode of hydrogens) {
      coords.set(hydrogenNode.id, {
        x: hydrogenNode.x,
        y: hydrogenNode.y,
        anchorX: hydrogenNode.anchorX,
        anchorY: hydrogenNode.anchorY,
        forcePlacementParentId: hydrogenNode.forcePlacementParentId,
        forcePlacementAngle: hydrogenNode.forcePlacementAngle
      });
    }
  }

  return { coords, nodes, links, lineAnchorCoords, forceAnchorCoords, scale, lineCenter, forceCenter };
}

/**
 * Converts force-layout pixel coordinates back into 2D/line molecule coordinates.
 *
 * Hidden implicit hydrogens are omitted by default so line mode can regenerate
 * or project them, while displayed hydrogens keep their force position.
 * @param {object} molecule - Molecule whose atom ids define the conversion target.
 * @param {Array<object>|Map<string, object>|{nodes: Array<object>|Map<string, object>}} forceNodesOrGraph - Force nodes or graph.
 * @param {object} [options] - Conversion options.
 * @param {number} [options.bondLength] - Target 2D bond length in molecule coordinate units.
 * @param {number} [options.forceBondLength] - Source force heavy-heavy bond length in pixels.
 * @param {{x: number, y: number}} [options.lineCenter] - Target line-coordinate center.
 * @param {'displayed'|'preserve'|'omit'} [options.hydrogenMode] - Hydrogen conversion strategy.
 * @returns {{coords: Map<string, object>, scale: number, forceCenter: {x: number, y: number}, lineCenter: {x: number, y: number}}} Converted line-coordinate data.
 */
export function convertForceCoordsToLineLayout(
  molecule,
  forceNodesOrGraph,
  {
    bondLength = FORCE_LAYOUT_REFERENCE_BOND_LENGTH,
    forceBondLength = FORCE_LAYOUT_BOND_LENGTH,
    lineCenter = { x: 0, y: 0 },
    hydrogenMode = 'displayed'
  } = {}
) {
  const coords = new Map();
  const nodeById = new Map(forceConverterNodeList(forceNodesOrGraph).filter(isFinitePoint).map(node => [node.id, node]));
  const atoms = molecule?.atoms instanceof Map ? [...molecule.atoms.values()] : [];
  const heavyNodes = atoms
    .filter(atom => atom.name !== 'H' && atom.visible !== false)
    .map(atom => nodeById.get(atom.id))
    .filter(isFinitePoint);
  const forceCenter = centroid(heavyNodes, centroid([...nodeById.values()]));
  const scale = bondLength / forceBondLength;
  const toLinePoint = point => ({
    x: lineCenter.x + (point.x - forceCenter.x) * scale,
    y: lineCenter.y - (point.y - forceCenter.y) * scale
  });
  const stereoEndpointCoords = new Map();

  for (const bond of molecule?.bonds?.values?.() ?? []) {
    if (!isStereoDisplayBond(bond)) {
      continue;
    }
    const centerId = bond.properties?.display?.centerId;
    if (!centerId || !bond.atoms?.includes(centerId)) {
      continue;
    }
    const endpointId = bond.atoms[0] === centerId ? bond.atoms[1] : bond.atoms[0];
    const endpointAtom = molecule.atoms.get(endpointId);
    const centerNode = nodeById.get(centerId);
    const endpointNode = nodeById.get(endpointId);
    const centerPoint = finiteForcePointFromNode(centerNode);
    if (!endpointAtom || !centerPoint) {
      continue;
    }
    const centerLinePoint = toLinePoint(centerPoint);
    if (endpointAtom.name === 'H') {
      stereoEndpointCoords.set(endpointId, centerLinePoint);
      continue;
    }
    const centerAnchorPoint = finiteForcePointFromNode(centerNode, 'anchorX', 'anchorY');
    const endpointAnchorPoint = finiteForcePointFromNode(endpointNode, 'anchorX', 'anchorY');
    if (centerAnchorPoint && endpointAnchorPoint) {
      const centerAnchorLinePoint = toLinePoint(centerAnchorPoint);
      const endpointAnchorLinePoint = toLinePoint(endpointAnchorPoint);
      stereoEndpointCoords.set(endpointId, {
        x: centerLinePoint.x + (endpointAnchorLinePoint.x - centerAnchorLinePoint.x),
        y: centerLinePoint.y + (endpointAnchorLinePoint.y - centerAnchorLinePoint.y)
      });
      continue;
    }
    if (endpointAnchorPoint) {
      stereoEndpointCoords.set(endpointId, toLinePoint(endpointAnchorPoint));
    }
  }

  for (const centerId of molecule?.getChiralCenters?.() ?? []) {
    const centerAtom = molecule.atoms.get(centerId);
    const centerNode = nodeById.get(centerId);
    const centerPoint = finiteForcePointFromNode(centerNode);
    if (!centerAtom || !centerPoint) {
      continue;
    }
    const centerLinePoint = toLinePoint(centerPoint);
    const centerAnchorPoint = finiteForcePointFromNode(centerNode, 'anchorX', 'anchorY');
    for (const neighbor of centerAtom.getNeighbors(molecule)) {
      if (!neighbor) {
        continue;
      }
      if (neighbor.name === 'H') {
        if (hydrogenMode !== 'omit') {
          stereoEndpointCoords.set(neighbor.id, centerLinePoint);
        }
        continue;
      }
      if (!shouldReanchorChiralTerminalNeighbor(neighbor, molecule, centerId)) {
        continue;
      }
      const endpointNode = nodeById.get(neighbor.id);
      const endpointAnchorPoint = finiteForcePointFromNode(endpointNode, 'anchorX', 'anchorY');
      if (centerAnchorPoint && endpointAnchorPoint) {
        const centerAnchorLinePoint = toLinePoint(centerAnchorPoint);
        const endpointAnchorLinePoint = toLinePoint(endpointAnchorPoint);
        stereoEndpointCoords.set(neighbor.id, {
          x: centerLinePoint.x + (endpointAnchorLinePoint.x - centerAnchorLinePoint.x),
          y: centerLinePoint.y + (endpointAnchorLinePoint.y - centerAnchorLinePoint.y)
        });
      } else if (endpointAnchorPoint) {
        stereoEndpointCoords.set(neighbor.id, toLinePoint(endpointAnchorPoint));
      }
    }
  }

  for (const atom of atoms) {
    const stereoEndpointCoord = stereoEndpointCoords.get(atom.id);
    if (!stereoEndpointCoord && !shouldIncludeLineHydrogen(atom, hydrogenMode)) {
      continue;
    }
    if (stereoEndpointCoord && atom.name === 'H' && hydrogenMode === 'omit') {
      continue;
    }
    if (stereoEndpointCoord) {
      coords.set(atom.id, stereoEndpointCoord);
      continue;
    }
    const node = nodeById.get(atom.id);
    if (!isFinitePoint(node)) {
      continue;
    }
    coords.set(atom.id, toLinePoint(node));
  }

  return { coords, scale, forceCenter, lineCenter };
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
  function forceFitTransform(nodes, pad = FORCE_LAYOUT_FIT_PAD, { hydrogenRadiusScale = 1, scaleMultiplier = 1, maxScale = 30, ignoreOverlayPadding = false, reactionLike = false } = {}) {
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
    const pads = ignoreOverlayPadding ? { left: pad, right: pad, top: pad, bottom: pad } : context.viewportFitPadding(pad, { reactionLike });
    const horizontalPad = Math.max(pad, (pads.left + pads.right) / 2);
    const verticalPad = Math.max(pad, (pads.top + pads.bottom) / 2);
    const fitWidth = Math.max(1, width - horizontalPad * 2);
    const fitHeight = Math.max(1, height - verticalPad * 2);
    const exactFitScale = Math.min(fitWidth / (maxX - minX || 1), fitHeight / (maxY - minY || 1), maxScale);
    const layoutBondScale = forceLayoutBondScale(context.getLayoutBondLength?.());
    const shortBondZoomScale = Math.max(1, Math.min(3, 1 / layoutBondScale));
    const adjustedScaleMultiplier = scaleMultiplier * shortBondZoomScale;
    const scale = exactFitScale < 1 ? exactFitScale : Math.min(adjustedScaleMultiplier, exactFitScale, maxScale);
    const centerX = width / 2;
    const centerY = height / 2;
    const tx = centerX - ((minX + maxX) / 2) * scale;
    const ty = centerY - ((minY + maxY) / 2) * scale;
    return context.d3.zoomIdentity.translate(tx, ty).scale(scale);
  }

  function buildForceAnchorLayout(molecule) {
    const layoutBondLength = context.getLayoutBondLength?.() ?? 1.5;
    const seedMol = molecule.clone();
    if (molecule.__reactionPreview) {
      seedMol.__reactionPreview = molecule.__reactionPreview;
    }
    seedMol.hideHydrogens();
    context.generate2dCoords(seedMol, {
      suppressH: true,
      bondLength: layoutBondLength
    });
    context.alignReaction2dProductOrientation(seedMol, layoutBondLength);
    context.spreadReaction2dProductComponents(seedMol, layoutBondLength);
    context.centerReaction2dPairCoords(seedMol, layoutBondLength);
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

      const layoutBondLength = context.getLayoutBondLength?.() ?? FORCE_LAYOUT_REFERENCE_BOND_LENGTH;
      const forceBondLength = FORCE_LAYOUT_BOND_LENGTH * forceLayoutBondScale(layoutBondLength);
      for (const [id, pos] of anchorLayout) {
        const node = idToNode.get(id);
        if (!node) {
          continue;
        }
        node.anchorX = width / 2 + (pos.x - cx2d) * (forceBondLength / layoutBondLength);
        node.anchorY = height / 2 - (pos.y - cy2d) * (forceBondLength / layoutBondLength);
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
        distance: FORCE_LAYOUT_H_BOND_LENGTH * forceLayoutBondScale(context.getLayoutBondLength?.()),
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
      if (pos.forcePlacementParentId != null) {
        node.forcePlacementParentId = pos.forcePlacementParentId;
      }
      if (Number.isFinite(pos.forcePlacementAngle)) {
        node.forcePlacementAngle = pos.forcePlacementAngle;
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
          distance: FORCE_LAYOUT_H_BOND_LENGTH * forceLayoutBondScale(context.getLayoutBondLength?.()),
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
    forceLinkDistance: link => forceLinkDistance(link, { layoutBondLength: context.getLayoutBondLength?.() }),
    forceAnchorRadius: createForceAnchorRadiusForce,
    forceHydrogenRepulsion: createForceHydrogenRepulsionForce,
    forceHydrogenPlacement: links =>
      createForceHydrogenPlacementForce(links, {
        distance: FORCE_LAYOUT_H_BOND_LENGTH * forceLayoutBondScale(context.getLayoutBondLength?.())
      }),
    forceFitTransform,
    isHydrogenNode,
    zoomTransformsDiffer,
    placeHydrogensAroundParent,
    reseatForceGraphHydrogens,
    patchForceNodePositions,
    reseatHydrogensAroundPatched
  };
}
