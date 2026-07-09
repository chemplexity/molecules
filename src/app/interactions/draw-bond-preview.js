/** @module app/interactions/draw-bond-preview */

import { angularDifference, chooseAutoPlacedBondAngle, TAU } from './draw-bond-placement.js';

const BLANK_SPACE_DRAW_DISTANCE_THRESHOLD = 30;
const DRAW_BOND_ROTATION_SNAP = Math.PI / 6;
const DEFAULT_LAYOUT_BOND_LENGTH = 1.5;

function currentLayoutBondLength(context) {
  const parsed = Number(context.options?.getRenderOptions?.().layoutBondLength);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LAYOUT_BOND_LENGTH;
}

function currentForcePreviewBondLength(context, layoutBondLength = currentLayoutBondLength(context)) {
  const baseForceBondLength = Number(context.constants.forceBondLength);
  const fallbackForceBondLength = layoutBondLength * (context.constants.scale ?? 1);
  const forceBondLength = Number.isFinite(baseForceBondLength) && baseForceBondLength > 0 ? baseForceBondLength : fallbackForceBondLength;
  return forceBondLength * (layoutBondLength / DEFAULT_LAYOUT_BOND_LENGTH);
}

/**
 * Creates draw-bond preview action handlers that manage the transient preview geometry shown while the user drags to place a new bond.
 * @param {object} context - Dependency context providing g, state, getMode, force, view2D, plot, renderers, view, helpers, constants, overlays, and getDrawBondElement.
 * @returns {object} Object with `clearArtifacts`, `start`, `update`, `resetHover`, `cancel`, and `markDragged`.
 */
export function createDrawBondPreviewActions(context) {
  const hiddenPreviewSources = [];

  function restoreHiddenPreviewSources() {
    while (hiddenPreviewSources.length > 0) {
      const { element, previousVisibility, previousOpacity } = hiddenPreviewSources.pop();
      if (!element?.style) {
        continue;
      }
      element.style.visibility = previousVisibility;
      element.style.opacity = previousOpacity;
    }
  }

  function hideExistingBondForPreview(sourceElement) {
    const container = sourceElement?.closest?.('[data-bond-id]') ?? sourceElement?.parentNode ?? null;
    const bondLines = [...(container?.querySelectorAll?.('line.bond') ?? [])].filter(element => !element.classList?.contains?.('bond-hit'));
    for (const element of bondLines) {
      if (hiddenPreviewSources.some(entry => entry.element === element)) {
        continue;
      }
      hiddenPreviewSources.push({
        element,
        previousVisibility: element.style.visibility,
        previousOpacity: element.style.opacity
      });
      element.style.visibility = 'hidden';
      element.style.opacity = '0';
    }
  }

  function removePreviewGeometry() {
    restoreHiddenPreviewSources();
    context.g.select('g.draw-bond-preview').remove();
  }

  function clearArtifacts() {
    removePreviewGeometry();
    context.g.select('circle.draw-bond-origin-node').remove();
    context.g.select('circle.draw-bond-dest-node').remove();
    context.g.select('text.draw-bond-origin-label').remove();
    context.g.select('text.draw-bond-dest-label').remove();
  }

  function appendPreviewLine(container, x1, y1, x2, y2, options = {}) {
    const isForceMode = context.getMode() === 'force';
    const strokeWidth = options.strokeWidth ?? (isForceMode ? parseFloat(context.helpers.singleBondWidth(1)) : context.constants.strokeWidth);
    const defaultStroke = isForceMode ? '#696969' : '#111';
    const line = container
      .append('line')
      .attr('class', options.className ?? 'draw-bond-preview-segment')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', options.stroke ?? defaultStroke)
      .attr('stroke-width', strokeWidth)
      .attr('stroke-linecap', 'round')
      .attr('pointer-events', 'none');
    if (options.dasharray) {
      line.attr('stroke-dasharray', options.dasharray);
    }
  }

  function renderPreviewGeometry(x1, y1, x2, y2, options = {}) {
    removePreviewGeometry();
    const group = context.g.insert('g', ':scope > circle').attr('class', 'draw-bond-preview').attr('pointer-events', 'none');
    const drawBondType = options.drawBondType ?? context.getDrawBondType?.() ?? 'single';
    const isForce = context.getMode() === 'force';
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const parallelOffset = isForce ? 3 : (context.constants.bondOffset2d ?? 7);
    const wedgeHalfWidth = isForce ? 5 : 6;
    if (drawBondType === 'wedge') {
      group
        .append('polygon')
        .attr('class', 'draw-bond-preview-wedge')
        .attr('points', `${x1},${y1} ${x2 - nx * wedgeHalfWidth},${y2 - ny * wedgeHalfWidth} ${x2 + nx * wedgeHalfWidth},${y2 + ny * wedgeHalfWidth}`)
        .attr('fill', '#111')
        .attr('pointer-events', 'none');
      return;
    }

    if (drawBondType === 'dash') {
      const dashCount = 6;
      for (let i = 1; i <= dashCount; i++) {
        const t = i / (dashCount + 1);
        const px = x1 + dx * t;
        const py = y1 + dy * t;
        const halfWidth = wedgeHalfWidth * t;
        appendPreviewLine(group, px - nx * halfWidth, py - ny * halfWidth, px + nx * halfWidth, py + ny * halfWidth, {
          className: 'draw-bond-preview-hash',
          strokeWidth: 1.2
        });
      }
      return;
    }

    if (drawBondType === 'double') {
      if (isForce) {
        appendPreviewLine(group, x1, y1, x2, y2, {
          strokeWidth: parseFloat(context.helpers.singleBondWidth(2)),
          className: 'draw-bond-preview-segment'
        });
        appendPreviewLine(group, x1, y1, x2, y2, {
          stroke: '#fff',
          strokeWidth: 2.1,
          className: 'draw-bond-preview-segment'
        });
        return;
      }
      appendPreviewLine(group, x1 - nx * parallelOffset * 0.5, y1 - ny * parallelOffset * 0.5, x2 - nx * parallelOffset * 0.5, y2 - ny * parallelOffset * 0.5);
      appendPreviewLine(group, x1 + nx * parallelOffset * 0.5, y1 + ny * parallelOffset * 0.5, x2 + nx * parallelOffset * 0.5, y2 + ny * parallelOffset * 0.5);
      return;
    }

    if (drawBondType === 'triple') {
      if (isForce) {
        const forceOffset = 2;
        appendPreviewLine(group, x1, y1, x2, y2, {
          strokeWidth: parseFloat(context.helpers.singleBondWidth(3)),
          className: 'draw-bond-preview-segment'
        });
        appendPreviewLine(group, x1 - nx * forceOffset, y1 - ny * forceOffset, x2 - nx * forceOffset, y2 - ny * forceOffset, {
          stroke: '#fff',
          strokeWidth: 2.1,
          className: 'draw-bond-preview-segment'
        });
        appendPreviewLine(group, x1 + nx * forceOffset, y1 + ny * forceOffset, x2 + nx * forceOffset, y2 + ny * forceOffset, {
          stroke: '#fff',
          strokeWidth: 2.1,
          className: 'draw-bond-preview-segment'
        });
        return;
      }
      appendPreviewLine(group, x1 - nx * parallelOffset, y1 - ny * parallelOffset, x2 - nx * parallelOffset, y2 - ny * parallelOffset);
      appendPreviewLine(group, x1, y1, x2, y2);
      appendPreviewLine(group, x1 + nx * parallelOffset, y1 + ny * parallelOffset, x2 + nx * parallelOffset, y2 + ny * parallelOffset);
      return;
    }

    if (drawBondType === 'aromatic') {
      appendPreviewLine(group, x1 - nx * parallelOffset * 0.5, y1 - ny * parallelOffset * 0.5, x2 - nx * parallelOffset * 0.5, y2 - ny * parallelOffset * 0.5);
      appendPreviewLine(group, x1 + nx * parallelOffset * 0.5, y1 + ny * parallelOffset * 0.5, x2 + nx * parallelOffset * 0.5, y2 + ny * parallelOffset * 0.5, {
        className: 'draw-bond-preview-dashed',
        dasharray: '4 3',
        strokeWidth: isForce ? 2.2 : 1.6
      });
      return;
    }

    appendPreviewLine(group, x1, y1, x2, y2);
  }

  function rerenderSelectionOverlay() {
    if (context.getMode() === 'force') {
      context.renderers.applyForceSelection();
    } else {
      context.renderers.redraw2dSelection();
    }
  }

  function getAtomBondEntries(mol, atom) {
    const bondIds = atom?.bonds ?? [];
    return [...bondIds].map(bondId => mol?.bonds?.get?.(bondId)).filter(Boolean);
  }

  function getBondOtherAtomId(bond, atomId) {
    return bond?.getOtherAtom?.(atomId) ?? bond?.atoms?.find?.(id => id !== atomId) ?? null;
  }

  function heavyParentForHydrogen(mol, hydrogenId) {
    const hydrogen = mol?.atoms?.get?.(hydrogenId);
    if (!hydrogen || hydrogen.name !== 'H') {
      return null;
    }
    for (const bondId of hydrogen.bonds ?? []) {
      const bond = mol?.bonds?.get?.(bondId);
      const parentId = getBondOtherAtomId(bond, hydrogenId);
      const parentAtom = mol?.atoms?.get?.(parentId);
      if (parentAtom && parentAtom.name !== 'H' && parentAtom.visible !== false) {
        return { atom: parentAtom, bond };
      }
    }
    return null;
  }

  function getPreviewSourceAtom(atomId) {
    const mol = context.molecule?.getActive?.() ?? null;
    return mol?.atoms?.get?.(atomId) ?? (context.getMode() === '2d' ? context.view2D.getAtomById(atomId) : null);
  }

  function noDragWouldReplaceAtom(atomId) {
    const atom = getPreviewSourceAtom(atomId);
    return Boolean(atom && atom.name !== context.getDrawBondElement());
  }

  function getRenderableAtomHighlightIds() {
    const hoveredAtomIds = context.state.getHoveredAtomIds?.() ?? new Set();
    const selectedAtomIds = context.state.getSelectedAtomIds?.() ?? new Set();
    const selectedBondIds = context.state.getSelectedBondIds?.() ?? new Set();
    if (selectedAtomIds.size === 0 && selectedBondIds.size === 0) {
      return hoveredAtomIds;
    }
    if (!context.state.getSelectionModifierActive?.()) {
      return selectedAtomIds;
    }
    return new Set([...selectedAtomIds, ...hoveredAtomIds]);
  }

  function atomScreenPoint2d(atom, width, height) {
    const projectedPoint = context.helpers.toSelectionSVGPt2d?.(atom) ?? null;
    if (projectedPoint && Number.isFinite(projectedPoint.x) && Number.isFinite(projectedPoint.y)) {
      return projectedPoint;
    }
    if (atom?.x == null || atom.visible === false) {
      return null;
    }
    return {
      x: width / 2 + (atom.x - context.view2D.getCenterX()) * context.constants.scale,
      y: height / 2 - (atom.y - context.view2D.getCenterY()) * context.constants.scale
    };
  }

  function chooseSnapCandidate(candidates, mx, my, snapRadius, preferredAtomIds = null) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (preferredAtomIds && !preferredAtomIds.has(candidate.id)) {
        continue;
      }
      const distance = Math.hypot(mx - candidate.x, my - candidate.y);
      if (distance <= snapRadius && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  function forceHydrogenParentCandidate(node, mol) {
    if (context.getMode() !== 'force' || node?.name !== 'H') {
      return null;
    }
    const atom = mol?.atoms?.get?.(node.id) ?? null;
    const bondIds = Array.isArray(atom?.bonds) ? atom.bonds : [...(mol?.bonds?.values?.() ?? [])].filter(bond => bond?.atoms?.includes?.(node.id)).map(bond => bond.id);
    for (const bondId of bondIds) {
      const bond = mol?.bonds?.get?.(bondId);
      const parentId = bond?.getOtherAtom?.(node.id) ?? bond?.atoms?.find?.(id => id !== node.id);
      const parentAtom = mol?.atoms?.get?.(parentId);
      if (!parentAtom || parentAtom.name === 'H' || parentAtom.visible === false) {
        continue;
      }
      const parentNode = context.force.getNodeById(parentId);
      if (Number.isFinite(parentNode?.x) && Number.isFinite(parentNode?.y)) {
        return { id: parentNode.id, x: parentNode.x, y: parentNode.y };
      }
    }
    return null;
  }

  function getAutoPlacedPreviewEndpoint(atomId, ox, oy) {
    const mode = context.getMode();
    const layoutBondLength = currentLayoutBondLength(context);
    const bondLength = mode === 'force' ? currentForcePreviewBondLength(context, layoutBondLength) : layoutBondLength * context.constants.scale;
    const fallbackAngle = chooseAutoPlacedBondAngle([]);
    const fallbackEndpoint =
      mode === 'force'
        ? { x: ox + Math.cos(fallbackAngle) * bondLength, y: oy + Math.sin(fallbackAngle) * bondLength }
        : { x: ox + Math.cos(fallbackAngle) * bondLength, y: oy - Math.sin(fallbackAngle) * bondLength };
    const mol = context.molecule?.getActive?.() ?? null;
    const srcAtom = mol?.atoms?.get?.(atomId) ?? null;
    if (!srcAtom) {
      return fallbackEndpoint;
    }

    let srcRX;
    let srcRY;
    if (mode === 'force') {
      const srcNode = context.force.getNodeById(atomId);
      srcRX = srcNode ? srcNode.x : ox;
      srcRY = srcNode ? srcNode.y : oy;
    } else {
      srcRX = srcAtom.x;
      srcRY = srcAtom.y;
    }
    if (!Number.isFinite(srcRX) || !Number.isFinite(srcRY)) {
      return fallbackEndpoint;
    }

    const existingAngles = [];
    for (const bond of getAtomBondEntries(mol, srcAtom)) {
      const otherId = getBondOtherAtomId(bond, atomId);
      const otherAtom = mol.atoms.get(otherId);
      if (!otherAtom || otherAtom.name === 'H') {
        continue;
      }
      if (mode === 'force') {
        const otherNode = context.force.getNodeById(otherId);
        if (otherNode) {
          existingAngles.push(Math.atan2(otherNode.y - srcRY, otherNode.x - srcRX));
        }
      } else if (otherAtom.x != null && otherAtom.visible !== false) {
        existingAngles.push(Math.atan2(otherAtom.y - srcRY, otherAtom.x - srcRX));
      }
    }

    let angle = chooseAutoPlacedBondAngle(existingAngles);
    const sourceHydrogenIds = new Set((srcAtom.getNeighbors?.(mol) ?? []).filter(neighbor => neighbor.name === 'H').map(neighbor => neighbor.id));
    const modelBondLength = mode === 'force' ? bondLength : layoutBondLength;
    const thresholdSq = (modelBondLength * 0.7) ** 2;
    const overlaps = candidate => {
      const px = srcRX + Math.cos(candidate) * modelBondLength;
      const py = srcRY + Math.sin(candidate) * modelBondLength;
      if (mode === 'force') {
        for (const node of context.force.getNodes()) {
          if (node.id === atomId || sourceHydrogenIds.has(node.id)) {
            continue;
          }
          const dx = node.x - px;
          const dy = node.y - py;
          if (dx * dx + dy * dy < thresholdSq) {
            return true;
          }
        }
        return false;
      }
      for (const [id, atom] of mol.atoms) {
        if (id === atomId || sourceHydrogenIds.has(id) || atom.x == null || atom.visible === false) {
          continue;
        }
        const dx = atom.x - px;
        const dy = atom.y - py;
        if (dx * dx + dy * dy < thresholdSq) {
          return true;
        }
      }
      return false;
    };

    if (overlaps(angle)) {
      let fallback = angle;
      let bestSep = -1;
      for (let i = 0; i < 12; i++) {
        const candidate = (i / 12) * TAU;
        if (overlaps(candidate)) {
          continue;
        }
        let minSep = Math.PI;
        for (const existingAngle of existingAngles) {
          minSep = Math.min(minSep, angularDifference(candidate, existingAngle));
        }
        if (minSep > bestSep) {
          bestSep = minSep;
          fallback = candidate;
        }
      }
      angle = fallback;
    }

    return mode === 'force' ? { x: ox + Math.cos(angle) * bondLength, y: oy + Math.sin(angle) * bondLength } : { x: ox + Math.cos(angle) * bondLength, y: oy - Math.sin(angle) * bondLength };
  }

  function renderPreviewFromState(drawBondState, snapAtomId = null) {
    const { ox, oy, ex, ey } = drawBondState;
    if (context.getMode() !== 'force') {
      const dx = ex - ox;
      const dy = ey - oy;
      const dist = Math.hypot(dx, dy);
      let lx1 = ox;
      let ly1 = oy;
      let lx2 = ex;
      let ly2 = ey;
      if (dist > 1) {
        const ux = dx / dist;
        const uy = dy / dist;
        const sourceName = drawBondState.atomId ? (context.view2D.getAtomById(drawBondState.atomId)?.name ?? 'C') : context.getDrawBondElement();
        if (sourceName !== 'C' && drawBondState.sourceIsProjectedStereoHydrogen !== true) {
          const gap = context.helpers.labelHalfW(sourceName, context.constants.fontSize) + 3;
          lx1 = ox + ux * gap;
          ly1 = oy + uy * gap;
        }
        const destName = snapAtomId ? (context.view2D.getAtomById(snapAtomId)?.name ?? 'C') : context.getDrawBondElement();
        if (destName !== 'C') {
          const gap = context.helpers.labelHalfW(destName, context.constants.fontSize) + 3;
          lx2 = ex - ux * gap;
          ly2 = ey - uy * gap;
        }
      }
      renderPreviewGeometry(lx1, ly1, lx2, ly2);
      return;
    }
    renderPreviewGeometry(ox, oy, ex, ey);
  }

  function renderAtomReplacementPreview(atomId, x, y) {
    removePreviewGeometry();
    const group = context.g.insert('g', ':scope > circle').attr('class', 'draw-bond-preview').attr('pointer-events', 'none');
    const targetElement = context.getDrawBondElement();
    if (targetElement !== 'C') {
      group
        .append('text')
        .attr('class', 'draw-bond-replacement-label')
        .attr('x', x)
        .attr('y', y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', context.helpers.atomColor(targetElement, '2d'))
        .attr('font-size', context.constants.fontSize)
        .attr('font-weight', 'bold')
        .attr('pointer-events', 'none')
        .text(targetElement);
    }
  }

  function start(atomId, gX, gY) {
    if (!context.overlays.isReactionPreviewEditableAtomId(atomId)) {
      return;
    }

    let ox;
    let oy;
    let sourceIsProjectedStereoHydrogen = false;
    if (atomId === null) {
      ox = gX;
      oy = gY;
    } else if (context.getMode() === 'force') {
      const node = context.force.getNodeById(atomId);
      ox = node ? node.x : gX;
      oy = node ? node.y : gY;
    } else {
      const atom = context.view2D.getAtomById(atomId);
      if (!atom || atom.x == null) {
        return;
      }
      const projectedPoint = context.helpers.toSelectionSVGPt2d?.(atom) ?? null;
      if (projectedPoint && Number.isFinite(projectedPoint.x) && Number.isFinite(projectedPoint.y)) {
        ox = projectedPoint.x;
        oy = projectedPoint.y;
        sourceIsProjectedStereoHydrogen = atom.name === 'H';
      } else {
        const { width, height } = context.plot.getSize();
        ox = width / 2 + (atom.x - context.view2D.getCenterX()) * context.constants.scale;
        oy = height / 2 - (atom.y - context.view2D.getCenterY()) * context.constants.scale;
      }
    }

    const suppressInitialPlacementPreview = atomId !== null && noDragWouldReplaceAtom(atomId) && !sourceIsProjectedStereoHydrogen;
    const endpoint = atomId === null || suppressInitialPlacementPreview ? { x: ox, y: oy } : getAutoPlacedPreviewEndpoint(atomId, ox, oy);
    const ex = endpoint.x;
    const ey = endpoint.y;
    const nextDrawBondState = {
      atomId,
      ox,
      oy,
      ex,
      ey,
      dragged: false,
      ...(sourceIsProjectedStereoHydrogen
        ? {
            sourceIsProjectedStereoHydrogen: true,
            allowedHydrogenParentId: heavyParentForHydrogen(context.molecule?.getActive?.() ?? null, atomId)?.atom?.id ?? null
          }
        : {})
    };
    context.state.setDrawBondState(nextDrawBondState);
    if (atomId !== null && !suppressInitialPlacementPreview && !sourceIsProjectedStereoHydrogen) {
      renderPreviewFromState(nextDrawBondState);
    } else if (atomId !== null && suppressInitialPlacementPreview && context.getMode() === '2d') {
      renderAtomReplacementPreview(atomId, ox, oy);
    }

    if (context.getMode() === 'force') {
      const drawElemProtons = context.getDrawElemProtons();
      const radius = context.helpers.atomRadius(drawElemProtons[context.getDrawBondElement()] ?? 6);
      const fill = context.helpers.atomColor(context.getDrawBondElement(), 'force');
      const stroke = context.helpers.strokeColor(context.getDrawBondElement());
      if (atomId === null) {
        context.g
          .append('circle')
          .attr('class', 'draw-bond-origin-node')
          .attr('cx', ox)
          .attr('cy', oy)
          .attr('r', radius)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 1)
          .attr('pointer-events', 'none');
      }
      if (atomId !== null && !suppressInitialPlacementPreview) {
        context.g
          .append('circle')
          .attr('class', 'draw-bond-dest-node')
          .attr('cx', ex)
          .attr('cy', ey)
          .attr('r', radius)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 1)
          .attr('pointer-events', 'none');
      }
    } else {
      const fill = context.helpers.atomColor(context.getDrawBondElement(), '2d');
      if (atomId === null) {
        context.g
          .append('text')
          .attr('class', 'draw-bond-origin-label')
          .attr('x', ox)
          .attr('y', oy)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', fill)
          .attr('font-size', context.constants.fontSize)
          .attr('font-weight', 'bold')
          .attr('pointer-events', 'none')
          .text(context.getDrawBondElement());
      }
      if (atomId !== null && !suppressInitialPlacementPreview && context.getDrawBondElement() !== 'C') {
        context.g
          .append('text')
          .attr('class', 'draw-bond-dest-label')
          .attr('x', ex)
          .attr('y', ey)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', fill)
          .attr('font-size', context.constants.fontSize)
          .attr('font-weight', 'bold')
          .attr('pointer-events', 'none')
          .text(context.getDrawBondElement());
      }
    }
  }

  function isFreeRotation(options = {}) {
    return options.ctrlKey === true || options.metaKey === true;
  }

  function snappedPreviewEndpoint(ox, oy, mx, my, bondLength, options = {}) {
    const dist = Math.hypot(mx - ox, my - oy);
    if (dist < 1e-6) {
      return { x: ox + bondLength, y: oy };
    }
    const clamped = Math.min(dist, bondLength);
    if (isFreeRotation(options)) {
      return {
        x: ox + ((mx - ox) / dist) * clamped,
        y: oy + ((my - oy) / dist) * clamped
      };
    }
    const graphAngle = Math.atan2(oy - my, mx - ox);
    const snappedAngle = Math.round(graphAngle / DRAW_BOND_ROTATION_SNAP) * DRAW_BOND_ROTATION_SNAP;
    return {
      x: ox + Math.cos(snappedAngle) * clamped,
      y: oy - Math.sin(snappedAngle) * clamped
    };
  }

  function update([mx, my], options = {}) {
    const drawBondState = context.state.getDrawBondState();
    if (!drawBondState) {
      return;
    }

    const { ox, oy } = drawBondState;
    const blankSpaceDragDistance = drawBondState.atomId === null ? Math.hypot(mx - ox, my - oy) : Infinity;
    if (blankSpaceDragDistance < BLANK_SPACE_DRAW_DISTANCE_THRESHOLD) {
      context.state.setDrawBondState({
        ...drawBondState,
        ex: ox,
        ey: oy,
        snapAtomId: null
      });
      removePreviewGeometry();
      context.g.select('text.draw-bond-origin-label').attr('display', null);
      context.g.select('circle.draw-bond-dest-node').remove();
      context.g.select('text.draw-bond-dest-label').remove();
      return;
    }

    const layoutBondLength = currentLayoutBondLength(context);
    const bondLength = context.getMode() === 'force' ? currentForcePreviewBondLength(context, layoutBondLength) : layoutBondLength * context.constants.scale;
    const { width, height } = context.plot.getSize();
    const snapRadius = 30;
    let ex;
    let ey;
    let snapAtomId = null;
    const highlightedAtomIds = getRenderableAtomHighlightIds();

    if (context.getMode() === 'force') {
      const candidates = [];
      const mol = context.molecule?.getActive?.() ?? null;
      for (const node of context.force.getNodes()) {
        if (node.id === drawBondState.atomId) {
          continue;
        }
        if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
          candidates.push({ id: node.id, x: node.x, y: node.y });
        }
      }
      let snapCandidate = chooseSnapCandidate(candidates, mx, my, snapRadius, highlightedAtomIds) ?? chooseSnapCandidate(candidates, mx, my, snapRadius);
      if (drawBondState.atomId === null) {
        const snappedNode = snapCandidate ? context.force.getNodeById(snapCandidate.id) : null;
        snapCandidate = forceHydrogenParentCandidate(snappedNode, mol) ?? snapCandidate;
      }
      if (snapCandidate) {
        ex = snapCandidate.x;
        ey = snapCandidate.y;
        snapAtomId = snapCandidate.id;
      }
    } else {
      const candidates = [];
      for (const atom of context.view2D.getAtoms()) {
        if (atom.id === drawBondState.atomId || atom.x == null || atom.visible === false) {
          continue;
        }
        const point = atomScreenPoint2d(atom, width, height);
        if (point) {
          candidates.push({ id: atom.id, x: point.x, y: point.y });
        }
      }
      const snapCandidate = chooseSnapCandidate(candidates, mx, my, snapRadius, highlightedAtomIds) ?? chooseSnapCandidate(candidates, mx, my, snapRadius);
      if (snapCandidate) {
        ex = snapCandidate.x;
        ey = snapCandidate.y;
        snapAtomId = snapCandidate.id;
      }
    }

    if (drawBondState.sourceIsProjectedStereoHydrogen === true && (snapAtomId === null || snapAtomId !== drawBondState.allowedHydrogenParentId)) {
      context.state.setDrawBondState({
        ...drawBondState,
        ex: ox,
        ey: oy,
        snapAtomId: null
      });
      removePreviewGeometry();
      return;
    }

    if (snapAtomId === null) {
      const endpoint =
        drawBondState.atomId !== null && context.getMode() === '2d'
          ? snappedPreviewEndpoint(ox, oy, mx, my, bondLength, options)
          : (() => {
              const dist = Math.hypot(mx - ox, my - oy);
              if (dist < 1e-6) {
                return { x: ox + bondLength, y: oy };
              }
              const clamped = Math.min(dist, bondLength);
              return {
                x: ox + ((mx - ox) / dist) * clamped,
                y: oy + ((my - oy) / dist) * clamped
              };
            })();
      ex = endpoint.x;
      ey = endpoint.y;
    }

    context.state.setDrawBondState({
      ...drawBondState,
      ex,
      ey,
      snapAtomId
    });

    renderPreviewFromState({ ...drawBondState, ex, ey }, snapAtomId);
    if (drawBondState.atomId === null && context.getMode() !== 'force' && context.getDrawBondElement() === 'C') {
      context.g.select('text.draw-bond-origin-label').attr('display', 'none');
    }

    const destCircle = context.g.select('circle.draw-bond-dest-node');
    if (destCircle.empty() && snapAtomId === null && context.getMode() === 'force') {
      const drawElemProtons = context.getDrawElemProtons();
      const radius = context.helpers.atomRadius(drawElemProtons[context.getDrawBondElement()] ?? 6);
      const fill = context.helpers.atomColor(context.getDrawBondElement(), 'force');
      const stroke = context.helpers.strokeColor(context.getDrawBondElement());
      context.g
        .append('circle')
        .attr('class', 'draw-bond-dest-node')
        .attr('cx', ex)
        .attr('cy', ey)
        .attr('r', radius)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', 1)
        .attr('pointer-events', 'none');
    } else if (!destCircle.empty()) {
      if (snapAtomId !== null) {
        destCircle.attr('display', 'none');
      } else {
        destCircle.attr('display', null).attr('cx', ex).attr('cy', ey);
      }
    }

    const destLabel = context.g.select('text.draw-bond-dest-label');
    if (destLabel.empty() && snapAtomId === null && context.getMode() !== 'force' && context.getDrawBondElement() !== 'C') {
      const fill = context.helpers.atomColor(context.getDrawBondElement(), '2d');
      context.g
        .append('text')
        .attr('class', 'draw-bond-dest-label')
        .attr('x', ex)
        .attr('y', ey)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', fill)
        .attr('font-size', context.constants.fontSize)
        .attr('font-weight', 'bold')
        .attr('pointer-events', 'none')
        .text(context.getDrawBondElement());
    } else if (!destLabel.empty()) {
      if (snapAtomId !== null) {
        destLabel.attr('display', 'none');
      } else {
        destLabel.attr('display', null).attr('x', ex).attr('y', ey);
      }
    }
  }

  function resetHover() {
    context.state.clearHoveredAtomIds();
    context.state.clearHoveredBondIds();
    const drawBondState = context.state.getDrawBondState();
    if (drawBondState?.atomId) {
      context.state.addHoveredAtomId(drawBondState.atomId);
    }
    rerenderSelectionOverlay();
  }

  function cancel() {
    if (!context.state.getDrawBondState()) {
      return;
    }
    clearArtifacts();
    context.state.setDrawBondState(null);
    context.view.clearPrimitiveHover();
    rerenderSelectionOverlay();
  }

  function markDragged() {
    const drawBondState = context.state.getDrawBondState();
    if (!drawBondState) {
      return;
    }
    context.state.setDrawBondState({
      ...drawBondState,
      dragged: true
    });
  }

  function previewBond(start, end, options = {}) {
    if (!Number.isFinite(start?.x) || !Number.isFinite(start?.y) || !Number.isFinite(end?.x) || !Number.isFinite(end?.y)) {
      return false;
    }
    renderPreviewGeometry(start.x, start.y, end.x, end.y, options);
    hideExistingBondForPreview(options.sourceElement);
    return true;
  }

  return {
    clearArtifacts,
    start,
    update,
    resetHover,
    cancel,
    markDragged,
    previewBond
  };
}
