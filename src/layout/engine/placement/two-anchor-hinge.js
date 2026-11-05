/** @module placement/two-anchor-hinge */

import { auditLayout } from '../audit/audit.js';
import { alignCoordsToFixed, rotateAround } from '../geometry/transforms.js';
import { enforceAcyclicEZStereo } from '../stereo/enforcement.js';
import { inspectEZStereo } from '../stereo/ez.js';
import { pickWedgeAssignments } from '../stereo/wedge-selection.js';
import { isMetalAtom } from '../topology/metal-centers.js';

const TWO_ANCHOR_HINGE_MAX_ROTATION = Math.PI / 6;
const TWO_ANCHOR_HYPERVALENT_HINGE_MAX_ROTATION = Math.PI / 2;

/**
 * Returns the largest rigid turn allowed for an exact two-anchor hinge.
 * Hypervalent centers may be quarter-turned by later specialist presentation,
 * so copied final anchors need the same bounded pose available during placement.
 * @param {object} graph - Layout graph shell.
 * @param {string} pivotId - Candidate hinge pivot atom ID.
 * @returns {number} Maximum absolute rotation in radians.
 */
function twoAnchorHingeMaxRotation(graph, pivotId) {
  const pivot = graph.atoms.get(pivotId);
  return ['P', 'S', 'As', 'Se'].includes(pivot?.element) && pivot.heavyDegree >= 4 ? TWO_ANCHOR_HYPERVALENT_HINGE_MAX_ROTATION : TWO_ANCHOR_HINGE_MAX_ROTATION;
}

/**
 * Restores supported alkene geometry before rigidly aligning a component to
 * two compatible explicit anchors. Stereo enforcement normally protects fixed
 * atoms, but opposite endpoint anchors can freeze both candidate sides even
 * when their requested frame came from a clean stereo-rescued pose. This
 * bounded retry temporarily removes only the absolute constraints, performs
 * the existing stereo search once, and accepts an exact rigid alignment only
 * when the complete geometry and stereo audit is clean and no baseline metric
 * worsens.
 * @param {object} graph - Layout graph with explicit constraints.
 * @param {object} placement - Family placement and validation classes.
 * @param {object} aligned - Existing two-anchor aligned result.
 * @returns {object} Original alignment or a clean stereo-safe alignment.
 */
export function fitTwoAnchorStereo(graph, placement, aligned) {
  const ids = placement.atomIds;
  const anchors = ids.filter(id => graph.fixedCoords.has(id));
  const baselineEZ = inspectEZStereo(graph, aligned.coords);
  if (anchors.length !== 2 || ids.length > 128 || graph.options.preserveFixed === false || ids.some(id => isMetalAtom(graph.sourceMolecule.atoms.get(id))) || baselineEZ.violationCount === 0) {
    return aligned;
  }

  const unconstrainedGraph = {
    ...graph,
    fixedCoords: new Map(),
    options: { ...graph.options, fixedCoords: new Map() }
  };
  const enforced = enforceAcyclicEZStereo(unconstrainedGraph, placement.coords, { bondLength: graph.options.bondLength });
  if ((enforced.reflections ?? 0) === 0) {
    return aligned;
  }

  const fixed = new Map(anchors.map(id => [id, graph.fixedCoords.get(id)]));
  const candidate = alignCoordsToFixed(enforced.coords, ids, fixed, { allowScale: false });
  if (
    anchors.some(id => {
      const position = candidate.coords.get(id);
      const target = fixed.get(id);
      return !position || Math.hypot(position.x - target.x, position.y - target.y) > graph.options.bondLength * 1e-8;
    })
  ) {
    return aligned;
  }
  for (const [id, position] of fixed) {
    candidate.coords.set(id, { ...position });
  }

  const candidateEZ = inspectEZStereo(graph, candidate.coords);
  const baselineWedges = pickWedgeAssignments(graph, aligned.coords);
  const candidateWedges = pickWedgeAssignments(graph, candidate.coords);
  const auditOptions = { bondValidationClasses: placement.bondValidationClasses };
  const baselineAudit = auditLayout(graph, aligned.coords, auditOptions);
  const candidateAudit = auditLayout(graph, candidate.coords, {
    ...auditOptions,
    stereo: {
      ezViolationCount: candidateEZ.violationCount,
      chiralCenterCount: candidateWedges.chiralCenterCount,
      unassignedCenterCount: candidateWedges.unassignedCenterCount
    }
  });
  if (
    !candidateAudit.ok ||
    candidateEZ.violationCount >= baselineEZ.violationCount ||
    candidateWedges.assignedCenterCount < baselineWedges.assignedCenterCount ||
    candidateAudit.labelOverlapCount > baselineAudit.labelOverlapCount ||
    candidateAudit.visibleHeavyBondCrossingCount > baselineAudit.visibleHeavyBondCrossingCount ||
    candidateAudit.maxBondLengthDeviation > baselineAudit.maxBondLengthDeviation + graph.options.bondLength * 1e-9
  ) {
    return aligned;
  }
  return candidate;
}

/**
 * Fits two explicit anchors by rotating one rigid branch instead of scaling
 * the component. Only compact, sound-bond seeds with a bond-dirty similarity
 * alignment qualify. Each non-ring single bond contributes at most four
 * analytic circle-intersection poses (two pivots and two solutions), capped
 * at 128 audited candidates, a 30-degree general turn, and a 90-degree turn
 * around hypervalent pivots whose final presentation may use a quarter-turn.
 * Accept only clean geometry
 * with no added labels
 * or E/Z violations; infeasible chords retain the original constrained result.
 * @param {object} graph - Layout graph with explicit constraints.
 * @param {object} placement - Family placement and validation classes.
 * @param {object} aligned - Existing similarity-aligned result.
 * @returns {object} Original alignment or a clean rigid-hinge alignment.
 */
export function fitTwoAnchorHinge(graph, placement, aligned) {
  const ids = placement.atomIds;
  const anchors = ids.filter(id => graph.fixedCoords.has(id));
  if (anchors.length !== 2 || ids.length > 128 || graph.options.preserveFixed === false || ids.some(id => isMetalAtom(graph.sourceMolecule.atoms.get(id)))) {
    return aligned;
  }
  const auditOptions = { bondValidationClasses: placement.bondValidationClasses };
  const baseline = auditLayout(graph, aligned.coords, auditOptions);
  if (baseline.bondLengthFailureCount === 0 || auditLayout(graph, placement.coords, auditOptions).bondLengthFailureCount !== 0) {
    return aligned;
  }
  const fixed = new Map(anchors.map(id => [id, graph.fixedCoords.get(id)]));
  const [first, second] = anchors.map(id => fixed.get(id));
  const chord = Math.hypot(first.x - second.x, first.y - second.y);
  const participants = new Set(ids);
  let best = aligned;
  let bestAngle = Infinity;
  let candidateCount = 0;
  for (const bond of graph.bonds.values()) {
    if (bond.kind !== 'covalent' || bond.inRing || bond.order !== 1 || !participants.has(bond.a) || !participants.has(bond.b) || [bond.a, bond.b].some(id => graph.atoms.get(id)?.element === 'H')) {
      continue;
    }
    for (const [pivotId, rootId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      if (graph.atoms.get(pivotId)?.chirality) {
        continue;
      }
      const moved = new Set([rootId]);
      const queue = [rootId];
      for (const id of queue) {
        for (const edge of graph.bondsByAtomId.get(id) ?? []) {
          if (edge.id === bond.id) {
            continue;
          }
          const next = edge.a === id ? edge.b : edge.a;
          if (participants.has(next) && !moved.has(next)) {
            moved.add(next);
            queue.push(next);
          }
        }
      }
      if (moved.has(pivotId) || moved.has(anchors[0]) === moved.has(anchors[1])) {
        continue;
      }
      const pivot = placement.coords.get(pivotId);
      const moving = placement.coords.get(moved.has(anchors[0]) ? anchors[0] : anchors[1]);
      const stationary = placement.coords.get(moved.has(anchors[0]) ? anchors[1] : anchors[0]);
      if (!pivot || !moving || !stationary) {
        continue;
      }
      const radius = Math.hypot(moving.x - pivot.x, moving.y - pivot.y);
      const distance = Math.hypot(stationary.x - pivot.x, stationary.y - pivot.y);
      if (radius * distance < graph.options.bondLength ** 2 * 1e-12) {
        continue;
      }
      const cosine = (radius ** 2 + distance ** 2 - chord ** 2) / (2 * radius * distance);
      if (Math.abs(cosine) > 1 + 1e-12) {
        continue;
      }
      for (const sign of [-1, 1]) {
        if (candidateCount >= 128) {
          return best;
        }
        const rawAngle = Math.atan2(stationary.y - pivot.y, stationary.x - pivot.x) + sign * Math.acos(Math.max(-1, Math.min(1, cosine))) - Math.atan2(moving.y - pivot.y, moving.x - pivot.x);
        const angle = Math.atan2(Math.sin(rawAngle), Math.cos(rawAngle));
        if (Math.abs(angle) > twoAnchorHingeMaxRotation(graph, pivotId) || Math.abs(angle) >= bestAngle) {
          continue;
        }
        const coords = new Map(placement.coords);
        for (const id of moved) {
          if (coords.has(id)) {
            coords.set(id, rotateAround(coords.get(id), pivot, angle));
          }
        }
        const candidate = alignCoordsToFixed(coords, ids, fixed, { allowScale: false });
        if (anchors.some(id => Math.hypot(candidate.coords.get(id).x - fixed.get(id).x, candidate.coords.get(id).y - fixed.get(id).y) > graph.options.bondLength * 1e-8)) {
          continue;
        }
        for (const [id, position] of fixed) {
          candidate.coords.set(id, { ...position });
        }
        candidateCount++;
        const audit = auditLayout(graph, candidate.coords, auditOptions);
        if (
          !audit.ok ||
          audit.labelOverlapCount > baseline.labelOverlapCount ||
          audit.visibleHeavyBondCrossingCount > baseline.visibleHeavyBondCrossingCount ||
          inspectEZStereo(graph, candidate.coords).violationCount > 0
        ) {
          continue;
        }
        best = candidate;
        bestAngle = Math.abs(angle);
      }
    }
  }
  return best;
}
