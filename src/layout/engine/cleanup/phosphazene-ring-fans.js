/** @module cleanup/phosphazene-ring-fans */

import { auditLayout } from '../audit/audit.js';
import { collectCutSubtree } from './subtree-utils.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { describeCrossLikeHypervalentCenter, describePhosphazeneTrigonalCenter } from '../placement/branch-placement/angle-selection.js';
import { transformAttachedBlock } from '../placement/linkers.js';

const FAN_OFFSETS = [0, -15, 15, -30, 30];
const RING_TILTS = [0, -15, 15, -30, 30, -45, 45, -60, 60];
const MAX_PAIR_CHECKS = 16000;
const MAX_SEARCH_NODES = 2048;

/**
 * Finds two adjacent phosphazene centers with three separate pendant rings each.
 * Only complete, small, unconstrained ligand subtrees can be repacked.
 * @param {object} graph - Layout graph.
 * @param {Map<string, {x: number, y: number}>} coords - Complete placement.
 * @returns {object[]|null} Six ligand records, or an unsupported topology.
 */
function collectFanRings(graph, coords) {
  if (graph.traits.heavyAtomCount > 60) {
    return null;
  }
  const orderedIds = [...coords.keys()].sort((a, b) => compareCanonicalAtomIds(a, b, graph.canonicalAtomRank));
  if (orderedIds.some(id => graph.options.preserveFixed !== false && graph.fixedCoords.has(id))) {
    return null;
  }
  const centers = [];
  const records = [];
  let junctionId = null;
  for (const centerId of orderedIds) {
    if (graph.atoms.get(centerId)?.element !== 'P') {
      continue;
    }
    const descriptor = describeCrossLikeHypervalentCenter(graph, centerId);
    if (descriptor?.kind !== 'mono-oxo') {
      continue;
    }
    const multipleId = descriptor.multipleNeighborIds[0];
    if (!describePhosphazeneTrigonalCenter(graph, multipleId)) {
      continue;
    }
    if (junctionId != null && junctionId !== multipleId) {
      return null;
    }
    junctionId = multipleId;
    centers.push(centerId);
    const center = coords.get(centerId);
    const junction = coords.get(junctionId);
    if (!junction || graph.atoms.get(centerId)?.chirality) {
      return null;
    }
    const axis = Math.atan2(junction.y - center.y, junction.x - center.x);
    const roots = [...descriptor.singleNeighborIds].sort((a, b) => compareCanonicalAtomIds(a, b, graph.canonicalAtomRank));
    for (const [index, rootId] of roots.entries()) {
      const rings = graph.atomToRings.get(rootId) ?? [];
      if (rings.length !== 1 || rings[0].atomIds.length > 8) {
        return null;
      }
      const atomIds = [...collectCutSubtree(graph, rootId, centerId)].filter(id => coords.has(id));
      if (atomIds.includes(centerId) || atomIds.some(id => graph.atoms.get(id)?.chirality)) {
        return null;
      }
      const heavyIds = atomIds.filter(id => graph.atoms.get(id)?.element !== 'H');
      if (heavyIds.length > 12 || !rings[0].atomIds.every(id => coords.has(id))) {
        return null;
      }
      records.push({ centerId, rootId, atomIds, axis, slot: index + 1 });
    }
  }
  if (centers.length !== 2 || records.length !== 6) {
    return null;
  }
  const movedIds = records.flatMap(record => record.atomIds);
  return new Set(movedIds).size === movedIds.length ? records : null;
}

/**
 * Builds a bounded joint placement candidate for neighboring phosphazene fans.
 * Independent greedy ring choices can consume the only space for a later ring.
 * Forward checking instead requires every pending ligand to retain a compatible
 * rigid pose. The core stays fixed and all ligand bond lengths are preserved.
 *
 * Budget: six ligands, 45 poses each, 16,000 cached pair checks and 2,048 search
 * nodes. Only a fully clean result with no bond, label or hypervalent-angle
 * regression is returned. No changes to validation classes or cleanup stages.
 * @param {object} graph - Layout graph.
 * @param {Map<string, {x: number, y: number}>} coords - Original family placement.
 * @param {number} bondLength - Target bond length.
 * @param {function(Map<string, {x: number, y: number}>): number} measureAnglePenalty - Hypervalent angle score.
 * @returns {Map<string, {x: number, y: number}>|null} Accepted candidate, or null.
 */
export function packPhosphazeneRingFans(graph, coords, bondLength, measureAnglePenalty) {
  const records = collectFanRings(graph, coords);
  if (!records) {
    return null;
  }
  const auditOptions = { bondLength };
  const originalAudit = auditLayout(graph, coords, auditOptions);
  if (originalAudit.severeOverlapCount === 0 && originalAudit.visibleHeavyBondCrossingCount === 0) {
    return null;
  }
  const movedIds = new Set(records.flatMap(record => record.atomIds));
  const fixed = new Map([...coords].filter(([id]) => !movedIds.has(id)));
  if (!auditLayout(graph, fixed, auditOptions).ok) {
    return null;
  }
  const originalAnglePenalty = measureAnglePenalty(coords);
  const domains = records.map(record => {
    const block = new Map(record.atomIds.map(id => [id, coords.get(id)]));
    const center = coords.get(record.centerId);
    const poses = [];
    for (const offset of FAN_OFFSETS) {
      const angle = record.axis + (record.slot * Math.PI) / 2 + (offset * Math.PI) / 180;
      const target = { x: center.x + bondLength * Math.cos(angle), y: center.y + bondLength * Math.sin(angle) };
      for (const tilt of RING_TILTS) {
        const pose = transformAttachedBlock(block, record.rootId, target, angle + (tilt * Math.PI) / 180);
        if (auditLayout(graph, new Map([...fixed, ...pose]), auditOptions).ok) {
          poses.push(pose);
        }
      }
    }
    return poses;
  });
  if (domains.some(domain => domain.length === 0)) {
    return null;
  }
  const pairCache = new Map();
  let nodes = 0;
  let pairChecks = 0;
  let exhausted = false;

  /**
   * Tests two rigid ligand poses against the unchanged core, caching symmetry.
   * @param {number} i - First ligand index.
   * @param {number} a - First pose index.
   * @param {number} j - Second ligand index.
   * @param {number} b - Second pose index.
   * @returns {boolean} Whether the pair has clean geometry.
   */
  function compatible(i, a, j, b) {
    const key = i < j ? `${i}:${a}:${j}:${b}` : `${j}:${b}:${i}:${a}`;
    if (pairCache.has(key)) {
      return pairCache.get(key);
    }
    if (pairChecks >= MAX_PAIR_CHECKS) {
      exhausted = true;
      return false;
    }
    pairChecks++;
    const ok = auditLayout(graph, new Map([...fixed, ...domains[i][a], ...domains[j][b]]), auditOptions).ok;
    pairCache.set(key, ok);
    return ok;
  }

  /**
   * Chooses the most constrained ligand next and prunes incompatible poses.
   * @param {object[]} remaining - Pending ligand domains.
   * @param {number[][]} picked - Selected ligand/pose index pairs.
   * @returns {Map<string, {x: number, y: number}>|null} Safe complete placement.
   */
  function solve(remaining, picked) {
    if (exhausted || nodes >= MAX_SEARCH_NODES) {
      return null;
    }
    nodes++;
    if (remaining.length === 0) {
      const candidate = new Map(fixed);
      for (const [i, a] of picked) {
        for (const [id, point] of domains[i][a]) {
          candidate.set(id, point);
        }
      }
      const audit = auditLayout(graph, candidate, auditOptions);
      return audit.ok &&
        audit.visibleHeavyBondCrossingCount === 0 &&
        audit.labelOverlapCount <= originalAudit.labelOverlapCount &&
        audit.maxBondLengthDeviation <= originalAudit.maxBondLengthDeviation + 1e-9 &&
        measureAnglePenalty(candidate) <= originalAnglePenalty + 1e-9
        ? candidate
        : null;
    }
    remaining.sort((a, b) => a.values.length - b.values.length || a.i - b.i);
    const [{ i, values }, ...rest] = remaining;
    for (const a of values) {
      if (exhausted || nodes > MAX_SEARCH_NODES) {
        break;
      }
      const next = rest.map(({ i: j, values: choices }) => ({ i: j, values: choices.filter(b => compatible(i, a, j, b)) }));
      if (next.some(domain => domain.values.length === 0)) {
        continue;
      }
      const solution = solve(next, [...picked, [i, a]]);
      if (solution) {
        return solution;
      }
    }
    return null;
  }
  return solve(
    domains.map((domain, i) => ({ i, values: domain.map((_, a) => a) })),
    []
  );
}
