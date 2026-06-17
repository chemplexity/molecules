/** @module app/interactions/primitive-events */

import { atomDisplayColor, atomDisplayOpacity, atomRadius, getRenderOptions, singleBondWidth, strokeColor } from '../render/helpers.js';

const RING_TEMPLATE_ROTATION_SNAP = Math.PI / 6;
const RING_TEMPLATE_DRAG_THRESHOLD_PX = 3;
const RING_TEMPLATE_REUSE_DISTANCE_FACTOR = 0.2;
const FORCE_RING_TEMPLATE_BOND_LENGTH_FACTOR = 1.3;
const SVG_NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const GEOMETRY_EPSILON = 1e-6;
const RING_TEMPLATE_PREVIEW_VIEWPORT_PAD = 36;

/**
 * Creates event handler functions for all atom and bond mouse interactions in both 2D and force-layout modes.
 * @param {object} context - Dependency context providing state, view, selection, actions, drawBond, overlays, tooltip, tooltipState, formatters, options, pointer, and dom.
 * @returns {object} Object with handlers for 2D/force bond and atom click, double-click, mouse-over, mouse-move, mouse-out, and draw-bond mouse-down events.
 */
export function createPrimitiveEventHandlers(context) {
  let pendingRingTemplate = null;
  let pendingBondRingTemplatePreview = null;
  let suppressNextRingTemplateClick = false;
  let pendingViewportReadjustment = null;

  function getChargeTool() {
    return context.state.overlayState.getChargeTool?.() ?? null;
  }

  function getPaintStyle() {
    return {
      color: context.state.overlayState.getPaintColor?.() ?? '#3366ff',
      opacity: context.state.overlayState.getPaintOpacity?.() ?? 1
    };
  }

  function isPaintMode() {
    return context.state.overlayState.getPaintMode?.() ?? false;
  }

  function isRingTemplateMode() {
    return context.state.overlayState.getRingTemplateMode?.() ?? false;
  }

  function getRingTemplateBondLength() {
    return context.state.viewState.getMode() === 'force' ? (context.constants?.forceBondLength ?? 30) * FORCE_RING_TEMPLATE_BOND_LENGTH_FACTOR : (context.constants?.scale ?? 40) * 1.5;
  }

  function forcePreviewBondAnchorPoints(anchorA, anchorB) {
    if (context.state.viewState.getMode() !== 'force' || !isFinitePoint(anchorA) || !isFinitePoint(anchorB)) {
      return [{ x: anchorA.x, y: anchorA.y }, { x: anchorB.x, y: anchorB.y }];
    }
    const dx = anchorB.x - anchorA.x;
    const dy = anchorB.y - anchorA.y;
    const length = Math.hypot(dx, dy);
    if (length <= GEOMETRY_EPSILON) {
      return [{ x: anchorA.x, y: anchorA.y }, { x: anchorB.x, y: anchorB.y }];
    }
    const targetLength = getRingTemplateBondLength();
    const halfX = (dx / length) * targetLength * 0.5;
    const halfY = (dy / length) * targetLength * 0.5;
    const midpoint = {
      x: (anchorA.x + anchorB.x) * 0.5,
      y: (anchorA.y + anchorB.y) * 0.5
    };
    return [
      { x: midpoint.x - halfX, y: midpoint.y - halfY },
      { x: midpoint.x + halfX, y: midpoint.y + halfY }
    ];
  }

  function normalizePreviewAngle(angle) {
    const normalized = angle % (Math.PI * 2);
    return normalized < 0 ? normalized + Math.PI * 2 : normalized;
  }

  function snapRingTemplateAngle(angle) {
    return normalizePreviewAngle(Math.round(angle / RING_TEMPLATE_ROTATION_SNAP) * RING_TEMPLATE_ROTATION_SNAP);
  }

  function isFinitePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
  }

  function pointerPoint(event) {
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    return { x: gX, y: gY };
  }

  function getRingTemplateAnchorPoint(event, atomId, atomDatum = null) {
    if (context.state.viewState.getMode() === 'force') {
      const node = isFinitePoint(atomDatum) ? atomDatum : context.helpers?.getForceNodeById?.(atomId);
      if (isFinitePoint(node)) {
        return { x: node.x, y: node.y };
      }
      return pointerPoint(event);
    }
    const atom = context.helpers?.get2DAtomById?.(atomId);
    const point = atom ? context.helpers?.toSelectionSVGPt2d?.(atom) : null;
    return isFinitePoint(point) ? { x: point.x, y: point.y } : pointerPoint(event);
  }

  function previewRingPositions(size, anchorPoint, bondLength, centerAngle) {
    const radius = bondLength / (2 * Math.sin(Math.PI / size));
    const center = {
      x: anchorPoint.x + Math.cos(centerAngle) * radius,
      y: anchorPoint.y + Math.sin(centerAngle) * radius
    };
    const anchorAngleFromCenter = centerAngle + Math.PI;
    const positions = [{ x: anchorPoint.x, y: anchorPoint.y }];
    for (let index = 1; index < size; index++) {
      const angle = anchorAngleFromCenter + (index * Math.PI * 2) / size;
      positions.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    return positions;
  }

  function pointDistance(a, b) {
    return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
  }

  function ringTemplateVertexCount(template) {
    return template === 'benzene' ? 6 : Number(template);
  }

  function isBenzeneRingTemplate(template) {
    return template === 'benzene';
  }

  function singleDoubleBondOrderPreference(bond) {
    const localizedOrder = Number(bond?.properties?.localizedOrder);
    if (localizedOrder === 1 || localizedOrder === 2) {
      return localizedOrder;
    }
    const order = Number(bond?.properties?.order);
    if (order === 1 || order === 2) {
      return order;
    }
    return null;
  }

  function ringTemplateDoubleBondCandidates(ringSize) {
    if (!Number.isInteger(ringSize) || ringSize % 2 !== 0) {
      return [new Set()];
    }
    const candidates = [];
    for (const phase of [0, 1]) {
      const full = [];
      for (let index = 0; index < ringSize; index++) {
        if ((index + phase) % 2 === 0) {
          full.push(index);
        }
      }
      candidates.push(new Set(full));
      for (const omittedIndex of full) {
        candidates.push(new Set(full.filter(index => index !== omittedIndex)));
      }
    }
    const seen = new Set();
    return candidates.filter(candidate => {
      const key = [...candidate].sort((a, b) => a - b).join(',');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function existingRingTemplateBond(mol, atomA, atomB, anchorBondId = null) {
    if (!atomA || !atomB) {
      return null;
    }
    const directBond = mol?.getBond?.(atomA, atomB);
    if (directBond) {
      return directBond;
    }
    const anchorBond = anchorBondId ? mol?.bonds?.get?.(anchorBondId) : null;
    if (anchorBond?.atoms?.includes?.(atomA) && anchorBond.atoms.includes(atomB)) {
      return anchorBond;
    }
    for (const bond of mol?.bonds?.values?.() ?? []) {
      if (bond?.atoms?.includes?.(atomA) && bond.atoms.includes(atomB)) {
        return bond;
      }
    }
    return null;
  }

  function localizedBondOrderForValence(bond) {
    return singleDoubleBondOrderPreference(bond) ?? Math.floor(bond?.properties?.order ?? 1);
  }

  function atomBondEntries(mol, atomId) {
    const atom = mol?.atoms?.get?.(atomId);
    if (Array.isArray(atom?.bonds)) {
      return atom.bonds.map(bondId => mol?.bonds?.get?.(bondId)).filter(Boolean);
    }
    return [...(mol?.bonds?.values?.() ?? [])].filter(bond => bond?.atoms?.includes?.(atomId));
  }

  function ringTemplateLocalizedValenceOverflow(mol, ringAtomIds, doubleBondIndices) {
    const ringEdges = new Map();
    for (let index = 0; index < ringAtomIds.length; index++) {
      const atomA = ringAtomIds[index];
      const atomB = ringAtomIds[(index + 1) % ringAtomIds.length];
      if (!atomA || !atomB) {
        continue;
      }
      const key = atomA < atomB ? `${atomA},${atomB}` : `${atomB},${atomA}`;
      ringEdges.set(key, doubleBondIndices.has(index) ? 2 : 1);
    }

    let overflow = 0;
    for (let index = 0; index < ringAtomIds.length; index++) {
      const atomId = ringAtomIds[index];
      const atom = mol?.atoms?.get?.(atomId);
      if (!atom || atom.name !== 'C') {
        continue;
      }
      let orderSum = 0;
      for (const bond of atomBondEntries(mol, atomId)) {
        const otherAtomId = bond.getOtherAtom?.(atomId) ?? bond.atoms?.find?.(id => id !== atomId);
        const otherAtom = mol?.atoms?.get?.(otherAtomId);
        if (otherAtom?.name === 'H') {
          continue;
        }
        const key = atomId < otherAtomId ? `${atomId},${otherAtomId}` : `${otherAtomId},${atomId}`;
        if (ringEdges.has(key)) {
          continue;
        }
        orderSum += localizedBondOrderForValence(bond);
      }
      const previousRingEdgeIndex = (index - 1 + ringAtomIds.length) % ringAtomIds.length;
      orderSum += doubleBondIndices.has(previousRingEdgeIndex) ? 2 : 1;
      orderSum += doubleBondIndices.has(index) ? 2 : 1;
      if (orderSum > 4) {
        overflow += orderSum - 4;
      }
    }
    return overflow;
  }

  function scoreRingTemplateDoubleBondSet(mol, ringAtomIds, doubleBondIndices, anchorBondId = null) {
    let score = 0;
    for (let index = 0; index < ringAtomIds.length; index++) {
      const atomA = ringAtomIds[index];
      const atomB = ringAtomIds[(index + 1) % ringAtomIds.length];
      if (!atomA || !atomB) {
        continue;
      }
      const existingBond = existingRingTemplateBond(mol, atomA, atomB, anchorBondId);
      if (!existingBond) {
        continue;
      }
      const desiredOrder = doubleBondIndices.has(index) ? 2 : 1;
      const existingOrder = singleDoubleBondOrderPreference(existingBond);
      const isAnchorBond = existingBond.id === anchorBondId;
      if (existingOrder !== null && existingOrder !== desiredOrder) {
        score += isAnchorBond ? 50 : 20;
      }
      if (isAnchorBond && existingOrder === null && desiredOrder === 2) {
        score += 10;
      }
    }
    score += ringTemplateLocalizedValenceOverflow(mol, ringAtomIds, doubleBondIndices) * 1000;
    score += (ringAtomIds.length / 2 - doubleBondIndices.size) * 100;
    return score;
  }

  function chooseRingTemplateDoubleBondPreviewIndices({ template, ringAtomIds = [], anchorBondId = null } = {}) {
    if (!isBenzeneRingTemplate(template) || ringAtomIds.length % 2 !== 0) {
      return new Set();
    }
    const mol = getRingTemplateMolecule();
    if (!mol && anchorBondId) {
      return new Set(ringTemplateDoubleBondCandidates(ringAtomIds.length)[4] ?? []);
    }
    const candidates = ringTemplateDoubleBondCandidates(ringAtomIds.length);
    let bestCandidate = candidates[0] ?? new Set();
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const score = scoreRingTemplateDoubleBondSet(mol, ringAtomIds, candidate, anchorBondId);
      if (score < bestScore) {
        bestCandidate = candidate;
        bestScore = score;
      }
    }
    return bestCandidate;
  }

  function regularRingPositionsForBondPoints(anchorA, anchorB, size, sideSign = 1) {
    if (!isFinitePoint(anchorA) || !isFinitePoint(anchorB)) {
      return null;
    }
    const dx = anchorB.x - anchorA.x;
    const dy = anchorB.y - anchorA.y;
    const bondLength = Math.hypot(dx, dy);
    if (bondLength <= GEOMETRY_EPSILON) {
      return null;
    }
    const ux = dx / bondLength;
    const uy = dy / bondLength;
    const midpoint = {
      x: (anchorA.x + anchorB.x) / 2,
      y: (anchorA.y + anchorB.y) / 2
    };
    const apothem = bondLength / (2 * Math.tan(Math.PI / size));
    const center = {
      x: midpoint.x - uy * apothem * sideSign,
      y: midpoint.y + ux * apothem * sideSign
    };
    const radius = bondLength / (2 * Math.sin(Math.PI / size));
    const step = TAU / size;
    const angleA = Math.atan2(anchorA.y - center.y, anchorA.x - center.x);
    const angleB = Math.atan2(anchorB.y - center.y, anchorB.x - center.x);
    const direction = normalizePreviewAngle(angleB - angleA) <= Math.PI ? 1 : -1;
    const positions = [
      { x: anchorA.x, y: anchorA.y },
      { x: anchorB.x, y: anchorB.y }
    ];
    for (let index = 2; index < size; index++) {
      const angle = angleB + direction * step * (index - 1);
      positions.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    return positions;
  }

  function scoreBondAnchoredRingSide(newPositions, occupiedPoints, bondLength) {
    let score = 0;
    for (const position of newPositions) {
      for (const occupied of occupiedPoints) {
        const distance = pointDistance(position, occupied);
        if (distance <= GEOMETRY_EPSILON) {
          score += 1e6;
          continue;
        }
        score += 1 / (distance * distance);
        if (distance < bondLength * 0.8) {
          score += (bondLength * 0.8 - distance) * 100;
        }
      }
    }
    return score;
  }

  function chooseBondAnchoredRingSide(anchorA, anchorB, size, occupiedPoints = []) {
    const first = regularRingPositionsForBondPoints(anchorA, anchorB, size, 1);
    const second = regularRingPositionsForBondPoints(anchorA, anchorB, size, -1);
    if (!first || !second) {
      return null;
    }
    const bondLength = pointDistance(anchorA, anchorB);
    const firstScore = scoreBondAnchoredRingSide(first.slice(2), occupiedPoints, bondLength);
    const secondScore = scoreBondAnchoredRingSide(second.slice(2), occupiedPoints, bondLength);
    return firstScore <= secondScore ? 1 : -1;
  }

  function bondSideSignForPoint(anchorA, anchorB, point, fallbackSideSign = 1) {
    if (!isFinitePoint(anchorA) || !isFinitePoint(anchorB) || !isFinitePoint(point)) {
      return fallbackSideSign < 0 ? -1 : 1;
    }
    const cross = (anchorB.x - anchorA.x) * (point.y - anchorA.y) - (anchorB.y - anchorA.y) * (point.x - anchorA.x);
    if (Math.abs(cross) <= GEOMETRY_EPSILON) {
      return fallbackSideSign < 0 ? -1 : 1;
    }
    return cross < 0 ? -1 : 1;
  }

  function get2DOccupiedRingPreviewPoints(anchorAtomIds = []) {
    const anchorIds = new Set(anchorAtomIds);
    const mol = context.state.documentState.getMol2d?.() ?? null;
    if (!mol?.atoms?.values) {
      return [];
    }
    const points = [];
    for (const atom of mol.atoms.values()) {
      if (anchorIds.has(atom.id) || atom.name === 'H' || atom.visible === false) {
        continue;
      }
      const point = context.helpers?.toSelectionSVGPt2d?.(atom);
      if (isFinitePoint(point)) {
        points.push({ x: point.x, y: point.y });
      }
    }
    return points;
  }

  function getForceOccupiedRingPreviewPoints(anchorAtomIds = []) {
    const anchorIds = new Set(anchorAtomIds);
    const nodes = context.helpers?.getForceNodes?.() ?? [];
    return nodes
      .filter(node => !anchorIds.has(node.id) && node.name !== 'H' && node.visible !== false && isFinitePoint(node))
      .map(node => ({ x: node.x, y: node.y }));
  }

  function getRingTemplateMolecule() {
    return context.state.viewState.getMode() === '2d' ? context.state.documentState.getMol2d?.() : context.state.documentState.getCurrentMol?.();
  }

  function isReactionPreviewEditableRingAtom(atomId) {
    return context.overlays?.isReactionPreviewEditableAtomId?.(atomId) !== false;
  }

  function isReactionPreviewEditableRingBond(bondId, anchorAtomIds = []) {
    if (!bondId) {
      return true;
    }
    const atomIds = anchorAtomIds.length > 0 ? anchorAtomIds : (getRingTemplateMolecule()?.bonds?.get?.(bondId)?.atoms ?? []);
    return atomIds.every(atomId => isReactionPreviewEditableRingAtom(atomId));
  }

  function getRingTemplateAtomEntries() {
    if (context.state.viewState.getMode() === 'force') {
      return (context.helpers?.getForceNodes?.() ?? [])
        .filter(node => node?.id && node.name !== 'H' && node.visible !== false && isFinitePoint(node))
        .map(node => ({ id: node.id, x: node.x, y: node.y }));
    }
    const mol = context.state.documentState.getMol2d?.();
    if (!mol?.atoms?.values) {
      return [];
    }
    const entries = [];
    for (const atom of mol.atoms.values()) {
      if (!atom?.id || atom.name === 'H' || atom.visible === false) {
        continue;
      }
      const point = context.helpers?.toSelectionSVGPt2d?.(atom);
      if (isFinitePoint(point)) {
        entries.push({ id: atom.id, x: point.x, y: point.y });
      }
    }
    return entries;
  }

  function getRingTemplateViewportPoints() {
    if (context.state.viewState.getMode() === 'force') {
      return (context.helpers?.getForceNodes?.() ?? [])
        .filter(node => node?.id && node.visible !== false && isFinitePoint(node))
        .map(node => ({ x: node.x, y: node.y }));
    }
    const mol = context.state.documentState.getMol2d?.();
    if (!mol?.atoms?.values) {
      return [];
    }
    const points = [];
    for (const atom of mol.atoms.values()) {
      if (!atom?.id || atom.visible === false) {
        continue;
      }
      const point = context.helpers?.toSelectionSVGPt2d?.(atom);
      if (isFinitePoint(point)) {
        points.push({ x: point.x, y: point.y });
      }
    }
    return points;
  }

  function findReusableRingTemplateAtomId(position, atomEntries, usedAtomIds, tolerance) {
    let bestAtomId = null;
    let bestDistance = tolerance;
    for (const atom of atomEntries) {
      if (usedAtomIds.has(atom.id)) {
        continue;
      }
      const distance = pointDistance(position, atom);
      if (distance <= bestDistance + GEOMETRY_EPSILON) {
        bestAtomId = atom.id;
        bestDistance = distance;
      }
    }
    return bestAtomId;
  }

  function getExistingRingTemplateBondId(atomIdA, atomIdB) {
    if (!atomIdA || !atomIdB) {
      return null;
    }
    const mol = getRingTemplateMolecule();
    if (mol?.getBond) {
      return mol.getBond(atomIdA, atomIdB)?.id ?? null;
    }
    for (const bond of mol?.bonds?.values?.() ?? []) {
      if ((bond.atoms?.[0] === atomIdA && bond.atoms?.[1] === atomIdB) || (bond.atoms?.[0] === atomIdB && bond.atoms?.[1] === atomIdA)) {
        return bond.id ?? null;
      }
    }
    return null;
  }

  function ringTemplateHoverTargets(positions, knownAtomIds = [], options = {}) {
    const allowReuse = options.allowReuse ?? true;
    const requireExistingReuseBond = options.requireExistingReuseBond === true;
    const knownBondIds = new Set(options.knownBondIds ?? []);
    const atomIds = [];
    const bondIds = [];
    const reusedAtomIds = [];
    const ringAtomIds = new Array(positions.length).fill(null);
    const usedAtomIds = new Set();
    knownAtomIds.forEach((atomId, index) => {
      if (!atomId || index >= ringAtomIds.length) {
        return;
      }
      ringAtomIds[index] = atomId;
      usedAtomIds.add(atomId);
      atomIds.push(atomId);
    });

    if (allowReuse || requireExistingReuseBond) {
      const atomEntries = getRingTemplateAtomEntries();
      const tolerance = getRingTemplateBondLength() * RING_TEMPLATE_REUSE_DISTANCE_FACTOR;
      for (let index = 0; index < positions.length; index++) {
        if (ringAtomIds[index]) {
          continue;
        }
        const reusableAtomId = findReusableRingTemplateAtomId(positions[index], atomEntries, usedAtomIds, tolerance);
        if (!reusableAtomId) {
          continue;
        }
        ringAtomIds[index] = reusableAtomId;
        usedAtomIds.add(reusableAtomId);
        atomIds.push(reusableAtomId);
        reusedAtomIds.push(reusableAtomId);
      }
    }

    let hasExistingReuseBond = false;
    for (let index = 0; index < ringAtomIds.length; index++) {
      const bondId = getExistingRingTemplateBondId(ringAtomIds[index], ringAtomIds[(index + 1) % ringAtomIds.length]);
      if (bondId) {
        bondIds.push(bondId);
        if (!knownBondIds.has(bondId)) {
          hasExistingReuseBond = true;
        }
      }
    }

    if (requireExistingReuseBond && !hasExistingReuseBond) {
      return {
        atomIds: [],
        bondIds: [],
        ringAtomIds: []
      };
    }

    return {
      atomIds: [...new Set(requireExistingReuseBond ? reusedAtomIds : atomIds)],
      bondIds: [...new Set(bondIds)],
      ringAtomIds
    };
  }

  function chooseAutoFuseBondAnchoredRingSide(anchorA, anchorB, size, knownAtomIds = [], knownBondIds = []) {
    for (const sideSign of [1, -1]) {
      const positions = regularRingPositionsForBondPoints(anchorA, anchorB, size, sideSign);
      if (!positions) {
        continue;
      }
      const targets = ringTemplateHoverTargets(positions, knownAtomIds, {
        allowReuse: true,
        requireExistingReuseBond: true,
        knownBondIds
      });
      if (targets.bondIds.some(bondId => !knownBondIds.includes(bondId))) {
        return sideSign;
      }
    }
    return null;
  }

  function removeRingTemplatePreview() {
    cancelRingTemplateViewportReadjustment();
    context.dom.gNode?.()?.querySelector?.('g.ring-template-preview')?.remove?.();
  }

  function cancelRingTemplateViewportReadjustment() {
    if (pendingViewportReadjustment == null) {
      return;
    }
    const cancel =
      context.timers?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame ?? (id => {
        clearTimeout(id);
      });
    cancel(pendingViewportReadjustment);
    pendingViewportReadjustment = null;
  }

  function scheduleRingTemplateViewportReadjustment(positions, remaining = 2) {
    if (context.state.viewState.getMode() !== 'force' || remaining <= 0) {
      return;
    }
    cancelRingTemplateViewportReadjustment();
    const schedule =
      context.timers?.requestAnimationFrame ?? globalThis.requestAnimationFrame ?? (callback => {
        return setTimeout(callback, 16);
      });
    pendingViewportReadjustment = schedule(() => {
      pendingViewportReadjustment = null;
      if (!context.dom.gNode?.()?.querySelector?.('g.ring-template-preview')) {
        return;
      }
      adjustRingTemplatePreviewViewport(positions, { scheduleFollowup: false });
      scheduleRingTemplateViewportReadjustment(positions, remaining - 1);
    });
  }

  function adjustRingTemplatePreviewViewport(positions, options = {}) {
    if (!positions?.length || typeof context.view.getZoomTransform !== 'function' || typeof context.view.setZoomTransform !== 'function') {
      return;
    }
    const size = context.plot?.getSize?.() ?? null;
    const width = size?.width ?? 0;
    const height = size?.height ?? 0;
    if (!(width > 0) || !(height > 0)) {
      return;
    }
    if (options.scheduleFollowup !== false) {
      scheduleRingTemplateViewportReadjustment(positions);
    }
    const transform = context.view.getZoomTransform();
    const k = Number.isFinite(transform?.k) ? transform.k : 1;
    const tx = Number.isFinite(transform?.x) ? transform.x : 0;
    const ty = Number.isFinite(transform?.y) ? transform.y : 0;
    const points = [...positions, ...getRingTemplateViewportPoints()];
    let minGraphX = Infinity;
    let maxGraphX = -Infinity;
    let minGraphY = Infinity;
    let maxGraphY = -Infinity;
    for (const point of points) {
      if (!isFinitePoint(point)) {
        continue;
      }
      minGraphX = Math.min(minGraphX, point.x);
      maxGraphX = Math.max(maxGraphX, point.x);
      minGraphY = Math.min(minGraphY, point.y);
      maxGraphY = Math.max(maxGraphY, point.y);
    }
    if (!Number.isFinite(minGraphX) || !Number.isFinite(minGraphY)) {
      return;
    }

    const pad = Math.min(RING_TEMPLATE_PREVIEW_VIEWPORT_PAD, Math.max(0, Math.min(width, height) * 0.2));
    const availableWidth = Math.max(1, width - pad * 2);
    const availableHeight = Math.max(1, height - pad * 2);
    const graphSpanX = maxGraphX - minGraphX;
    const graphSpanY = maxGraphY - minGraphY;
    let nextK = k;
    if (graphSpanX > GEOMETRY_EPSILON && graphSpanX * nextK > availableWidth) {
      nextK = Math.min(nextK, availableWidth / graphSpanX);
    }
    if (graphSpanY > GEOMETRY_EPSILON && graphSpanY * nextK > availableHeight) {
      nextK = Math.min(nextK, availableHeight / graphSpanY);
    }

    const minCurrentX = tx + minGraphX * k;
    const maxCurrentX = tx + maxGraphX * k;
    const minCurrentY = ty + minGraphY * k;
    const maxCurrentY = ty + maxGraphY * k;

    function adjustedAxisTranslation({ currentT, minGraph, maxGraph, minCurrent, maxCurrent, viewportSize, availableSize }) {
      let nextT = currentT;
      if (Math.abs(nextK - k) > 0.0001) {
        const onlyMinOverflow = minCurrent < pad && maxCurrent <= viewportSize - pad;
        const onlyMaxOverflow = maxCurrent > viewportSize - pad && minCurrent >= pad;
        if (onlyMinOverflow) {
          nextT = maxCurrent - maxGraph * nextK;
        } else if (onlyMaxOverflow) {
          nextT = minCurrent - minGraph * nextK;
        } else {
          const currentCenter = (minCurrent + maxCurrent) / 2;
          const graphCenter = (minGraph + maxGraph) / 2;
          nextT = currentCenter - graphCenter * nextK;
        }
      }

      const minScreen = nextT + minGraph * nextK;
      const maxScreen = nextT + maxGraph * nextK;
      const span = maxScreen - minScreen;
      if (span > availableSize) {
        return viewportSize / 2 - (minScreen + maxScreen) / 2 + nextT;
      }
      if (minScreen < pad) {
        return nextT + pad - minScreen;
      }
      if (maxScreen > viewportSize - pad) {
        return nextT + viewportSize - pad - maxScreen;
      }
      return nextT;
    }

    const nextTx = adjustedAxisTranslation({
      currentT: tx,
      minGraph: minGraphX,
      maxGraph: maxGraphX,
      minCurrent: minCurrentX,
      maxCurrent: maxCurrentX,
      viewportSize: width,
      availableSize: availableWidth
    });
    const nextTy = adjustedAxisTranslation({
      currentT: ty,
      minGraph: minGraphY,
      maxGraph: maxGraphY,
      minCurrent: minCurrentY,
      maxCurrent: maxCurrentY,
      viewportSize: height,
      availableSize: availableHeight
    });
    if (Math.abs(nextTx - tx) <= 0.5 && Math.abs(nextTy - ty) <= 0.5 && Math.abs(nextK - k) <= 0.0001) {
      return;
    }
    const nextTransform =
      typeof context.view.makeZoomIdentity === 'function'
        ? context.view.makeZoomIdentity(nextTx, nextTy, nextK)
        : {
            x: nextTx,
            y: nextTy,
            k: nextK
          };
    context.view.setZoomTransform(nextTransform);
  }

  function renderRingTemplatePreviewPositions(positions, existingAtomCount = 1, options = {}) {
    const gNode = context.dom.gNode?.();
    if (!gNode?.appendChild || !gNode.ownerDocument || positions.length === 0) {
      return;
    }
    removeRingTemplatePreview();
    const group = gNode.ownerDocument.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'ring-template-preview');
    group.setAttribute('pointer-events', 'none');
    const mode = context.state.viewState.getMode();
    const isForce = mode === 'force';
    const bondStrokeWidth = isForce ? singleBondWidth(1) : `${getRenderOptions().twoDBondThickness}px`;
    const lineClass = isForce ? 'link' : 'bond';
    const doubleBondOffset = 5;
    const showBenzeneDoubleBonds = isBenzeneRingTemplate(options.template);
    const aromaticDoubleBondIndices = options.aromaticDoubleBondIndices instanceof Set
      ? options.aromaticDoubleBondIndices
      : new Set(
          Array.isArray(options.aromaticDoubleBondIndices)
            ? options.aromaticDoubleBondIndices
            : ringTemplateDoubleBondCandidates(positions.length)[Number.isInteger(options.aromaticDoubleBondPhase) ? options.aromaticDoubleBondPhase === 1 ? 4 : 0 : 0] ?? []
        );
    const center = positions.reduce(
      (sum, point) => ({
        x: sum.x + point.x / positions.length,
        y: sum.y + point.y / positions.length
      }),
      { x: 0, y: 0 }
    );

    const appendLine = (start, end, className = lineClass) => {
      const line = gNode.ownerDocument.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', className);
      line.setAttribute('x1', String(start.x));
      line.setAttribute('y1', String(start.y));
      line.setAttribute('x2', String(end.x));
      line.setAttribute('y2', String(end.y));
      line.setAttribute('stroke-width', bondStrokeWidth);
      line.setAttribute('pointer-events', 'none');
      group.appendChild(line);
      return line;
    };

    for (let index = 0; index < positions.length; index++) {
      const start = positions[index];
      const end = positions[(index + 1) % positions.length];
      appendLine(start, end);
    }

    if (showBenzeneDoubleBonds) {
      for (let index = 0; index < positions.length; index++) {
        if (!aromaticDoubleBondIndices.has(index)) {
          continue;
        }
        const start = positions[index];
        const end = positions[(index + 1) % positions.length];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        let nx = -dy / length;
        let ny = dx / length;
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        if ((center.x - midX) * nx + (center.y - midY) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        const inset = 0.16;
        const innerStart = {
          x: start.x + dx * inset + nx * doubleBondOffset,
          y: start.y + dy * inset + ny * doubleBondOffset
        };
        const innerEnd = {
          x: end.x - dx * inset + nx * doubleBondOffset,
          y: end.y - dy * inset + ny * doubleBondOffset
        };
        appendLine(innerStart, innerEnd, `${lineClass} ring-template-double-bond`);
      }
    }

    if (isForce) {
      const previewCarbon = { name: 'C', properties: {} };
      for (let index = existingAtomCount; index < positions.length; index++) {
        const point = positions[index];
        const circle = gNode.ownerDocument.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('class', 'node');
        circle.setAttribute('cx', String(point.x));
        circle.setAttribute('cy', String(point.y));
        circle.setAttribute('r', String(atomRadius(6)));
        circle.setAttribute('fill', atomDisplayColor(previewCarbon, 'force'));
        circle.setAttribute('fill-opacity', String(atomDisplayOpacity(previewCarbon)));
        circle.setAttribute('stroke', strokeColor('C'));
        circle.setAttribute('stroke-opacity', String(atomDisplayOpacity(previewCarbon)));
        circle.setAttribute('stroke-width', '1');
        circle.setAttribute('pointer-events', 'none');
        group.appendChild(circle);
      }
    }
    gNode.appendChild(group);
    adjustRingTemplatePreviewViewport(positions);
  }

  function renderRingTemplatePreview(state, centerAngle) {
    const positions = previewRingPositions(state.size, state.anchorPoint, getRingTemplateBondLength(), centerAngle);
    const hoverOptions = {
      requireExistingReuseBond: context.state.viewState.getMode() === 'force'
    };
    const targets = ringTemplateHoverTargets(positions, [state.atomId], hoverOptions);
    const aromaticDoubleBondIndices = chooseRingTemplateDoubleBondPreviewIndices({
      template: state.template,
      ringAtomIds: targets.ringAtomIds.length > 0 ? targets.ringAtomIds : [state.atomId, ...Array(Math.max(0, state.size - 1)).fill(null)]
    });
    renderRingTemplatePreviewPositions(positions, 1, { template: state.template, aromaticDoubleBondIndices });
    context.view.showPrimitiveHover(
      [...new Set([[state.atomId].filter(Boolean), targets.atomIds].flat())],
      [...new Set(targets.bondIds)]
    );
  }

  function clearPendingRingTemplateListeners(state) {
    state?.document?.removeEventListener?.('mousemove', state.handleMove, true);
    state?.document?.removeEventListener?.('mouseup', state.handleUp, true);
  }

  function clearPendingBondRingTemplatePreview(state) {
    state?.document?.removeEventListener?.('mousemove', state.handleMove, true);
    state?.document?.removeEventListener?.('mouseup', state.handleUp, true);
    if (!state || pendingBondRingTemplatePreview === state) {
      pendingBondRingTemplatePreview = null;
      removeRingTemplatePreview();
    }
  }

  function commitPendingRingTemplate(state) {
    const options = { anchorAtomId: state.atomId };
    if (state.dragged && Number.isFinite(state.currentGraphAngle)) {
      options.anchorForceCenterAngle = state.currentGraphAngle;
      options.anchorCenterAngle = -state.currentGraphAngle;
    }
    context.actions.placeRingTemplate?.(state.template ?? state.size, state.anchorPoint.x, state.anchorPoint.y, options);
  }

  function updatePendingRingTemplate(event, state) {
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    const dx = gX - state.anchorPoint.x;
    const dy = gY - state.anchorPoint.y;
    const distance = Math.hypot(dx, dy);
    if (!state.dragged && distance < RING_TEMPLATE_DRAG_THRESHOLD_PX) {
      return;
    }
    state.dragged = true;
    state.currentGraphAngle = snapRingTemplateAngle(Math.atan2(dy, dx));
    renderRingTemplatePreview(state, state.currentGraphAngle);
  }

  function startRingTemplateOnAtom(event, atomId, atomDatum = null) {
    if (!isRingTemplateMode()) {
      return false;
    }
    if (event.button != null && event.button !== 0) {
      return false;
    }
    if (!isReactionPreviewEditableRingAtom(atomId)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return true;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    const anchorPoint = getRingTemplateAnchorPoint(event, atomId, atomDatum);
    context.view.showPrimitiveHover([atomId], []);
    const doc = event.currentTarget?.ownerDocument ?? context.document ?? globalThis.document ?? null;
    const template = context.state.overlayState.getRingTemplateSize?.() ?? 6;
    const state = {
      atomId,
      template,
      size: ringTemplateVertexCount(template),
      anchorPoint,
      currentGraphAngle: null,
      dragged: false,
      document: doc,
      handleMove: null,
      handleUp: null
    };
    state.handleMove = moveEvent => {
      if (pendingRingTemplate !== state) {
        return;
      }
      moveEvent.preventDefault?.();
      updatePendingRingTemplate(moveEvent, state);
    };
    state.handleUp = upEvent => {
      if (pendingRingTemplate !== state) {
        return;
      }
      upEvent.preventDefault?.();
      upEvent.stopPropagation?.();
      clearPendingRingTemplateListeners(state);
      removeRingTemplatePreview();
      pendingRingTemplate = null;
      suppressNextRingTemplateClick = true;
      commitPendingRingTemplate(state);
      setTimeout(() => {
        suppressNextRingTemplateClick = false;
      }, 0);
    };
    clearPendingRingTemplateListeners(pendingRingTemplate);
    removeRingTemplatePreview();
    pendingRingTemplate = state;
    doc?.addEventListener?.('mousemove', state.handleMove, true);
    doc?.addEventListener?.('mouseup', state.handleUp, true);
    return true;
  }

  function placeRingTemplateOnAtomClick(event, atomId, atomDatum = null) {
    if (!isRingTemplateMode()) {
      return false;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    if (!isReactionPreviewEditableRingAtom(atomId)) {
      return true;
    }
    if (suppressNextRingTemplateClick) {
      suppressNextRingTemplateClick = false;
      return true;
    }
    const anchorPoint = getRingTemplateAnchorPoint(event, atomId, atomDatum);
    context.view.showPrimitiveHover([atomId], []);
    context.actions.placeRingTemplate?.(context.state.overlayState.getRingTemplateSize?.() ?? 6, anchorPoint.x, anchorPoint.y, {
      anchorAtomId: atomId
    });
    return true;
  }

  function placeRingTemplateOnBondClick(event, bondId) {
    if (!isRingTemplateMode()) {
      return false;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    if (!isReactionPreviewEditableRingBond(bondId)) {
      return true;
    }
    if (suppressNextRingTemplateClick) {
      suppressNextRingTemplateClick = false;
      return true;
    }
    const anchorPoint = pointerPoint(event);
    context.view.showPrimitiveHover([], [bondId]);
    context.actions.placeRingTemplate?.(context.state.overlayState.getRingTemplateSize?.() ?? 6, anchorPoint.x, anchorPoint.y, {
      anchorBondId: bondId,
      autoFuseBondPositionReuse: true
    });
    return true;
  }

  function commitPendingBondRingTemplate(state, event) {
    const anchorPoint = pointerPoint(event);
    const sideSign = state.sideSign;
    const placementOptions = {
      anchorBondId: state.bondId,
      anchorBondSide: sideSign
    };
    if (state.hasDragged === true) {
      placementOptions.allowBondPositionReuse = true;
    } else {
      placementOptions.autoFuseBondPositionReuse = true;
    }
    context.actions.placeRingTemplate?.(state.template ?? state.size, anchorPoint.x, anchorPoint.y, {
      ...placementOptions
    });
  }

  function renderPendingBondRingTemplatePreview(state, event = null) {
    const pointer = event ? pointerPoint(event) : null;
    const sideSign = bondSideSignForPoint(state.anchorA, state.anchorB, pointer, state.sideSign);
    const positions = regularRingPositionsForBondPoints(state.anchorA, state.anchorB, state.size, sideSign);
    if (!positions) {
      return;
    }
    state.sideSign = sideSign;
    state.positions = positions;
    const hoverOptions = {
      allowReuse: state.hasDragged === true,
      requireExistingReuseBond: state.hasDragged !== true,
      knownBondIds: [state.bondId]
    };
    const targets = ringTemplateHoverTargets(positions, state.anchorAtomIds, hoverOptions);
    const aromaticDoubleBondIndices = chooseRingTemplateDoubleBondPreviewIndices({
      template: state.template,
      ringAtomIds: targets.ringAtomIds.length > 0
        ? targets.ringAtomIds
        : [...state.anchorAtomIds, ...Array(Math.max(0, state.size - state.anchorAtomIds.length)).fill(null)],
      anchorBondId: state.bondId
    });
    renderRingTemplatePreviewPositions(positions, 2, { template: state.template, aromaticDoubleBondIndices });
    context.view.showPrimitiveHover(
      [...new Set([...state.anchorAtomIds.filter(Boolean), ...targets.atomIds])],
      [...new Set([[state.bondId].filter(Boolean), targets.bondIds].flat())]
    );
  }

  function startRingTemplatePreviewOnBond(event, bondId, anchorA, anchorB, anchorAtomIds = []) {
    if (!isRingTemplateMode()) {
      return false;
    }
    if (event.button != null && event.button !== 0) {
      return false;
    }
    if (!isFinitePoint(anchorA) || !isFinitePoint(anchorB)) {
      return false;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    clearPendingRingTemplateListeners(pendingRingTemplate);
    pendingRingTemplate = null;
    clearPendingBondRingTemplatePreview(pendingBondRingTemplatePreview);
    const isForce = context.state.viewState.getMode() === 'force';
    const occupiedPoints = isForce ? getForceOccupiedRingPreviewPoints(anchorAtomIds) : get2DOccupiedRingPreviewPoints(anchorAtomIds);
    const template = context.state.overlayState.getRingTemplateSize?.() ?? 6;
    const size = ringTemplateVertexCount(template);
    const [previewAnchorA, previewAnchorB] = forcePreviewBondAnchorPoints(anchorA, anchorB);
    const autoFuseSideSign = isForce ? chooseAutoFuseBondAnchoredRingSide(previewAnchorA, previewAnchorB, size, anchorAtomIds, [bondId]) : null;
    const fallbackSideSign = autoFuseSideSign ?? chooseBondAnchoredRingSide(previewAnchorA, previewAnchorB, size, occupiedPoints);
    if (fallbackSideSign === null) {
      return true;
    }
    const doc = event.currentTarget?.ownerDocument ?? context.document ?? globalThis.document ?? null;
    const startPointer = pointerPoint(event);
    const state = {
      bondId,
      template,
      size,
      anchorA: previewAnchorA,
      anchorB: previewAnchorB,
      anchorAtomIds: [...anchorAtomIds],
      sideSign: bondSideSignForPoint(previewAnchorA, previewAnchorB, pointerPoint(event), fallbackSideSign),
      positions: null,
      startPointer,
      hasDragged: false,
      document: doc,
      handleMove: null,
      handleUp: null
    };
    renderPendingBondRingTemplatePreview(state);
    state.handleMove = moveEvent => {
      if (pendingBondRingTemplatePreview !== state) {
        return;
      }
      moveEvent.preventDefault?.();
      moveEvent.stopPropagation?.();
      moveEvent.stopImmediatePropagation?.();
      const currentPointer = pointerPoint(moveEvent);
      if (pointDistance(currentPointer, state.startPointer) >= RING_TEMPLATE_DRAG_THRESHOLD_PX) {
        state.hasDragged = true;
      }
      renderPendingBondRingTemplatePreview(state, moveEvent);
    };
    state.handleUp = upEvent => {
      if (pendingBondRingTemplatePreview !== state) {
        return;
      }
      upEvent.preventDefault?.();
      upEvent.stopPropagation?.();
      upEvent.stopImmediatePropagation?.();
      clearPendingBondRingTemplatePreview(state);
      suppressNextRingTemplateClick = true;
      commitPendingBondRingTemplate(state, upEvent);
      setTimeout(() => {
        suppressNextRingTemplateClick = false;
      }, 0);
    };
    pendingBondRingTemplatePreview = state;
    doc?.addEventListener?.('mousemove', state.handleMove, true);
    doc?.addEventListener?.('mouseup', state.handleUp, true);
    return true;
  }

  function isPaintBrushMode() {
    return isPaintMode() && (context.state.overlayState.getPaintTool?.() ?? 'brush') === 'brush';
  }

  function isPaintEraserMode() {
    return isPaintMode() && context.state.overlayState.getPaintTool?.() === 'eraser';
  }

  function suppressPaintModeTooltip() {
    if (!isPaintMode()) {
      return false;
    }
    context.tooltip.hide();
    return true;
  }

  function showPrimitiveHover(atomIds = [], bondIds = []) {
    if (context.view.isPrimitiveHoverSuppressed?.()) {
      context.view.setPrimitiveHoverSuppressed?.(false);
    }
    context.view.showPrimitiveHover(atomIds, bondIds);
    return true;
  }

  function maybeRefreshDrawBondHover(id, kind) {
    if (!context.state.overlayState.getDrawBondMode() || context.view.isDrawBondHoverSuppressed()) {
      return;
    }
    if (kind === 'atom') {
      context.state.overlayState.getHoveredAtomIds().add(id);
    } else {
      context.state.overlayState.getHoveredBondIds().add(id);
    }
    context.view.refreshSelectionOverlay();
  }

  function clearHoverOnExit() {
    if (context.drawBond.hasDrawBondState()) {
      context.drawBond.resetHover();
    } else {
      context.view.clearPrimitiveHover();
      context.view.refreshSelectionOverlay();
    }
  }

  function handle2dBondClick(event, bondId) {
    if (placeRingTemplateOnBondClick(event, bondId)) {
      return;
    }
    if (context.state.overlayState.getDrawBondMode()) {
      context.actions.promoteBondOrder(bondId, { drawBondType: context.drawBond.getType?.() ?? 'single' });
      return;
    }
    if (isPaintBrushMode()) {
      context.actions.paintStyleTargets([], [bondId], getPaintStyle());
      return;
    }
    if (isPaintEraserMode()) {
      context.actions.paintStyleTargets([], [bondId], null);
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      context.actions.eraseItem([], [bondId]);
      return;
    }
    context.selection.handle2dPrimitiveClick(event, [], [bondId]);
  }

  function handle2dBondMouseDownRingTemplate(event, bondId, anchorA, anchorB, anchorAtomIds = []) {
    if (isRingTemplateMode() && !isReactionPreviewEditableRingBond(bondId, anchorAtomIds)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return true;
    }
    return startRingTemplatePreviewOnBond(event, bondId, anchorA, anchorB, anchorAtomIds);
  }

  function handle2dBondDblClick(event, atomIds) {
    context.selection.handle2dComponentDblClick(event, atomIds);
  }

  function handle2dBondMouseOver(event, bond, atom1, atom2) {
    const chargeTool = getChargeTool();
    if (chargeTool) {
      return;
    }
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      showPrimitiveHover([], [bond.id]);
      return;
    }
    if (!showPrimitiveHover([], [bond.id])) {
      return;
    }
    maybeRefreshDrawBondHover(bond.id, 'bond');
    const paintTooltipSuppressed = suppressPaintModeTooltip();
    if (isRingTemplateMode() || paintTooltipSuppressed || context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) {
      if (!paintTooltipSuppressed) {
        context.tooltip.hide();
      }
      return;
    }
    context.tooltip.showDelayed(context.formatters.bondTooltipHtml(bond, atom1, atom2), event, 150);
  }

  function handle2dBondMouseMove(event) {
    context.tooltip.move(event);
  }

  function handle2dBondMouseOut() {
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handle2dAtomMouseDownDrawBond(event, atomId) {
    if (startRingTemplateOnAtom(event, atomId)) {
      return;
    }
    if (!context.state.overlayState.getDrawBondMode() || context.state.viewState.getMode() !== '2d' || !context.state.documentState.getMol2d()) {
      return;
    }
    if (!context.overlays.isReactionPreviewEditableAtomId(atomId)) {
      return;
    }
    event.stopPropagation();
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    context.drawBond.start(atomId, gX, gY);
  }

  function handle2dAtomClick(event, atomId) {
    if (placeRingTemplateOnAtomClick(event, atomId)) {
      return;
    }
    if (context.state.overlayState.getDrawBondMode()) {
      return;
    }
    if (isPaintBrushMode()) {
      context.actions.paintStyleTargets([atomId], [], getPaintStyle());
      return;
    }
    if (isPaintEraserMode()) {
      context.actions.paintStyleTargets([atomId], [], null);
      return;
    }
    const chargeTool = getChargeTool();
    if (chargeTool) {
      context.actions.changeAtomCharge(atomId, {
        chargeTool,
        decrement: false
      });
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      context.actions.eraseItem([atomId], []);
      return;
    }
    context.selection.handle2dPrimitiveClick(event, [atomId], []);
  }

  function handle2dAtomContextMenu(event, atom) {
    const chargeTool = getChargeTool();
    if (!chargeTool) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    context.actions.changeAtomCharge(atom.id ?? atom, {
      chargeTool,
      decrement: true
    });
  }

  function handle2dAtomDblClick(event, atomId) {
    context.selection.handle2dComponentDblClick(event, [atomId]);
  }

  function handle2dAtomMouseOver(event, atom, mol, valenceWarning) {
    const chargeTool = getChargeTool();
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      showPrimitiveHover([atom.id], []);
      return;
    }
    if (!showPrimitiveHover([atom.id], [])) {
      return;
    }
    maybeRefreshDrawBondHover(atom.id, 'atom');
    const showAtomTooltips = context.options.getRenderOptions().showAtomTooltips;
    if (
      chargeTool ||
      isRingTemplateMode() ||
      suppressPaintModeTooltip() ||
      !showAtomTooltips ||
      (context.state.overlayState.getEraseMode() && !valenceWarning) ||
      ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode()) && !valenceWarning)
    ) {
      return;
    }
    if ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) && valenceWarning) {
      context.tooltipState.setSelectionValenceTooltipAtomId(atom.id);
      context.tooltip.showImmediate(context.formatters.atomTooltipHtml(atom, mol, valenceWarning, '2d'), event);
      return;
    }
    context.tooltip.showDelayed(context.formatters.atomTooltipHtml(atom, mol, valenceWarning, '2d'), event, 150);
  }

  function handle2dAtomMouseMove(event) {
    context.tooltip.move(event);
  }

  function handle2dAtomMouseOut(atomId) {
    if (context.state.overlayState.getSelectMode() && context.tooltipState.getSelectionValenceTooltipAtomId() === atomId) {
      return;
    }
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handleForceBondClick(event, bondId, molecule) {
    if (isRingTemplateMode()) {
      const bond = molecule.bonds.get(bondId);
      if (bond?.atoms.some(id => molecule.atoms.get(id)?.name === 'H')) {
        return;
      }
    }
    if (placeRingTemplateOnBondClick(event, bondId)) {
      return;
    }
    if (context.state.overlayState.getDrawBondMode()) {
      context.actions.promoteBondOrder(bondId, { drawBondType: context.drawBond.getType?.() ?? 'single' });
      return;
    }
    if (isPaintBrushMode()) {
      context.actions.paintStyleTargets([], [bondId], getPaintStyle());
      return;
    }
    if (isPaintEraserMode()) {
      context.actions.paintStyleTargets([], [bondId], null);
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      const bond = molecule.bonds.get(bondId);
      if (bond?.atoms.some(id => molecule.atoms.get(id)?.name === 'H')) {
        return;
      }
      context.actions.eraseItem([], [bondId]);
      return;
    }
    context.selection.handleForcePrimitiveClick(event, [], [bondId]);
  }

  function handleForceBondMouseDownRingTemplate(event, linkDatum) {
    const source = linkDatum?.source;
    const target = linkDatum?.target;
    if (isRingTemplateMode() && !isReactionPreviewEditableRingBond(linkDatum?.id, [source?.id, target?.id].filter(Boolean))) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return true;
    }
    return startRingTemplatePreviewOnBond(event, linkDatum?.id, source, target, [source?.id, target?.id].filter(Boolean));
  }

  function handleForceBondDblClick(event, atomIds) {
    context.selection.handleForceComponentDblClick(event, atomIds);
  }

  function handleForceBondMouseOver(event, bondId, molecule) {
    const chargeTool = getChargeTool();
    if (chargeTool) {
      return;
    }
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      const bond = molecule.bonds.get(bondId);
      if (bond?.atoms.some(id => molecule.atoms.get(id)?.name === 'H')) {
        return;
      }
      showPrimitiveHover([], [bondId]);
      return;
    }
    if (!showPrimitiveHover([], [bondId])) {
      return;
    }
    maybeRefreshDrawBondHover(bondId, 'bond');
    const paintTooltipSuppressed = suppressPaintModeTooltip();
    if (isRingTemplateMode() || paintTooltipSuppressed || context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) {
      if (!paintTooltipSuppressed) {
        context.tooltip.hide();
      }
      return;
    }
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      return;
    }
    const atom1 = molecule.atoms.get(bond.atoms[0]);
    const atom2 = molecule.atoms.get(bond.atoms[1]);
    if (!atom1 || !atom2) {
      return;
    }
    context.tooltip.showDelayed(context.formatters.bondTooltipHtml(bond, atom1, atom2), event, 150);
  }

  function handleForceBondMouseMove(event) {
    context.tooltip.move(event);
  }

  function handleForceBondMouseOut() {
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handleForceAtomMouseDownDrawBond(event, atom) {
    if (startRingTemplateOnAtom(event, atom.id, atom)) {
      return;
    }
    if (!context.state.overlayState.getDrawBondMode() || context.state.viewState.getMode() !== 'force' || !context.state.documentState.getCurrentMol()) {
      return;
    }
    if (atom.name === 'H') {
      return;
    }
    if (!context.overlays.isReactionPreviewEditableAtomId(atom.id)) {
      return;
    }
    event.stopPropagation();
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    context.drawBond.start(atom.id, gX, gY);
  }

  function handleForceAtomClick(event, atom, molecule) {
    if (placeRingTemplateOnAtomClick(event, atom.id, atom)) {
      return;
    }
    if (context.state.overlayState.getDrawBondMode()) {
      if (!context.overlays.isReactionPreviewEditableAtomId(atom.id)) {
        event.stopPropagation();
        return;
      }
      if (atom.name === 'H' && atom.name !== context.drawBond.getElement()) {
        event.stopPropagation();
        const drawType = context.drawBond.getType?.() ?? 'single';
        if (drawType === 'wedge' || drawType === 'dash') {
          const molAtom = molecule.atoms.get(atom.id);
          const parentAtom = molAtom?.getNeighbors(molecule).find(n => n.name !== 'H');
          if (parentAtom) {
            const [gX, gY] = context.pointer(event, context.dom.gNode());
            context.actions.autoPlaceBond(parentAtom.id, gX, gY);
            return;
          }
        }
        context.actions.replaceForceHydrogenAtom(atom.id, molecule);
      }
      return;
    }
    const chargeTool = getChargeTool();
    if (isPaintBrushMode()) {
      context.actions.paintStyleTargets([atom.id], [], getPaintStyle());
      return;
    }
    if (isPaintEraserMode()) {
      context.actions.paintStyleTargets([atom.id], [], null);
      return;
    }
    if (chargeTool) {
      if (atom.name === 'H') {
        return;
      }
      context.actions.changeAtomCharge(atom.id, {
        chargeTool,
        decrement: false
      });
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      if (atom.name === 'H') {
        return;
      }
      context.actions.eraseItem([atom.id], []);
      return;
    }
    context.selection.handleForcePrimitiveClick(event, [atom.id], []);
  }

  function handleForceAtomContextMenu(event, atom) {
    const chargeTool = getChargeTool();
    if (!chargeTool) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (atom.name === 'H') {
      return;
    }
    context.actions.changeAtomCharge(atom.id, {
      chargeTool,
      decrement: true
    });
  }

  function handleForceAtomDblClick(event, atomId) {
    context.selection.handleForceComponentDblClick(event, [atomId]);
  }

  function handleForceAtomMouseOver(event, atomNode, molecule, valenceWarning) {
    const chargeTool = getChargeTool();
    if (chargeTool && atomNode.name === 'H') {
      return;
    }
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      if (atomNode.name === 'H') {
        return;
      }
      showPrimitiveHover([atomNode.id], []);
      return;
    }
    if (!showPrimitiveHover([atomNode.id], [])) {
      return;
    }
    maybeRefreshDrawBondHover(atomNode.id, 'atom');
    const atom = molecule.atoms.get(atomNode.id);
    if (!atom) {
      return;
    }
    const showAtomTooltips = context.options.getRenderOptions().showAtomTooltips;
    if (
      chargeTool ||
      isRingTemplateMode() ||
      suppressPaintModeTooltip() ||
      !showAtomTooltips ||
      (context.state.overlayState.getEraseMode() && !valenceWarning) ||
      ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode()) && !valenceWarning)
    ) {
      return;
    }
    if ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) && valenceWarning) {
      context.tooltipState.setSelectionValenceTooltipAtomId(atomNode.id);
      context.tooltip.showImmediate(context.formatters.atomTooltipHtml(atom, molecule, valenceWarning, 'force'), event);
      return;
    }
    context.tooltip.showDelayed(context.formatters.atomTooltipHtml(atom, molecule, valenceWarning, 'force'), event, 200);
  }

  function handleForceAtomMouseMove(event) {
    context.tooltip.move(event);
  }

  function handleForceAtomMouseOut(atomId) {
    if (context.state.overlayState.getSelectMode() && context.tooltipState.getSelectionValenceTooltipAtomId() === atomId) {
      return;
    }
    clearHoverOnExit();
    context.tooltip.hide();
  }

  return {
    handle2dBondClick,
    handle2dBondMouseDownRingTemplate,
    handle2dBondDblClick,
    handle2dBondMouseOver,
    handle2dBondMouseMove,
    handle2dBondMouseOut,
    handle2dAtomMouseDownDrawBond,
    handle2dAtomClick,
    handle2dAtomContextMenu,
    handle2dAtomDblClick,
    handle2dAtomMouseOver,
    handle2dAtomMouseMove,
    handle2dAtomMouseOut,
    handleForceBondClick,
    handleForceBondMouseDownRingTemplate,
    handleForceBondDblClick,
    handleForceBondMouseOver,
    handleForceBondMouseMove,
    handleForceBondMouseOut,
    handleForceAtomMouseDownDrawBond,
    handleForceAtomClick,
    handleForceAtomContextMenu,
    handleForceAtomDblClick,
    handleForceAtomMouseOver,
    handleForceAtomMouseMove,
    handleForceAtomMouseOut
  };
}
