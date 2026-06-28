/** @module app/interactions/gesture-layer */

import { pointInPolygon } from '../../layout/engine/geometry/polygon.js';
import { ringFillDomId } from '../../core/style.js';
import { atomColor } from '../render/helpers.js';
import { buildRingFillShape } from '../../layout/ring-fill-shape.js';

const PAINT_SETTINGS_CHANGED_EVENT = 'molecules:paint-settings-changed';

/**
 * Returns true when the event's modifier keys indicate an additive (extend) selection gesture.
 * @param {MouseEvent} event - The mouse event to test.
 * @returns {boolean} True if the Meta or Ctrl key is held.
 */
export function isAdditiveSelectionEvent(event) {
  return !!(event.metaKey || event.ctrlKey);
}

/**
 * Attaches all SVG and document-level gesture event listeners for selection drag, draw-bond, and erase-paint interactions.
 * @param {object} context - Dependency context providing svg, g, state, simulation, view, drawBond, selection, renderers, actions, helpers, overlays, pointer, schedule, and dom.
 * @returns {{refreshPaintPreview: () => void}} Gesture controls for refreshing transient hover previews.
 */
export function initGestureInteractions(context) {
  const { svg, g, doc = document } = context;
  const toSelectionSVGPt2d = atom => (context.helpers.toSelectionSVGPt2d ?? context.helpers.toSVGPt2d)(atom);

  const selectionRect = svg
    .append('rect')
    .attr('class', 'selection-rect')
    .attr('fill', 'rgba(100, 160, 255, 0.12)')
    .attr('stroke', 'rgb(80, 140, 255)')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5,3')
    .attr('pointer-events', 'none')
    .style('display', 'none');

  let selectionDragging = false;
  let selectionStart = null;
  let selectionAdditive = false;
  let selectionBaseAtomIds = new Set();
  let selectionBaseBondIds = new Set();
  let suppressForceSelectionClearClick = false;
  let lastEraseHitElement = null;
  let paintPainting = false;
  let paintStrokeHasSnapshot = false;
  let paintStrokeTargetKeys = new Set();
  let paintBucketPreview = null;
  let paintBucketPreviewHiddenFills = [];
  let paintBucketPreviewHiddenRingKey = null;
  let paintBucketPainting = false;
  let paintBucketStrokeHasSnapshot = false;
  let paintBucketStrokeTargetKeys = new Set();
  let paintBucketStrokeRings = [];
  let paintBrushPreviewStyles = new Map();
  let lastPaintPreviewEvent = null;

  const DEFAULT_PAINT_R = 12;
  const ERASE_R = 14;
  const PAINT_BUCKET_PREVIEW_BEFORE_SELECTOR = [
    ':scope > g.atom-highlights',
    ':scope > g.fg-highlight-layer',
    ':scope > g.bonds',
    ':scope > g.valence-warning-layer',
    ':scope > line.link',
    ':scope > line.separator',
    ':scope > line.bond-hover-target',
    ':scope > circle.node',
    ':scope > g.atom-bgs',
    ':scope > g.atom-labels'
  ].join(', ');

  function selectionEventPoint(event, clampToPlot = false) {
    const rect = svg.node().getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    if (clampToPlot) {
      x = Math.max(0, Math.min(rect.width, x));
      y = Math.max(0, Math.min(rect.height, y));
    }
    return [x, y];
  }

  function updateSelectionRect(x, y) {
    const rx = Math.min(selectionStart.x, x);
    const ry = Math.min(selectionStart.y, y);
    selectionRect
      .attr('x', rx)
      .attr('y', ry)
      .attr('width', Math.abs(x - selectionStart.x))
      .attr('height', Math.abs(y - selectionStart.y));
  }

  /**
   * Replaces the live selection sets while preserving their object identity for
   * renderers and session-state bridges that hold references to them.
   * @param {Iterable<string>} atomIds - Atom ids to place in the selection.
   * @param {Iterable<string>} bondIds - Bond ids to place in the selection.
   */
  function replaceLiveSelection(atomIds, bondIds) {
    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();
    selectedAtomIds.clear();
    selectedBondIds.clear();
    for (const atomId of atomIds) {
      selectedAtomIds.add(atomId);
    }
    for (const bondId of bondIds) {
      selectedBondIds.add(bondId);
    }
  }

  /**
   * Returns the viewport-space rectangle for the current selection drag.
   * @param {number} x - Current pointer x coordinate.
   * @param {number} y - Current pointer y coordinate.
   * @returns {{ rx: number, ry: number, rw: number, rh: number }} Rectangle bounds.
   */
  function selectionDragRect(x, y) {
    return {
      rx: Math.min(selectionStart.x, x),
      ry: Math.min(selectionStart.y, y),
      rw: Math.abs(x - selectionStart.x),
      rh: Math.abs(y - selectionStart.y)
    };
  }

  /**
   * Finds the atom and bond ids that fall inside a selection-drag rectangle,
   * using the same geometry rules as final drag selection.
   * @param {{ rx: number, ry: number, rw: number, rh: number }} box - Selection rectangle.
   * @param {'2d'|'force'} mode - Active render mode.
   * @returns {{ atomIds: Set<string>, bondIds: Set<string> }} Candidate ids.
   */
  function collectSelectionDragCandidates(box, mode) {
    const { rx, ry, rw, rh } = box;
    const transform = context.view.getZoomTransform();
    const atomIds = new Set();
    const bondIds = new Set();

    if (mode === 'force') {
      const nodes = context.simulation.nodes();
      for (const node of nodes) {
        const sx = transform.applyX(node.x);
        const sy = transform.applyY(node.y);
        if (sx >= rx && sx <= rx + rw && sy >= ry && sy <= ry + rh) {
          atomIds.add(node.id);
        }
      }

      for (const link of context.simulation.force('link').links()) {
        if (atomIds.has(link.source.id) && atomIds.has(link.target.id)) {
          bondIds.add(link.id);
        }
      }
      return { atomIds, bondIds };
    }

    const mol2d = context.state.documentState.getMol2d();
    const atoms = [...mol2d.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
    for (const atom of atoms) {
      const { x: gX, y: gY } = toSelectionSVGPt2d(atom);
      const sx = transform.applyX(gX);
      const sy = transform.applyY(gY);
      if (sx >= rx && sx <= rx + rw && sy >= ry && sy <= ry + rh) {
        atomIds.add(atom.id);
      }
    }

    for (const bond of mol2d.bonds.values()) {
      const [a1, a2] = bond.getAtomObjects(mol2d);
      if (!a1 || !a2 || a1.visible === false || a2.visible === false) {
        continue;
      }
      if (atomIds.has(a1.id) && atomIds.has(a2.id)) {
        bondIds.add(bond.id);
      }
    }
    return { atomIds, bondIds };
  }

  /**
   * Builds the selection that should be shown or committed for the current drag.
   * @param {{ atomIds: Set<string>, bondIds: Set<string> }} candidates - Box candidate ids.
   * @param {'2d'|'force'} mode - Active render mode.
   * @param {boolean} additive - Whether the drag extends/toggles the base selection.
   * @returns {{ atomIds: Set<string>, bondIds: Set<string> }} Preview or final selection ids.
   */
  function computeSelectionDragResult(candidates, mode, additive) {
    if (!additive) {
      return {
        atomIds: new Set(candidates.atomIds),
        bondIds: new Set(candidates.bondIds)
      };
    }

    const atomIds = new Set(selectionBaseAtomIds);
    for (const atomId of candidates.atomIds) {
      if (atomIds.has(atomId)) {
        atomIds.delete(atomId);
      } else {
        atomIds.add(atomId);
      }
    }

    const bondIds = new Set(selectionBaseBondIds);
    let links;
    if (mode === 'force') {
      links = context.simulation
        .force('link')
        .links()
        .map(link => ({ id: link.id, atomIds: [link.source.id, link.target.id] }));
    } else {
      const mol2d = context.state.documentState.getMol2d();
      links = [...mol2d.bonds.values()]
        .map(bond => {
          const [atom1, atom2] = bond.getAtomObjects(mol2d);
          if (!atom1 || !atom2 || atom1.visible === false || atom2.visible === false) {
            return null;
          }
          return { id: bond.id, atomIds: [atom1.id, atom2.id] };
        })
        .filter(Boolean);
    }
    for (const link of links) {
      const [a1, a2] = link.atomIds;
      if (atomIds.has(a1) && atomIds.has(a2)) {
        bondIds.add(link.id);
      } else if (selectionBaseBondIds.has(link.id)) {
        bondIds.delete(link.id);
      }
    }

    return { atomIds, bondIds };
  }

  /**
   * Updates the visible selection overlay to match the current drag rectangle.
   * @param {number} x - Current pointer x coordinate.
   * @param {number} y - Current pointer y coordinate.
   * @param {boolean} commit - Whether tiny drags should also be committed.
   * @returns {boolean} True when a selection was previewed or committed.
   */
  function applySelectionDragResult(x, y, commit = false) {
    const mode = context.state.viewState.getMode();
    if (mode !== '2d' && mode !== 'force') {
      return false;
    }
    if (mode === '2d' && !context.state.documentState.getMol2d()) {
      return false;
    }
    if (mode === 'force' && !context.state.documentState.getCurrentMol()) {
      return false;
    }
    const box = selectionDragRect(x, y);
    if (!commit && box.rw < 5 && box.rh < 5) {
      context.view.clearPrimitiveHover();
      if (selectionAdditive) {
        replaceLiveSelection(selectionBaseAtomIds, selectionBaseBondIds);
      } else {
        replaceLiveSelection([], []);
      }
      context.renderers.applySelectionOverlay();
      return true;
    }
    const candidates = collectSelectionDragCandidates(box, mode);
    const result = computeSelectionDragResult(candidates, mode, selectionAdditive);
    context.view.clearPrimitiveHover();
    replaceLiveSelection(result.atomIds, result.bondIds);
    context.renderers.applySelectionOverlay();
    return true;
  }

  function svgPtToScreen(svgEl, x, y) {
    const root = svgEl.ownerSVGElement;
    if (!root) {
      return null;
    }
    const point = root.createSVGPoint();
    point.x = x;
    point.y = y;
    const ctm = svgEl.getScreenCTM();
    return ctm ? point.matrixTransform(ctm) : null;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) {
      return Math.hypot(px - ax, py - ay);
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function segmentProjectionParameter(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) {
      return null;
    }
    return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  }

  function isPaintBrushMode() {
    return (context.state.overlayState.getPaintMode?.() ?? false) && (context.state.overlayState.getPaintTool?.() ?? 'brush') === 'brush';
  }

  function isPaintBucketMode() {
    return (context.state.overlayState.getPaintMode?.() ?? false) && context.state.overlayState.getPaintTool?.() === 'bucket';
  }

  function isPaintEraserMode() {
    return (context.state.overlayState.getPaintMode?.() ?? false) && context.state.overlayState.getPaintTool?.() === 'eraser';
  }

  function isRingTemplateMode() {
    return context.state.overlayState.getRingTemplateMode?.() ?? false;
  }

  function getPaintStyle() {
    return {
      color: context.state.overlayState.getPaintColor?.() ?? '#3366ff',
      opacity: context.state.overlayState.getPaintOpacity?.() ?? 1
    };
  }

  function getPaintBrushRadius() {
    const radius = Number(context.state.overlayState.getPaintBrushSize?.() ?? DEFAULT_PAINT_R);
    return Number.isFinite(radius) ? Math.max(1, radius) : DEFAULT_PAINT_R;
  }

  function getPaintMolecule(mode = context.state.viewState.getMode()) {
    return mode === 'force' ? context.state.documentState.getCurrentMol() : context.state.documentState.getMol2d();
  }

  function readableTextColor(fill) {
    const hex = String(fill ?? '');
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!match) {
      return '#111';
    }
    const value = match[1];
    const cr = parseInt(value.slice(0, 2), 16);
    const cg = parseInt(value.slice(2, 4), 16);
    const cb = parseInt(value.slice(4, 6), 16);
    return cr * 0.299 + cg * 0.587 + cb * 0.114 > 140 ? '#333' : '#fff';
  }

  function elementClassContains(element, className) {
    return element?.classList?.contains?.(className) ?? String(element?.getAttribute?.('class') ?? '').split(/\s+/).includes(className);
  }

  function elementTagName(element) {
    return String(element?.tagName ?? '').toLowerCase();
  }

  function getStyleProperty(element, name) {
    return element?.style?.getPropertyValue?.(name) ?? element?.style?.[name] ?? '';
  }

  function setStyleProperty(element, name, value) {
    if (element?.style?.setProperty) {
      element.style.setProperty(name, value);
      return;
    }
    if (element?.style) {
      element.style[name] = value;
    }
  }

  function restorePaintBrushPreview() {
    for (const [element, properties] of paintBrushPreviewStyles) {
      if (element?.isConnected === false) {
        continue;
      }
      for (const [name, value] of properties) {
        setStyleProperty(element, name, value);
      }
    }
    paintBrushPreviewStyles = new Map();
  }

  function applyPaintBrushPreviewStyle(element, styleProperties) {
    if (!element || element.isConnected === false) {
      return;
    }
    let restore = paintBrushPreviewStyles.get(element);
    if (!restore) {
      restore = new Map();
      paintBrushPreviewStyles.set(element, restore);
    }
    for (const [name, value] of Object.entries(styleProperties)) {
      if (!restore.has(name)) {
        restore.set(name, getStyleProperty(element, name));
      }
      setStyleProperty(element, name, value);
    }
  }

  function elementsWithDataAttribute(root, name, value) {
    return [...(root?.querySelectorAll?.(`[${name}]`) ?? [])].filter(element => element.getAttribute?.(name) === value);
  }

  function previewPaintBrushAtom(atomId, mode, style) {
    const root = g.node?.();
    if (!root) {
      return;
    }
    const opacity = String(style.opacity);
    if (mode === 'force') {
      for (const element of [...(root.querySelectorAll?.('circle.node, text.atom-symbol, g.charge-label') ?? [])]) {
        const datum = element.__data__;
        if (datum?.id !== atomId) {
          continue;
        }
        if (elementClassContains(element, 'node')) {
          applyPaintBrushPreviewStyle(element, {
            fill: style.color,
            'fill-opacity': opacity,
            'stroke-opacity': opacity
          });
        } else {
          applyPaintBrushPreviewStyle(element, { opacity });
        }
      }
      return;
    }

    for (const element of elementsWithDataAttribute(root, 'data-atom-id', atomId)) {
      if (elementTagName(element) !== 'g') {
        continue;
      }
      for (const label of element.querySelectorAll?.('.atom-label, .atom-charge-text') ?? []) {
        applyPaintBrushPreviewStyle(label, { fill: style.color, opacity });
      }
      for (const ring of element.querySelectorAll?.('.atom-charge-ring') ?? []) {
        applyPaintBrushPreviewStyle(ring, { stroke: style.color, opacity });
      }
      if (elementClassContains(element, 'atom-lone-pairs')) {
        applyPaintBrushPreviewStyle(element, { opacity });
        for (const dot of element.querySelectorAll?.('circle') ?? []) {
          applyPaintBrushPreviewStyle(dot, { fill: style.color });
        }
      }
    }
  }

  function previewPaintBrushBond(bondId, mode, style) {
    const root = g.node?.();
    if (!root) {
      return;
    }
    const opacity = String(style.opacity);
    const bondElements =
      mode === 'force'
        ? elementsWithDataAttribute(root, 'data-bond-id', bondId).filter(element => !elementClassContains(element, 'bond-hover-target'))
        : elementsWithDataAttribute(root, 'data-bond-id', bondId).flatMap(element => [...(element.querySelectorAll?.('.bond') ?? [])]);
    for (const element of bondElements) {
      const tagName = elementTagName(element);
      if (tagName === 'polygon' || tagName === 'path') {
        applyPaintBrushPreviewStyle(element, { fill: style.color, 'fill-opacity': opacity });
      } else {
        applyPaintBrushPreviewStyle(element, { stroke: style.color, 'stroke-opacity': opacity });
      }
    }
  }

  function previewPaintEraserAtom(atomId, mode) {
    const root = g.node?.();
    const mol = getPaintMolecule(mode);
    const atom = mol?.atoms?.get?.(atomId);
    if (!root || !atom?.properties?.style) {
      return false;
    }
    const defaultColor = atomColor(atom.name ?? 'C', mode);
    const defaultLabelColor = mode === '2d' && atom.name === 'H' ? '#333333' : defaultColor;
    if (mode === 'force') {
      for (const element of [...(root.querySelectorAll?.('circle.node, text.atom-symbol, g.charge-label') ?? [])]) {
        const datum = element.__data__;
        if (datum?.id !== atomId) {
          continue;
        }
        if (elementClassContains(element, 'node')) {
          applyPaintBrushPreviewStyle(element, {
            fill: defaultColor,
            'fill-opacity': '1',
            'stroke-opacity': '1'
          });
        } else if (elementClassContains(element, 'atom-symbol')) {
          applyPaintBrushPreviewStyle(element, {
            fill: readableTextColor(defaultColor),
            opacity: '1'
          });
        } else {
          applyPaintBrushPreviewStyle(element, { opacity: '1' });
        }
      }
      return true;
    }

    for (const element of elementsWithDataAttribute(root, 'data-atom-id', atomId)) {
      if (elementTagName(element) !== 'g') {
        continue;
      }
      for (const label of element.querySelectorAll?.('.atom-label, .atom-charge-text') ?? []) {
        applyPaintBrushPreviewStyle(label, { fill: defaultLabelColor, opacity: '1' });
      }
      for (const ring of element.querySelectorAll?.('.atom-charge-ring') ?? []) {
        applyPaintBrushPreviewStyle(ring, { stroke: defaultLabelColor, opacity: '1' });
      }
      if (elementClassContains(element, 'atom-lone-pairs')) {
        applyPaintBrushPreviewStyle(element, { opacity: '1' });
        for (const dot of element.querySelectorAll?.('circle') ?? []) {
          applyPaintBrushPreviewStyle(dot, { fill: '#111111' });
        }
      }
    }
    return true;
  }

  function previewPaintEraserBond(bondId, mode) {
    const root = g.node?.();
    const mol = getPaintMolecule(mode);
    const bond = mol?.bonds?.get?.(bondId);
    if (!root || !bond?.properties?.style) {
      return false;
    }
    const bondElements =
      mode === 'force'
        ? elementsWithDataAttribute(root, 'data-bond-id', bondId).filter(element => !elementClassContains(element, 'bond-hover-target'))
        : elementsWithDataAttribute(root, 'data-bond-id', bondId).flatMap(element => [...(element.querySelectorAll?.('.bond') ?? [])]);
    for (const element of bondElements) {
      const tagName = elementTagName(element);
      if (tagName === 'polygon' || tagName === 'path') {
        applyPaintBrushPreviewStyle(element, { fill: '#111', 'fill-opacity': '1' });
      } else if (elementClassContains(element, 'separator')) {
        applyPaintBrushPreviewStyle(element, { 'stroke-opacity': '1' });
      } else {
        applyPaintBrushPreviewStyle(element, {
          stroke: mode === 'force' ? '' : '#111',
          'stroke-opacity': '1'
        });
      }
    }
    return true;
  }

  function isPaintHitElement(element) {
    return (
      element?.classList?.contains?.('atom-hit') ||
      element?.classList?.contains?.('bond-hit') ||
      element?.classList?.contains?.('node') ||
      element?.classList?.contains?.('bond-hover-target')
    );
  }

  function isForceBondPaintHit(element) {
    return element?.classList?.contains?.('bond-hover-target') ?? false;
  }

  function forceAtomScreenRadius(element) {
    const box = element?.getBoundingClientRect?.();
    const boxRadius = box ? Math.max(Math.abs((box.right ?? 0) - (box.left ?? 0)), Math.abs((box.bottom ?? 0) - (box.top ?? 0))) / 2 : 0;
    if (boxRadius > 0) {
      return boxRadius;
    }
    const radius = Number(element?.getAttribute?.('r'));
    if (!Number.isFinite(radius) || radius <= 0) {
      return 0;
    }
    const ctm = element?.getScreenCTM?.();
    const scale = ctm ? (Math.abs(ctm.a ?? 1) + Math.abs(ctm.d ?? 1)) / 2 : 1;
    return radius * scale;
  }

  function collectForceAtomScreenCircles() {
    return [...(context.dom.plotEl?.querySelectorAll?.('.node') ?? [])]
      .map(element => {
        const box = element?.getBoundingClientRect?.();
        const radius = forceAtomScreenRadius(element);
        if (!box || !Number.isFinite(radius) || radius <= 0) {
          return null;
        }
        return {
          x: ((box.left ?? 0) + (box.right ?? 0)) / 2,
          y: ((box.top ?? 0) + (box.bottom ?? 0)) / 2,
          radius
        };
      })
      .filter(Boolean);
  }

  function isInsideForceAtomScreenRadius(x, y, circles, padding = 0) {
    return circles.some(circle => Math.hypot(x - circle.x, y - circle.y) <= circle.radius + padding);
  }

  function isForceBondWithinPaintRadius(element, x, y, paintRadius) {
    if (!isForceBondPaintHit(element)) {
      return true;
    }
    const p1 = svgPtToScreen(element, parseFloat(element.getAttribute('x1')), parseFloat(element.getAttribute('y1')));
    const p2 = svgPtToScreen(element, parseFloat(element.getAttribute('x2')), parseFloat(element.getAttribute('y2')));
    return !!p1 && !!p2 && distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= paintRadius;
  }

  function forceBondHasExposedPaintPoint(element, x, y, paintRadius, circles) {
    if (!isForceBondPaintHit(element) || circles.length === 0) {
      return true;
    }
    const p1 = svgPtToScreen(element, parseFloat(element.getAttribute('x1')), parseFloat(element.getAttribute('y1')));
    const p2 = svgPtToScreen(element, parseFloat(element.getAttribute('x2')), parseFloat(element.getAttribute('y2')));
    if (!p1 || !p2) {
      return false;
    }
    const sampleCount = 24;
    for (let index = 0; index <= sampleCount; index++) {
      const t = index / sampleCount;
      const px = p1.x + (p2.x - p1.x) * t;
      const py = p1.y + (p2.y - p1.y) * t;
      if (!isInsideForceAtomScreenRadius(px, py, circles) && Math.hypot(x - px, y - py) <= paintRadius) {
        return true;
      }
    }
    return false;
  }

  function is2dBondEndpointPaintSpillover(element, x, y, paintRadius) {
    if (!elementClassContains(element, 'bond-hit')) {
      return false;
    }
    const p1 = svgPtToScreen(element, parseFloat(element.getAttribute('x1')), parseFloat(element.getAttribute('y1')));
    const p2 = svgPtToScreen(element, parseFloat(element.getAttribute('x2')), parseFloat(element.getAttribute('y2')));
    if (!p1 || !p2) {
      return true;
    }
    const t = segmentProjectionParameter(x, y, p1.x, p1.y, p2.x, p2.y);
    if (t == null) {
      return true;
    }
    const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (!Number.isFinite(length) || length <= 0) {
      return true;
    }
    const endpointPad = Math.min(paintRadius * 0.6, length * 0.35);
    const endpointT = endpointPad / length;
    return t <= endpointT || t >= 1 - endpointT;
  }

  function isProtective2dAtomPaintHit(element) {
    if (!elementClassContains(element, 'atom-hit')) {
      return false;
    }
    const atomId = element.closest?.('[data-atom-id]')?.getAttribute?.('data-atom-id') ?? null;
    const atom = atomId ? getPaintMolecule('2d')?.atoms?.get?.(atomId) : null;
    return !!atom && atom.visible !== false && atom.name !== 'C';
  }

  function resolvePaintHitElement(element) {
    if (element.classList.contains('node')) {
      const datum = context.helpers.getDatum(element);
      return datum?.id ? { atomIds: [datum.id], bondIds: [], keys: [`atom:${datum.id}`] } : null;
    }
    if (element.classList.contains('bond-hover-target')) {
      const datum = context.helpers.getDatum(element);
      return datum?.id ? { atomIds: [], bondIds: [datum.id], keys: [`bond:${datum.id}`] } : null;
    }
    if (element.classList.contains('atom-hit')) {
      const group = element.closest('[data-atom-id]');
      const atomId = group?.getAttribute?.('data-atom-id');
      return atomId ? { atomIds: [atomId], bondIds: [], keys: [`atom:${atomId}`] } : null;
    }
    if (element.classList.contains('bond-hit')) {
      const group = element.closest('[data-bond-id]');
      const bondId = group?.getAttribute?.('data-bond-id');
      return bondId ? { atomIds: [], bondIds: [bondId], keys: [`bond:${bondId}`] } : null;
    }
    return null;
  }

  function polygonArea(polygon) {
    let area = 0;
    for (let index = 0; index < polygon.length; index++) {
      const point = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      area += point.x * next.y - next.x * point.y;
    }
    return Math.abs(area) / 2;
  }

  function paintBucketRingKey(atomIds) {
    return [...atomIds].sort().join('\0');
  }

  /**
   * Counts shared atoms between two ring atom id lists.
   * @param {string[]} firstAtomIds - First ring atom ids.
   * @param {string[]} secondAtomIds - Second ring atom ids.
   * @returns {number} Number of atom ids present in both rings.
   */
  function countSharedRingAtoms(firstAtomIds, secondAtomIds) {
    const first = new Set(firstAtomIds);
    let count = 0;
    for (const atomId of secondAtomIds) {
      if (first.has(atomId)) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Returns true when a bucket stroke has already targeted a larger fused ring
   * containing the current pointer hit, so a smaller shared ring should not be
   * filled as spillover from the same drag.
   * @param {{area:number, atomIds:string[], hitPoint:{x:number,y:number}}} ring - Candidate ring hit.
   * @returns {boolean} True when the candidate should be ignored for this stroke.
   */
  function isCoveredByPaintBucketStrokeRing(ring) {
    return paintBucketStrokeRings.some(strokeRing => {
      if (ring.area >= strokeRing.area || countSharedRingAtoms(ring.atomIds, strokeRing.atomIds) < 2) {
        return false;
      }
      return pointInPolygon(ring.hitPoint, strokeRing.points);
    });
  }

  function restorePaintBucketPreviewHiddenFills() {
    for (const { element, display } of paintBucketPreviewHiddenFills) {
      if (element?.isConnected !== false) {
        element.style.display = display;
      }
    }
    paintBucketPreviewHiddenFills = [];
    paintBucketPreviewHiddenRingKey = null;
  }

  function hidePermanentRingFillForPreview(atomIds) {
    const key = paintBucketRingKey(atomIds);
    if (paintBucketPreviewHiddenRingKey === key && paintBucketPreviewHiddenFills.some(({ element }) => element?.isConnected !== false)) {
      return;
    }
    restorePaintBucketPreviewHiddenFills();

    const ringFillId = ringFillDomId(atomIds);
    const root = g.node?.();
    const fills = root?.querySelectorAll?.('.ring-fill:not(.paint-bucket-ring-preview)') ?? [];
    for (const element of fills) {
      if (element.getAttribute?.('data-ring-fill-id') !== ringFillId) {
        continue;
      }
      paintBucketPreviewHiddenFills.push({ element, display: element.style.display });
      element.style.display = 'none';
    }
    paintBucketPreviewHiddenRingKey = paintBucketPreviewHiddenFills.length > 0 ? key : null;
  }

  function ensurePaintBucketPreview() {
    const previewNode = paintBucketPreview?.node?.();
    if (paintBucketPreview && previewNode?.isConnected !== false) {
      return paintBucketPreview;
    }
    const insertPreview = typeof g.insert === 'function' ? g.insert.bind(g) : g.append.bind(g);
    paintBucketPreview = insertPreview('path', PAINT_BUCKET_PREVIEW_BEFORE_SELECTOR)
      .attr('class', 'ring-fill paint-bucket-ring-preview')
      .attr('pointer-events', 'none')
      .attr('fill-rule', 'evenodd')
      .attr('stroke', 'none')
      .style('display', 'none');
    return paintBucketPreview;
  }

  function hidePaintBucketPreview() {
    paintBucketPreview?.style('display', 'none');
    restorePaintBucketPreviewHiddenFills();
  }

  function findPaintBucketRing(event) {
    const mode = context.state.viewState.getMode();
    if (mode !== '2d' && mode !== 'force') {
      return null;
    }
    const mol = mode === 'force' ? context.state.documentState.getCurrentMol() : context.state.documentState.getMol2d();
    if (!mol?.getRings) {
      return null;
    }

    const [x, y] = context.pointer(event, g.node());
    const point = { x, y };
    let best = null;
    const forceNodeById =
      mode === 'force' && typeof context.simulation.nodes === 'function'
        ? new Map(context.simulation.nodes().map(node => [node.id, node]))
        : null;

    const rings = mol.getRings();
    for (const ringAtomIds of rings) {
      const polygon = [];
      let valid = true;
      for (const atomId of ringAtomIds) {
        const atom = mol.atoms.get(atomId);
        if (!atom || atom.visible === false) {
          valid = false;
          break;
        }
        const svgPoint = forceNodeById ? forceNodeById.get(atomId) : context.helpers.toSVGPt2d(atom);
        if (!Number.isFinite(svgPoint?.x) || !Number.isFinite(svgPoint?.y)) {
          valid = false;
          break;
        }
        polygon.push(svgPoint);
      }
      if (!valid || polygon.length < 3 || !pointInPolygon(point, polygon)) {
        continue;
      }

      const area = polygonArea(polygon);
      if (!best || area < best.area) {
        best = {
          area,
          atomIds: [...ringAtomIds],
          hitPoint: { x, y },
          points: polygon.map(({ x, y }) => ({ x, y }))
        };
      }
    }

    if (!best) {
      return null;
    }
    const shape = buildRingFillShape(best.atomIds, rings, atomId => {
      const atom = mol.atoms.get(atomId);
      if (!atom || atom.visible === false) {
        return null;
      }
      const svgPoint = forceNodeById ? forceNodeById.get(atomId) : context.helpers.toSVGPt2d(atom);
      return Number.isFinite(svgPoint?.x) && Number.isFinite(svgPoint?.y) ? svgPoint : null;
    });
    return shape
      ? {
          ...best,
          holes: shape.holes,
          path: shape.path,
          points: shape.points
        }
      : best;
  }

  function updatePaintBucketPreview(event) {
    if (!isPaintBucketMode()) {
      hidePaintBucketPreview();
      return;
    }
    restorePaintBrushPreview();
    if (event.buttons) {
      hidePaintBucketPreview();
      return;
    }
    if (event.target?.closest?.('.atom-hit, .bond-hit, .node, .bond-hover-target')) {
      hidePaintBucketPreview();
      return;
    }

    const ring = findPaintBucketRing(event);
    if (!ring) {
      hidePaintBucketPreview();
      return;
    }

    const style = getPaintStyle();
    hidePermanentRingFillForPreview(ring.atomIds);
    ensurePaintBucketPreview()
      .attr('d', ring.path ?? ring.points.map(point => `${point.x},${point.y}`).join(' '))
      .attr('fill', style.color)
      .attr('fill-opacity', style.opacity)
      .attr('data-ring-fill-preview-atom-ids', ring.atomIds.join(' '))
      .style('display', null);
  }

  function applyPaintBucketStroke(event) {
    if (!isPaintBucketMode() || !paintBucketPainting) {
      return;
    }
    restorePaintBrushPreview();
    const ring = findPaintBucketRing(event);
    if (!ring) {
      return;
    }

    const key = paintBucketRingKey(ring.atomIds);
    if (paintBucketStrokeTargetKeys.has(key)) {
      return;
    }
    if (isCoveredByPaintBucketStrokeRing(ring)) {
      return;
    }
    paintBucketStrokeTargetKeys.add(key);
    paintBucketStrokeRings.push({
      area: ring.area,
      atomIds: ring.atomIds,
      points: ring.points
    });
    hidePaintBucketPreview();
    const result = context.actions.paintRingFill?.(ring.atomIds, getPaintStyle(), {
      skipSnapshot: paintBucketStrokeHasSnapshot
    });
    if (result?.performed) {
      paintBucketStrokeHasSnapshot = true;
      paintBucketPreview = null;
    }
  }

  function collectPaintHitElements(cx, cy) {
    const seen = new Set();
    const candidates = [];
    const paintRadius = getPaintBrushRadius();
    const mode = context.state.viewState.getMode();
    const centerElements = doc.elementsFromPoint(cx, cy);
    const centerHasProtective2dAtomHit = mode === '2d' && centerElements.some(element => isProtective2dAtomPaintHit(element));
    const forceAtomCircles = mode === 'force' ? collectForceAtomScreenCircles() : [];
    const addIfTarget = (element, options = {}) => {
      if (!isPaintHitElement(element) || seen.has(element)) {
        return;
      }
      if (centerHasProtective2dAtomHit && elementClassContains(element, 'bond-hit')) {
        if (!options.allow2dBondCenterHit || is2dBondEndpointPaintSpillover(element, cx, cy, paintRadius)) {
          return;
        }
      }
      if (!isForceBondWithinPaintRadius(element, cx, cy, paintRadius)) {
        return;
      }
      if (!forceBondHasExposedPaintPoint(element, cx, cy, paintRadius, forceAtomCircles)) {
        return;
      }
      seen.add(element);
      candidates.push(element);
    };

    const perimeterAngles = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const element of centerElements) {
      addIfTarget(element, { allow2dBondCenterHit: true });
    }
    for (const angle of perimeterAngles) {
      const rad = (angle * Math.PI) / 180;
      const px = cx + paintRadius * Math.cos(rad);
      const py = cy + paintRadius * Math.sin(rad);
      for (const element of doc.elementsFromPoint(px, py)) {
        addIfTarget(element);
      }
    }

    for (const element of context.dom.plotEl.querySelectorAll('.atom-hit, .node')) {
      if (seen.has(element)) {
        continue;
      }
      const box = element.getBoundingClientRect();
      const acx = (box.left + box.right) / 2;
      const acy = (box.top + box.bottom) / 2;
      if (Math.hypot(cx - acx, cy - acy) <= paintRadius) {
        addIfTarget(element);
      }
    }

    for (const element of context.dom.plotEl.querySelectorAll('.bond-hit, .bond-hover-target')) {
      if (seen.has(element)) {
        continue;
      }
      if (centerHasProtective2dAtomHit && elementClassContains(element, 'bond-hit')) {
        continue;
      }
      const p1 = svgPtToScreen(element, parseFloat(element.getAttribute('x1')), parseFloat(element.getAttribute('y1')));
      const p2 = svgPtToScreen(element, parseFloat(element.getAttribute('x2')), parseFloat(element.getAttribute('y2')));
      if (!p1 || !p2) {
        continue;
      }
      if (distToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y) <= paintRadius) {
        addIfTarget(element);
      }
    }

    return candidates;
  }

  function applyPaintStroke(event) {
    const erasing = isPaintEraserMode();
    if ((!isPaintBrushMode() && !erasing) || !paintPainting) {
      return;
    }
    restorePaintBrushPreview();

    const atomIds = [];
    const bondIds = [];
    const keys = [];
    const addResolved = resolved => {
      if (!resolved) {
        return;
      }
      for (const key of resolved.keys) {
        if (paintStrokeTargetKeys.has(key) || keys.includes(key)) {
          continue;
        }
        keys.push(key);
      }
      for (const atomId of resolved.atomIds) {
        if (!paintStrokeTargetKeys.has(`atom:${atomId}`) && !atomIds.includes(atomId)) {
          atomIds.push(atomId);
        }
      }
      for (const bondId of resolved.bondIds) {
        if (!paintStrokeTargetKeys.has(`bond:${bondId}`) && !bondIds.includes(bondId)) {
          bondIds.push(bondId);
        }
      }
    };

    for (const element of collectPaintHitElements(event.clientX, event.clientY)) {
      addResolved(resolvePaintHitElement(element));
    }

    const ring = erasing ? findPaintBucketRing(event) : null;
    const ringKey = ring ? `ring:${paintBucketRingKey(ring.atomIds)}` : null;
    if (ringKey && !paintStrokeTargetKeys.has(ringKey)) {
      keys.push(ringKey);
    }
    if (atomIds.length === 0 && bondIds.length === 0 && (!ring || paintStrokeTargetKeys.has(ringKey))) {
      return;
    }

    if (atomIds.length > 0 || bondIds.length > 0) {
      const result = context.actions.paintStyleTargets?.(atomIds, bondIds, erasing ? null : getPaintStyle(), {
        skipSnapshot: paintStrokeHasSnapshot
      });
      if (result?.performed) {
        paintStrokeHasSnapshot = true;
      }
    }
    if (ring && !paintStrokeTargetKeys.has(ringKey)) {
      const result = context.actions.paintRingFill?.(ring.atomIds, null, {
        skipSnapshot: paintStrokeHasSnapshot
      });
      if (result?.performed) {
        paintStrokeHasSnapshot = true;
      }
    }
    for (const key of keys) {
      paintStrokeTargetKeys.add(key);
    }
  }

  function updatePaintBrushPreview(event) {
    if (!isPaintBrushMode() || paintPainting || event.buttons) {
      restorePaintBrushPreview();
      return;
    }
    const atomIds = new Set();
    const bondIds = new Set();
    for (const element of collectPaintHitElements(event.clientX, event.clientY)) {
      const resolved = resolvePaintHitElement(element);
      for (const atomId of resolved?.atomIds ?? []) {
        atomIds.add(atomId);
      }
      for (const bondId of resolved?.bondIds ?? []) {
        bondIds.add(bondId);
      }
    }

    restorePaintBrushPreview();
    if (atomIds.size === 0 && bondIds.size === 0) {
      return;
    }

    const mode = context.state.viewState.getMode();
    const style = getPaintStyle();
    for (const atomId of atomIds) {
      previewPaintBrushAtom(atomId, mode, style);
    }
    for (const bondId of bondIds) {
      previewPaintBrushBond(bondId, mode, style);
    }
  }

  function updatePaintEraserPreview(event) {
    if (!isPaintEraserMode()) {
      return;
    }
    if (paintPainting || event.buttons) {
      restorePaintBrushPreview();
      hidePaintBucketPreview();
      return;
    }

    const atomIds = new Set();
    const bondIds = new Set();
    for (const element of collectPaintHitElements(event.clientX, event.clientY)) {
      const resolved = resolvePaintHitElement(element);
      for (const atomId of resolved?.atomIds ?? []) {
        atomIds.add(atomId);
      }
      for (const bondId of resolved?.bondIds ?? []) {
        bondIds.add(bondId);
      }
    }

    restorePaintBrushPreview();
    const mode = context.state.viewState.getMode();
    for (const atomId of atomIds) {
      previewPaintEraserAtom(atomId, mode);
    }
    for (const bondId of bondIds) {
      previewPaintEraserBond(bondId, mode);
    }

    const ring = findPaintBucketRing(event);
    if (ring) {
      hidePermanentRingFillForPreview(ring.atomIds);
    } else {
      hidePaintBucketPreview();
    }
  }

  function refreshPaintPreview() {
    if (!lastPaintPreviewEvent) {
      return;
    }
    updatePaintBrushPreview(lastPaintPreviewEvent);
    updatePaintBucketPreview(lastPaintPreviewEvent);
    updatePaintEraserPreview(lastPaintPreviewEvent);
  }

  function finishSelectionDrag(event) {
    if (!selectionDragging) {
      return;
    }

    selectionDragging = false;
    selectionRect.style('display', 'none');

    const mode = context.state.viewState.getMode();
    if (mode !== '2d' && mode !== 'force') {
      selectionAdditive = false;
      replaceLiveSelection(selectionBaseAtomIds, selectionBaseBondIds);
      context.renderers.applySelectionOverlay();
      return;
    }
    if (mode === '2d' && !context.state.documentState.getMol2d()) {
      selectionAdditive = false;
      replaceLiveSelection(selectionBaseAtomIds, selectionBaseBondIds);
      context.renderers.applySelectionOverlay();
      return;
    }
    if (mode === 'force' && !context.state.documentState.getCurrentMol()) {
      selectionAdditive = false;
      replaceLiveSelection(selectionBaseAtomIds, selectionBaseBondIds);
      context.renderers.applySelectionOverlay();
      return;
    }

    const [x, y] = selectionEventPoint(event, true);
    const rw = Math.abs(x - selectionStart.x);
    const rh = Math.abs(y - selectionStart.y);
    const additive = selectionAdditive;

    if (rw < 5 && rh < 5) {
      selectionAdditive = false;
      if (additive) {
        replaceLiveSelection(selectionBaseAtomIds, selectionBaseBondIds);
        context.renderers.applySelectionOverlay();
        return;
      }
      context.view.clearPrimitiveHover();
      replaceLiveSelection([], []);
      context.renderers.applySelectionOverlay();
      return;
    }

    applySelectionDragResult(x, y, true);
    selectionAdditive = false;
    if (mode === 'force') {
      suppressForceSelectionClearClick = true;
    }
  }

  function handleErasePaintMove(event) {
    const cursor = context.dom.getEraseCursorElement();
    if (context.state.overlayState.getErasePainting()) {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    }
    if (!context.state.overlayState.getEraseMode() || !context.state.overlayState.getErasePainting()) {
      return;
    }

    const cx = event.clientX;
    const cy = event.clientY;
    const seen = new Set();
    const candidates = [];
    const addIfUnseen = element => {
      if (!seen.has(element)) {
        seen.add(element);
        candidates.push(element);
      }
    };

    const perimeterAngles = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const element of doc.elementsFromPoint(cx, cy)) {
      if (!element.classList.contains('atom-hit') && !element.classList.contains('bond-hit')) {
        addIfUnseen(element);
      }
    }
    for (const angle of perimeterAngles) {
      const rad = (angle * Math.PI) / 180;
      const px = cx + ERASE_R * Math.cos(rad);
      const py = cy + ERASE_R * Math.sin(rad);
      for (const element of doc.elementsFromPoint(px, py)) {
        if (element.classList.contains('node') || element.classList.contains('bond-hover-target')) {
          addIfUnseen(element);
        }
      }
    }

    for (const element of context.dom.plotEl.querySelectorAll('.atom-hit')) {
      if (seen.has(element)) {
        continue;
      }
      const box = element.getBoundingClientRect();
      const acx = (box.left + box.right) / 2;
      const acy = (box.top + box.bottom) / 2;
      if (Math.hypot(cx - acx, cy - acy) <= ERASE_R) {
        addIfUnseen(element);
      }
    }

    for (const element of context.dom.plotEl.querySelectorAll('.bond-hit')) {
      if (seen.has(element)) {
        continue;
      }
      const p1 = svgPtToScreen(element, parseFloat(element.getAttribute('x1')), parseFloat(element.getAttribute('y1')));
      const p2 = svgPtToScreen(element, parseFloat(element.getAttribute('x2')), parseFloat(element.getAttribute('y2')));
      if (!p1 || !p2) {
        continue;
      }
      if (distToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y) <= ERASE_R) {
        addIfUnseen(element);
      }
    }

    for (const element of candidates) {
      if (element === lastEraseHitElement) {
        return;
      }
      if (element.classList.contains('node')) {
        const datum = context.helpers.getDatum(element);
        if (!datum || datum.name === 'H') {
          continue;
        }
        lastEraseHitElement = element;
        context.view.showPrimitiveHover([datum.id], []);
        context.schedule(() => {
          if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
            context.actions.eraseItem([datum.id], []);
          }
        });
        return;
      }
      if (element.classList.contains('bond-hover-target')) {
        const datum = context.helpers.getDatum(element);
        if (!datum) {
          continue;
        }
        const currentMol = context.state.documentState.getCurrentMol();
        const bond = currentMol?.bonds.get(datum.id);
        if (bond?.atoms.some(id => currentMol.atoms.get(id)?.name === 'H')) {
          continue;
        }
        lastEraseHitElement = element;
        context.view.showPrimitiveHover([], [datum.id]);
        context.schedule(() => {
          if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
            context.actions.eraseItem([], [datum.id]);
          }
        });
        return;
      }
      if (element.classList.contains('atom-hit')) {
        const group = element.closest('[data-atom-id]');
        if (!group) {
          continue;
        }
        const atomId = group.getAttribute('data-atom-id');
        lastEraseHitElement = element;
        context.view.showPrimitiveHover([atomId], []);
        context.schedule(() => {
          if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
            context.actions.eraseItem([atomId], []);
          }
        });
        return;
      }
      if (element.classList.contains('bond-hit')) {
        const group = element.closest('[data-bond-id]');
        if (!group) {
          continue;
        }
        const bondId = group.getAttribute('data-bond-id');
        lastEraseHitElement = element;
        context.view.showPrimitiveHover([], [bondId]);
        context.schedule(() => {
          if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
            context.actions.eraseItem([], [bondId]);
          }
        });
        return;
      }
    }

    lastEraseHitElement = null;
  }

  svg.on('mousedown.selection', event => {
    const mode = context.state.viewState.getMode();
    if (!context.state.overlayState.getSelectMode()) {
      return;
    }
    if (mode === '2d' && !context.state.documentState.getMol2d()) {
      return;
    }
    if (mode === 'force' && !context.state.documentState.getCurrentMol()) {
      return;
    }
    if (mode !== '2d' && mode !== 'force') {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest('.atom-hit, .bond-hit, .node, .bond-hover-target, .link, .separator')) {
      return;
    }

    const [x, y] = selectionEventPoint(event, true);
    selectionDragging = true;
    selectionStart = { x, y };
    selectionAdditive = isAdditiveSelectionEvent(event);
    selectionBaseAtomIds = new Set(context.state.overlayState.getSelectedAtomIds());
    selectionBaseBondIds = new Set(context.state.overlayState.getSelectedBondIds());
    selectionRect.attr('x', x).attr('y', y).attr('width', 0).attr('height', 0).style('display', null);
    event.preventDefault();
  });

  svg.on('mousemove.selection', event => {
    if (!selectionDragging) {
      return;
    }
    const [x, y] = selectionEventPoint(event, true);
    updateSelectionRect(x, y);
    applySelectionDragResult(x, y);
  });

  svg.on('mouseup.selection', event => {
    finishSelectionDrag(event);
  });

  svg.on('mousedown.drawbond', event => {
    const mode = context.state.viewState.getMode();
    if (!context.state.overlayState.getDrawBondMode()) {
      return;
    }
    if (mode !== '2d' && mode !== 'force') {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (context.overlays.hasReactionPreview()) {
      return;
    }
    if (context.overlays.hasActiveResonanceView?.()) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    if (event.target.closest('.atom-hit, .bond-hit, .node, .bond-hover-target, .link, .separator')) {
      return;
    }

    event.stopPropagation();
    const [gX, gY] = context.pointer(event, g.node());
    context.drawBond.start(null, gX, gY);
  });

  svg.on('mousedown.ring-template', event => {
    const mode = context.state.viewState.getMode();
    if (!isRingTemplateMode()) {
      return;
    }
    if (mode !== '2d' && mode !== 'force') {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (context.overlays.hasReactionPreview()) {
      return;
    }
    if (event.target.closest('.atom-hit, .bond-hit, .node, .bond-hover-target, .link, .separator')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const [gX, gY] = context.pointer(event, g.node());
    context.actions.placeRingTemplate?.(context.state.overlayState.getRingTemplateSize?.() ?? 6, gX, gY);
  });

  svg.on('mousedown.erase', event => {
    if (!context.state.overlayState.getEraseMode() || event.button !== 0) {
      return;
    }
    context.state.overlayState.setErasePainting(true);
    const cursor = context.dom.getEraseCursorElement();
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    cursor.style.display = 'block';
  });

  svg.on('mousedown.paint', event => {
    if ((!isPaintBrushMode() && !isPaintEraserMode()) || event.button !== 0) {
      return;
    }
    hidePaintBucketPreview();
    restorePaintBrushPreview();
    paintPainting = true;
    paintStrokeHasSnapshot = false;
    paintStrokeTargetKeys = new Set();
    event.preventDefault();
    event.stopPropagation();
    applyPaintStroke(event);
  });

  svg.on('mousedown.paint-bucket', event => {
    if (!isPaintBucketMode() || (event.button != null && event.button !== 0)) {
      return;
    }
    restorePaintBrushPreview();
    paintBucketPainting = true;
    paintBucketStrokeHasSnapshot = false;
    paintBucketStrokeTargetKeys = new Set();
    paintBucketStrokeRings = [];
    hidePaintBucketPreview();
    event.preventDefault();
    event.stopPropagation();
    if (event.target?.closest?.('.atom-hit, .bond-hit, .node, .bond-hover-target')) {
      return;
    }
    applyPaintBucketStroke(event);
  });

  svg.on('dblclick.select-all', event => {
    if (
      context.state.overlayState.getDrawBondMode() ||
      context.drawBond.hasDrawBondState() ||
      isRingTemplateMode() ||
      context.state.overlayState.getEraseMode() ||
      (context.state.overlayState.getPaintMode?.() ?? false) ||
      context.state.overlayState.getChargeTool?.()
    ) {
      return;
    }
    const mol = context.state.viewState.getMode() === 'force' ? context.state.documentState.getCurrentMol() : context.state.documentState.getMol2d();
    if (!mol) {
      return;
    }
    if (event.target.closest('.node, .bond-hover-target, .atom-hit, .bond-hit')) {
      return;
    }
    if (!context.state.overlayState.getSelectMode()) {
      context.selection.toggleSelectMode();
    }
    for (const [id] of mol.atoms) {
      context.state.overlayState.getSelectedAtomIds().add(id);
    }
    for (const [id] of mol.bonds) {
      context.state.overlayState.getSelectedBondIds().add(id);
    }
    context.renderers.applySelectionOverlay();
  });

  svg.on('click.force-selection-clear', event => {
    if (!context.state.overlayState.getSelectMode() || context.state.viewState.getMode() !== 'force') {
      return;
    }
    if (suppressForceSelectionClearClick) {
      suppressForceSelectionClearClick = false;
      return;
    }
    if (event.target.closest('.node, .bond-hover-target')) {
      return;
    }
    if (isAdditiveSelectionEvent(event)) {
      return;
    }
    context.state.overlayState.getSelectedAtomIds().clear();
    context.state.overlayState.getSelectedBondIds().clear();
    context.renderers.applySelectionOverlay();
  });

  doc.addEventListener('mousemove', event => {
    lastPaintPreviewEvent = event;
    context.view.setDrawBondHoverSuppressed(false);
    if (context.drawBond.hasDrawBondState()) {
      context.drawBond.markDragged();
      context.drawBond.updatePreview(context.pointer(event, g.node()), {
        ctrlKey: event.ctrlKey === true,
        metaKey: event.metaKey === true
      });
      return;
    }
    if (!selectionDragging) {
      return;
    }
    const [x, y] = selectionEventPoint(event, true);
    updateSelectionRect(x, y);
    applySelectionDragResult(x, y);
  });

  doc.addEventListener('mousemove', handleErasePaintMove);
  doc.addEventListener('mousemove', applyPaintStroke);
  doc.addEventListener('mousemove', updatePaintBrushPreview);
  doc.addEventListener('mousemove', applyPaintBucketStroke);
  doc.addEventListener('mousemove', updatePaintBucketPreview);
  doc.addEventListener('mousemove', updatePaintEraserPreview);
  doc.addEventListener(PAINT_SETTINGS_CHANGED_EVENT, refreshPaintPreview);

  doc.addEventListener('mouseup', event => {
    if (event.button === 0) {
      context.state.overlayState.setErasePainting(false);
      lastEraseHitElement = null;
      context.dom.getEraseCursorElement().style.display = 'none';
      paintPainting = false;
      paintStrokeHasSnapshot = false;
      paintStrokeTargetKeys.clear();
      updatePaintBrushPreview(event);
      paintBucketPainting = false;
      paintBucketStrokeHasSnapshot = false;
      paintBucketStrokeTargetKeys.clear();
      paintBucketStrokeRings = [];
      updatePaintBucketPreview(event);
      updatePaintEraserPreview(event);
    }
    if (context.drawBond.hasDrawBondState()) {
      if (event.button === 0) {
        context.drawBond.commit();
      }
      return;
    }
    finishSelectionDrag(event);
  });

  return {
    refreshPaintPreview
  };
}
