/** @module app/interactions/draw-bond-preview */

export function createDrawBondPreviewActions(context) {
  function clearArtifacts() {
    context.g.select('line.draw-bond-preview').remove();
    context.g.select('circle.draw-bond-origin-node').remove();
    context.g.select('circle.draw-bond-dest-node').remove();
    context.g.select('text.draw-bond-origin-label').remove();
    context.g.select('text.draw-bond-dest-label').remove();
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
    context.g
      .append('line')
      .attr('class', 'draw-bond-preview')
      .attr('x1', ox)
      .attr('y1', oy)
      .attr('x2', ex)
      .attr('y2', ey)
      .attr('stroke', '#111')
      .attr('stroke-width', context.getMode() === 'force' ? parseFloat(context.helpers.singleBondWidth(1)) : context.constants.strokeWidth)
      .attr('stroke-linecap', 'round')
      .attr('pointer-events', 'none');

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
        const sourceName = drawBondState.atomId ? context.view2D.getAtomById(drawBondState.atomId)?.name ?? 'C' : context.getDrawBondElement();
        if (sourceName !== 'C' && sourceName !== 'H') {
          const gap = context.helpers.labelHalfW(sourceName, context.constants.fontSize) + 3;
          lx1 = ox + ux * gap;
          ly1 = oy + uy * gap;
        }
        const destName = snapAtomId ? context.view2D.getAtomById(snapAtomId)?.name ?? 'C' : context.getDrawBondElement();
        if (destName !== 'C' && destName !== 'H') {
          const gap = context.helpers.labelHalfW(destName, context.constants.fontSize) + 3;
          lx2 = ex - ux * gap;
          ly2 = ey - uy * gap;
        }
      }
      context.g.select('line.draw-bond-preview').attr('x1', lx1).attr('y1', ly1).attr('x2', lx2).attr('y2', ly2);
    } else {
      context.g.select('line.draw-bond-preview').attr('x2', ex).attr('y2', ey);
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
