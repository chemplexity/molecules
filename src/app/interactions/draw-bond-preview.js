/** @module app/interactions/draw-bond-preview */

/**
 * Creates draw-bond preview action handlers that manage the transient preview geometry shown while the user drags to place a new bond.
 * @param {object} context - Dependency context providing g, state, getMode, force, view2D, plot, renderers, view, helpers, constants, overlays, and getDrawBondElement.
 * @returns {object} Object with `clearArtifacts`, `start`, `update`, `resetHover`, `cancel`, and `markDragged`.
 */
export function createDrawBondPreviewActions(context) {
  function removePreviewGeometry() {
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
    const strokeWidth = options.strokeWidth ?? (context.getMode() === 'force' ? parseFloat(context.helpers.singleBondWidth(1)) : context.constants.strokeWidth);
    const defaultStroke = context.getMode() === 'force' ? '#696969' : '#111';
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

  function renderPreviewGeometry(x1, y1, x2, y2) {
    removePreviewGeometry();
    const group = context.g.insert('g', ':scope > circle').attr('class', 'draw-bond-preview').attr('pointer-events', 'none');
    const drawBondType = context.getDrawBondType?.() ?? 'single';
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const parallelOffset = context.getMode() === 'force' ? 3 : (context.constants.bondOffset2d ?? 7);
    const wedgeHalfWidth = context.getMode() === 'force' ? 5 : 6;

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
      if (context.getMode() === 'force') {
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
      if (context.getMode() === 'force') {
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
        strokeWidth: context.getMode() === 'force' ? 2.2 : 1.6
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

  function start(atomId, gX, gY) {
    if (!context.overlays.isReactionPreviewEditableAtomId(atomId)) {
      return;
    }

    let ox;
    let oy;
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
      const { width, height } = context.plot.getSize();
      ox = width / 2 + (atom.x - context.view2D.getCenterX()) * context.constants.scale;
      oy = height / 2 - (atom.y - context.view2D.getCenterY()) * context.constants.scale;
    }

    const ex = ox;
    const ey = oy;
    context.state.setDrawBondState({ atomId, ox, oy, ex, ey, dragged: false });
    renderPreviewGeometry(ox, oy, ex, ey);

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
      context.g
        .append('circle')
        .attr('class', 'draw-bond-dest-node')
        .attr('cx', ox)
        .attr('cy', oy)
        .attr('r', radius)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', 1)
        .attr('pointer-events', 'none');
    } else if (context.getDrawBondElement() !== 'C') {
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
      context.g
        .append('text')
        .attr('class', 'draw-bond-dest-label')
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
  }

  function update([mx, my]) {
    const drawBondState = context.state.getDrawBondState();
    if (!drawBondState) {
      return;
    }

    const { ox, oy } = drawBondState;
    const bondLength = context.getMode() === 'force' ? context.constants.forceBondLength : 1.5 * context.constants.scale;
    const { width, height } = context.plot.getSize();
    const snapRadius = 30;
    let ex;
    let ey;
    let snapAtomId = null;

    if (context.getMode() === 'force') {
      for (const node of context.force.getNodes()) {
        if (node.id === drawBondState.atomId) {
          continue;
        }
        if (Math.hypot(mx - node.x, my - node.y) <= snapRadius) {
          ex = node.x;
          ey = node.y;
          snapAtomId = node.id;
          break;
        }
      }
    } else {
      for (const atom of context.view2D.getAtoms()) {
        if (atom.id === drawBondState.atomId || atom.x == null || atom.visible === false) {
          continue;
        }
        const ax = width / 2 + (atom.x - context.view2D.getCenterX()) * context.constants.scale;
        const ay = height / 2 - (atom.y - context.view2D.getCenterY()) * context.constants.scale;
        if (Math.hypot(mx - ax, my - ay) <= snapRadius) {
          ex = ax;
          ey = ay;
          snapAtomId = atom.id;
          break;
        }
      }
    }

    if (snapAtomId === null) {
      const dist = Math.hypot(mx - ox, my - oy);
      if (dist < 1e-6) {
        ex = ox + bondLength;
        ey = oy;
      } else {
        const clamped = Math.min(dist, bondLength);
        ex = ox + ((mx - ox) / dist) * clamped;
        ey = oy + ((my - oy) / dist) * clamped;
      }
    }

    context.state.setDrawBondState({
      ...drawBondState,
      ex,
      ey,
      snapAtomId
    });

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
        if (sourceName !== 'C' && sourceName !== 'H') {
          const gap = context.helpers.labelHalfW(sourceName, context.constants.fontSize) + 3;
          lx1 = ox + ux * gap;
          ly1 = oy + uy * gap;
        }
        const destName = snapAtomId ? (context.view2D.getAtomById(snapAtomId)?.name ?? 'C') : context.getDrawBondElement();
        if (destName !== 'C' && destName !== 'H') {
          const gap = context.helpers.labelHalfW(destName, context.constants.fontSize) + 3;
          lx2 = ex - ux * gap;
          ly2 = ey - uy * gap;
        }
      }
      renderPreviewGeometry(lx1, ly1, lx2, ly2);
    } else {
      renderPreviewGeometry(ox, oy, ex, ey);
    }

    const destCircle = context.g.select('circle.draw-bond-dest-node');
    if (!destCircle.empty()) {
      if (snapAtomId !== null) {
        destCircle.attr('display', 'none');
      } else {
        destCircle.attr('display', null).attr('cx', ex).attr('cy', ey);
      }
    }

    const destLabel = context.g.select('text.draw-bond-dest-label');
    if (!destLabel.empty()) {
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

  return {
    clearArtifacts,
    start,
    update,
    resetHover,
    cancel,
    markDragged
  };
}
