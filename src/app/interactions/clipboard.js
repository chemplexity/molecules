/** @module app/interactions/clipboard */

import { createMoleculeFragment, mergeMoleculeFragment } from '../../core/molecule-fragment.js';
import {
  ARO_STROKE,
  PI_STROKE,
  STROKE_W,
  atomDisplayColor,
  atomDisplayOpacity,
  atomRadius,
  bondAtomColor,
  bondDisplayColor,
  bondDisplayOpacity,
  getRenderOptions,
  renderAtomLabel,
  renderBondOrder,
  singleBondWidth,
  strokeColor
} from '../render/helpers.js';
import { convertLineCoordsToForceLayout, forceLayoutBondScale, FORCE_LAYOUT_H_BOND_LENGTH } from '../render/force-helpers.js';
import { chargeBadgeMetrics, formatChargeLabel, labelHalfH, labelHalfW } from '../../layout/mol2d-helpers.js';
import { finiteNumber } from './geometry-utils.js';

const PASTE_VIEWPORT_PADDING = 2;

function visibleFragmentAtoms(fragment) {
  return (fragment?.atoms ?? []).filter(atom => atom.visible !== false);
}

function forcePreviewAtoms(fragment) {
  return fragment?.atoms ?? [];
}

function isStereoHydrogen(atom, model) {
  if (atom?.name !== 'H') {
    return false;
  }
  return (model.bondsByAtomId.get(atom.id) ?? []).some(bond => {
    const displayAs = bond?.properties?.display?.as ?? null;
    return displayAs === 'wedge' || displayAs === 'dash';
  });
}

function suppressHydrogenIn2dPreview(atom, model) {
  return atom?.name === 'H' && !isStereoHydrogen(atom, model);
}

function visible2dPreviewAtoms(fragment, model) {
  return visibleFragmentAtoms(fragment).filter(atom => !suppressHydrogenIn2dPreview(atom, model));
}

function fragmentCenterLocal(context, mode, center) {
  if (mode === 'force') {
    return center;
  }
  const { width = 600, height = 400 } = context.plot.getSize();
  const scale = context.view.scale;
  return {
    x: width / 2 + (center.x - context.view.get2DCenterX()) * scale,
    y: height / 2 - (center.y - context.view.get2DCenterY()) * scale
  };
}

function localToMoleculeCenter(context, point) {
  const { width = 600, height = 400 } = context.plot.getSize();
  const scale = context.view.scale;
  return {
    x: context.view.get2DCenterX() + (point.x - width / 2) / scale,
    y: context.view.get2DCenterY() - (point.y - height / 2) / scale
  };
}

function rendered2dAtomPositions(context, mol) {
  if (!mol?.atoms || typeof context.view.get2DAtomPoint !== 'function') {
    return null;
  }
  const positions = new Map();
  for (const atom of mol.atoms.values()) {
    const point = context.view.get2DAtomPoint(atom);
    const x = finiteNumber(point?.x);
    const y = finiteNumber(point?.y);
    if (x != null && y != null) {
      positions.set(atom.id, { x, y });
    }
  }
  return positions.size > 0 ? positions : null;
}

function converted2dForceAtomPositions(context, mol) {
  if (!mol?.atoms) {
    return null;
  }
  const layoutBondLength = finiteNumber(getRenderOptions().layoutBondLength) ?? 1.5;
  const converted = convertLineCoordsToForceLayout(mol, {
    bondLength: layoutBondLength,
    hydrogenMode: 'stable'
  });
  return converted.coords?.size > 0 ? converted.coords : null;
}

function fragmentAtomCharge(atom) {
  return Number(atom?.properties?.charge ?? 0) || 0;
}

function fragmentModel(fragment) {
  const atomById = new Map((fragment?.atoms ?? []).map(atom => [atom.id, atom]));
  const bonds = (fragment?.bonds ?? []).filter(bond => atomById.has(bond.atoms?.[0]) && atomById.has(bond.atoms?.[1]));
  const bondsByAtomId = new Map();
  for (const atom of atomById.values()) {
    bondsByAtomId.set(atom.id, []);
  }
  for (const bond of bonds) {
    bondsByAtomId.get(bond.atoms[0])?.push(bond);
    bondsByAtomId.get(bond.atoms[1])?.push(bond);
  }
  return { atomById, bonds, bondsByAtomId };
}

function otherAtomId(bond, atomId) {
  return bond.atoms?.[0] === atomId ? bond.atoms?.[1] : bond.atoms?.[0];
}

function atomHasForceOffset(atom) {
  return finiteNumber(atom?.forceDx) != null && finiteNumber(atom?.forceDy) != null;
}

function currentForceHydrogenDistance() {
  const layoutBondLength = finiteNumber(getRenderOptions().layoutBondLength) ?? 1.5;
  return FORCE_LAYOUT_H_BOND_LENGTH * forceLayoutBondScale(layoutBondLength);
}

function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

function chooseOpenHydrogenAngles(occupiedAngles, count) {
  if (count <= 0) {
    return [];
  }
  if (occupiedAngles.length === 0) {
    return Array.from({ length: count }, (_, index) => -Math.PI / 2 + (Math.PI * 2 * index) / count);
  }
  const sorted = occupiedAngles.map(normalizeAngle).sort((a, b) => a - b);
  let bestStart = sorted[0];
  let bestGap = 0;
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index];
    const end = index === sorted.length - 1 ? sorted[0] + Math.PI * 2 : sorted[index + 1];
    const gap = end - start;
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = start;
    }
  }
  return Array.from({ length: count }, (_, index) => bestStart + (bestGap * (index + 1)) / (count + 1));
}

function placeMissingForceHydrogens(fragment, model, pointByAtomId) {
  const groups = new Map();
  for (const atom of forcePreviewAtoms(fragment)) {
    if (atom.name !== 'H' || atomHasForceOffset(atom)) {
      continue;
    }
    const bonds = model.bondsByAtomId.get(atom.id) ?? [];
    if (bonds.length !== 1) {
      continue;
    }
    const parentId = otherAtomId(bonds[0], atom.id);
    const parentAtom = model.atomById.get(parentId);
    if (!parentAtom || parentAtom.name === 'H' || !pointByAtomId.has(parentId)) {
      continue;
    }
    if (!groups.has(parentId)) {
      groups.set(parentId, []);
    }
    groups.get(parentId).push(atom);
  }

  const distance = currentForceHydrogenDistance();
  for (const [parentId, hydrogens] of groups) {
    const parentPoint = pointByAtomId.get(parentId);
    const groupIds = new Set(hydrogens.map(atom => atom.id));
    const occupiedAngles = (model.bondsByAtomId.get(parentId) ?? [])
      .map(bond => otherAtomId(bond, parentId))
      .filter(atomId => atomId && !groupIds.has(atomId) && pointByAtomId.has(atomId))
      .map(atomId => {
        const point = pointByAtomId.get(atomId);
        return Math.atan2(point.y - parentPoint.y, point.x - parentPoint.x);
      });
    const angles = chooseOpenHydrogenAngles(occupiedAngles, hydrogens.length);
    hydrogens.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    hydrogens.forEach((atom, index) => {
      const angle = angles[index] ?? -Math.PI / 2;
      pointByAtomId.set(atom.id, {
        x: parentPoint.x + Math.cos(angle) * distance,
        y: parentPoint.y + Math.sin(angle) * distance
      });
    });
  }
}

function heavyNeighborAtoms(atom, model) {
  return (model.bondsByAtomId.get(atom.id) ?? [])
    .map(bond => model.atomById.get(otherAtomId(bond, atom.id)))
    .filter(neighbor => neighbor && neighbor.name !== 'H');
}

function hiddenHydrogenCount(atom, model, options = {}) {
  return (model.bondsByAtomId.get(atom.id) ?? [])
    .map(bond => model.atomById.get(otherAtomId(bond, atom.id)))
    .filter(neighbor => neighbor?.name === 'H' && (neighbor.visible === false || (options.suppress2dHydrogens === true && suppressHydrogenIn2dPreview(neighbor, model)))).length;
}

function previewAtomLabel(atom, model, pointByAtomId, options = {}) {
  const charge = fragmentAtomCharge(atom);
  const heavyNeighbors = heavyNeighborAtoms(atom, model);
  if (atom.name === 'C' && charge === 0 && heavyNeighbors.length > 0) {
    return null;
  }
  const hCount = atom.name === 'H' ? 0 : hiddenHydrogenCount(atom, model, options);
  if (hCount === 0) {
    return atom.name;
  }
  const hStr = hCount === 1 ? 'H' : `H${hCount}`;
  if (heavyNeighbors.length === 0) {
    return new Set(['F', 'Cl', 'Br', 'I', 'O', 'S', 'Se', 'Te']).has(atom.name) ? hStr + atom.name : atom.name + hStr;
  }
  const atomPoint = pointByAtomId.get(atom.id);
  const avgDx =
    heavyNeighbors.reduce((sum, neighbor) => {
      const neighborPoint = pointByAtomId.get(neighbor.id);
      return sum + ((neighborPoint?.x ?? atomPoint?.x ?? 0) - (atomPoint?.x ?? 0));
    }, 0) / heavyNeighbors.length;
  return avgDx > 0 ? hStr + atom.name : atom.name + hStr;
}

function perpUnit(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

function shortenForLabels(a, b, atomA, atomB, labelByAtomId, fontSize, extra = 3) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const trimA = labelByAtomId.get(atomA.id) ? Math.min(len * 0.35, labelHalfW(labelByAtomId.get(atomA.id), fontSize) + extra) : 0;
  const trimB = labelByAtomId.get(atomB.id) ? Math.min(len * 0.35, labelHalfW(labelByAtomId.get(atomB.id), fontSize) + extra) : 0;
  return {
    x1: a.x + (dx / len) * trimA,
    y1: a.y + (dy / len) * trimA,
    x2: b.x - (dx / len) * trimB,
    y2: b.y - (dy / len) * trimB
  };
}

function addPreviewLine(group, x1, y1, x2, y2, { stroke = '#111', opacity = 1, width = STROKE_W, className = 'bond', dashArray = null } = {}) {
  const line = group
    .append('line')
    .attr('class', className)
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('pointer-events', 'none')
    .style('stroke', stroke)
    .style('stroke-opacity', opacity)
    .style('stroke-width', typeof width === 'number' ? `${width}px` : width)
    .style('stroke-linecap', 'round');
  if (dashArray) {
    line.style('stroke-dasharray', dashArray);
  }
  return line;
}

function addPreviewBondSegments(group, line, atomA, atomB, bond, extra = {}) {
  const explicitColor = bondDisplayColor(bond);
  const opacity = bondDisplayOpacity(bond);
  const colorA = explicitColor ?? bondAtomColor(atomA.name);
  const colorB = explicitColor ?? bondAtomColor(atomB.name);
  if (colorA === colorB) {
    addPreviewLine(group, line.x1, line.y1, line.x2, line.y2, { stroke: colorA, opacity, ...extra });
    return;
  }
  const midX = (line.x1 + line.x2) / 2;
  const midY = (line.y1 + line.y2) / 2;
  addPreviewLine(group, line.x1, line.y1, midX, midY, { stroke: colorA, opacity, ...extra });
  addPreviewLine(group, midX, midY, line.x2, line.y2, { stroke: colorB, opacity, ...extra });
}

function drawPreviewStereoBond(group, bond, atomA, atomB, pointA, pointB, labelByAtomId, fontSize) {
  const displayAs = bond.properties?.display?.as;
  if (displayAs !== 'wedge' && displayAs !== 'dash') {
    return false;
  }
  const centerId = bond.properties?.display?.centerId ?? bond.atoms?.[0];
  const sourceAtom = centerId === atomB.id ? atomB : atomA;
  const targetAtom = sourceAtom === atomA ? atomB : atomA;
  const sourcePoint = sourceAtom === atomA ? pointA : pointB;
  const targetPoint = sourceAtom === atomA ? pointB : pointA;
  const line = shortenForLabels(sourcePoint, targetPoint, sourceAtom, targetAtom, labelByAtomId, fontSize, 2);
  const start = { x: line.x1, y: line.y1 };
  const end = { x: line.x2, y: line.y2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const color = bondDisplayColor(bond) ?? '#111';
  const opacity = bondDisplayOpacity(bond);
  const halfWidth = 5;
  if (displayAs === 'wedge') {
    group
      .append('polygon')
      .attr('class', 'bond bond-wedge')
      .attr('points', `${start.x},${start.y} ${end.x - nx * halfWidth},${end.y - ny * halfWidth} ${end.x + nx * halfWidth},${end.y + ny * halfWidth}`)
      .style('fill', color)
      .style('fill-opacity', opacity)
      .style('stroke', 'none');
  } else {
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const px = start.x + dx * t;
      const py = start.y + dy * t;
      const dashHalfWidth = halfWidth * t;
      addPreviewLine(group, px - nx * dashHalfWidth, py - ny * dashHalfWidth, px + nx * dashHalfWidth, py + ny * dashHalfWidth, {
        stroke: color,
        opacity,
        width: 1.2,
        className: 'bond bond-hash'
      });
    }
  }
  return true;
}

function drawPreviewRingFills(layer, fragment, pointByAtomId) {
  const fills = (fragment.ringFills ?? []).filter(fill => (fill.atomIds ?? []).every(atomId => pointByAtomId.has(atomId)));
  if (fills.length === 0) {
    return;
  }
  const ringLayer = layer.append('g').attr('class', 'paste-preview-ring-fills').attr('pointer-events', 'none');
  for (const fill of fills) {
    const points = fill.atomIds.map(atomId => pointByAtomId.get(atomId));
    const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const ordered = points
      .map(point => ({ point, angle: Math.atan2(point.y - cy, point.x - cx) }))
      .sort((a, b) => a.angle - b.angle)
      .map(entry => `${entry.point.x},${entry.point.y}`)
      .join(' ');
    ringLayer.append('polygon').attr('points', ordered).attr('fill', fill.color).attr('opacity', fill.opacity).attr('stroke', 'none');
  }
}

function draw2dPreview(context, layer, fragment, model, pointByAtomId) {
  const { twoDAtomFontSize: fontSize } = getRenderOptions();
  const visibleAtoms = visible2dPreviewAtoms(fragment, model);
  const labelByAtomId = new Map();
  for (const atom of visibleAtoms) {
    const label = previewAtomLabel(atom, model, pointByAtomId, { suppress2dHydrogens: true });
    if (label) {
      labelByAtomId.set(atom.id, label);
    }
  }

  drawPreviewRingFills(layer, fragment, pointByAtomId);
  const bondsLayer = layer.append('g').attr('class', 'paste-preview-bonds');
  const visibleAtomIds = new Set(visibleAtoms.map(atom => atom.id));
  for (const bond of model.bonds) {
    if (!visibleAtomIds.has(bond.atoms?.[0]) || !visibleAtomIds.has(bond.atoms?.[1])) {
      continue;
    }
    const atomA = model.atomById.get(bond.atoms[0]);
    const atomB = model.atomById.get(bond.atoms[1]);
    const pointA = pointByAtomId.get(atomA.id);
    const pointB = pointByAtomId.get(atomB.id);
    if (!pointA || !pointB) {
      continue;
    }
    if (drawPreviewStereoBond(bondsLayer, bond, atomA, atomB, pointA, pointB, labelByAtomId, fontSize)) {
      continue;
    }
    const order = renderBondOrder(bond);
    const { nx, ny } = perpUnit(pointA, pointB);
    const offset = 7;
    const primary = shortenForLabels(pointA, pointB, atomA, atomB, labelByAtomId, fontSize);
    if (order === 1) {
      addPreviewBondSegments(bondsLayer, primary, atomA, atomB, bond);
    } else if (order === 2) {
      const hasLabel = labelByAtomId.has(atomA.id) || labelByAtomId.has(atomB.id);
      const offsets = hasLabel ? [-offset / 2, offset / 2] : [0, offset];
      for (const d of offsets) {
        const line = shortenForLabels({ x: pointA.x + nx * d, y: pointA.y + ny * d }, { x: pointB.x + nx * d, y: pointB.y + ny * d }, atomA, atomB, labelByAtomId, fontSize, d === 0 ? 3 : 5);
        addPreviewBondSegments(bondsLayer, line, atomA, atomB, bond);
      }
    } else if (order === 3) {
      for (const d of [-offset, 0, offset]) {
        const line = shortenForLabels({ x: pointA.x + nx * d, y: pointA.y + ny * d }, { x: pointB.x + nx * d, y: pointB.y + ny * d }, atomA, atomB, labelByAtomId, fontSize, d === 0 ? 3 : 5);
        addPreviewBondSegments(bondsLayer, line, atomA, atomB, bond);
      }
    } else if (order === 1.5) {
      addPreviewBondSegments(bondsLayer, primary, atomA, atomB, bond);
      const line = shortenForLabels({ x: pointA.x + nx * offset, y: pointA.y + ny * offset }, { x: pointB.x + nx * offset, y: pointB.y + ny * offset }, atomA, atomB, labelByAtomId, fontSize, 5);
      addPreviewBondSegments(bondsLayer, line, atomA, atomB, bond, { dashArray: ARO_STROKE.dashArray, width: STROKE_W });
    }
  }

  const bgLayer = layer.append('g').attr('class', 'atom-bgs');
  for (const atom of visibleAtoms) {
    const label = labelByAtomId.get(atom.id);
    const point = pointByAtomId.get(atom.id);
    if (!label || !point) {
      continue;
    }
    const hw = labelHalfW(label, fontSize);
    const hh = labelHalfH(label, fontSize);
    bgLayer.append('rect').attr('class', 'atom-bg').attr('x', point.x - hw).attr('y', point.y - hh).attr('width', hw * 2).attr('height', hh * 2).attr('rx', 2);
  }

  const labelLayer = layer.append('g').attr('class', 'atom-labels');
  for (const atom of visibleAtoms) {
    const label = labelByAtomId.get(atom.id);
    const point = pointByAtomId.get(atom.id);
    if (!label || !point) {
      continue;
    }
    const group = labelLayer.append('g').attr('data-atom-id', atom.id).attr('transform', `translate(${point.x},${point.y})`);
    const color = atom.properties?.style ? atomDisplayColor(atom, '2d') : atom.name === 'H' ? '#333333' : atomDisplayColor(atom, '2d');
    renderAtomLabel(group, label, color, 0, 0, fontSize).attr('opacity', atomDisplayOpacity(atom));
    const chargeLabel = formatChargeLabel(fragmentAtomCharge(atom));
    if (chargeLabel) {
      const metrics = chargeBadgeMetrics(chargeLabel, fontSize);
      const x = labelHalfW(label, fontSize) + metrics.radius * 0.75;
      const y = -labelHalfH(label, fontSize) * 0.55;
      group.append('circle').attr('class', 'atom-charge-ring').attr('cx', x).attr('cy', y).attr('r', metrics.radius).attr('fill', 'white').attr('stroke', '#111111').attr('stroke-width', 0.9).attr('opacity', atomDisplayOpacity(atom));
      group.append('text').attr('class', 'atom-charge-text').attr('x', x).attr('y', y).style('font-size', `${metrics.fontSize}px`).attr('fill', '#111111').attr('opacity', atomDisplayOpacity(atom)).attr('text-anchor', 'middle').attr('dominant-baseline', 'central').text(chargeLabel);
    }
  }
}

function drawForcePreview(layer, fragment, model, pointByAtomId) {
  const bondsLayer = layer.append('g').attr('class', 'paste-preview-bonds');
  const visibleAtomIds = new Set(forcePreviewAtoms(fragment).map(atom => atom.id));
  for (const bond of model.bonds) {
    if (!visibleAtomIds.has(bond.atoms?.[0]) || !visibleAtomIds.has(bond.atoms?.[1])) {
      continue;
    }
    const a = pointByAtomId.get(bond.atoms[0]);
    const b = pointByAtomId.get(bond.atoms[1]);
    if (!a || !b) {
      continue;
    }
    const order = renderBondOrder(bond);
    const color = bondDisplayColor(bond);
    const opacity = bondDisplayOpacity(bond);
    if (order === 1 || order === 2 || order === 3) {
      addPreviewLine(bondsLayer, a.x, a.y, b.x, b.y, {
        className: 'link',
        stroke: color ?? '#999',
        opacity,
        width: singleBondWidth(order)
      });
    }
    if (order === 2 || order === 3) {
      addPreviewLine(bondsLayer, a.x, a.y, b.x, b.y, {
        className: 'separator',
        stroke: PI_STROKE.stroke,
        opacity,
        width: PI_STROKE.width
      });
    }
    if (order === 3) {
      addPreviewLine(bondsLayer, a.x, a.y, b.x, b.y, {
        className: 'separator',
        stroke: PI_STROKE.stroke,
        opacity,
        width: PI_STROKE.width
      });
    }
    if (order === 1.5) {
      addPreviewLine(bondsLayer, a.x, a.y, b.x, b.y, {
        className: 'link separator',
        stroke: ARO_STROKE.stroke,
        opacity,
        width: ARO_STROKE.width
      });
      addPreviewLine(bondsLayer, a.x, a.y, b.x, b.y, {
        className: 'link separator',
        stroke: ARO_STROKE.stroke,
        opacity,
        width: ARO_STROKE.width,
        dashArray: ARO_STROKE.dashArray
      });
    }
  }

  const atomLayer = layer.append('g').attr('class', 'paste-preview-atoms');
  const labelByAtomId = new Map();
  for (const atom of forcePreviewAtoms(fragment)) {
    const label = previewAtomLabel(atom, model, pointByAtomId);
    if (label) {
      labelByAtomId.set(atom.id, label);
    }
  }
  for (const atom of forcePreviewAtoms(fragment)) {
    const point = pointByAtomId.get(atom.id);
    if (!point) {
      continue;
    }
    const label = labelByAtomId.get(atom.id) ?? atom.name;
    const opacity = atomDisplayOpacity(atom);
    const radius = atomRadius(atom.properties?.protons, 'force');
    atomLayer.append('circle').attr('class', 'node').attr('cx', point.x).attr('cy', point.y).attr('r', radius).attr('fill', atomDisplayColor(atom, 'force')).attr('fill-opacity', opacity).attr('stroke', strokeColor(atom.name)).attr('stroke-opacity', opacity).attr('stroke-width', 1);
    const fill = (() => {
      if (atom.name === 'H' && !atom.properties?.style) {
        return '#111';
      }
      const hex = atomDisplayColor(atom, 'force');
      const cr = parseInt(hex.slice(1, 3), 16);
      const cg = parseInt(hex.slice(3, 5), 16);
      const cb = parseInt(hex.slice(5, 7), 16);
      return cr * 0.299 + cg * 0.587 + cb * 0.114 > 140 ? '#333' : '#fff';
    })();
    atomLayer
      .append('text')
      .attr('class', 'atom-symbol')
      .attr('x', point.x)
      .attr('y', point.y)
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-family', 'Arial, Helvetica, sans-serif')
      .attr('font-weight', 'bold')
      .attr('font-size', label.length > 1 ? '7px' : '9px')
      .attr('fill', fill)
      .attr('opacity', opacity)
      .text(label);
    const chargeLabel = formatChargeLabel(fragmentAtomCharge(atom));
    if (chargeLabel) {
      const metrics = chargeBadgeMetrics(chargeLabel, 11);
      const x = point.x + radius + metrics.radius * 0.65;
      const y = point.y - radius * 0.75;
      atomLayer.append('circle').attr('class', 'charge-label-ring').attr('cx', x).attr('cy', y).attr('r', metrics.radius).attr('fill', 'white').attr('stroke', '#111111').attr('stroke-width', 0.9).attr('opacity', opacity);
      atomLayer.append('text').attr('class', 'charge-label-text').attr('x', x).attr('y', y).attr('font-family', 'Arial, Helvetica, sans-serif').attr('font-size', `${metrics.fontSize}px`).attr('font-weight', '700').attr('fill', '#111111').attr('opacity', opacity).attr('text-anchor', 'middle').attr('dominant-baseline', 'central').text(chargeLabel);
    }
  }
}

function drawPreview(context, fragment, mode, center) {
  const g = context.dom.g;
  g.select('g.paste-preview-layer').remove();
  if (!fragment) {
    return;
  }
  const layer = g.append('g').attr('class', 'paste-preview-layer').attr('pointer-events', 'none');
  const scale = mode === 'force' ? context.view.forceScale : context.view.scale;
  const localCenter = fragmentCenterLocal(context, mode, center);
  const model = fragmentModel(fragment);
  const pointByAtomId = new Map();
  for (const atom of fragment.atoms) {
    const forceDx = finiteNumber(atom.forceDx);
    const forceDy = finiteNumber(atom.forceDy);
    const dx = finiteNumber(atom.dx) ?? 0;
    const dy = finiteNumber(atom.dy) ?? 0;
    if (mode === 'force' && forceDx != null && forceDy != null) {
      pointByAtomId.set(atom.id, {
        x: localCenter.x + forceDx,
        y: localCenter.y + forceDy
      });
    } else {
      pointByAtomId.set(atom.id, {
        x: localCenter.x + dx * scale,
        y: localCenter.y - dy * scale
      });
    }
  }
  if (mode === 'force') {
    placeMissingForceHydrogens(fragment, model, pointByAtomId);
  }

  if (mode === 'force') {
    drawForcePreview(layer, fragment, model, pointByAtomId);
  } else {
    draw2dPreview(context, layer, fragment, model, pointByAtomId);
  }
}

function forcePatchForFragment(fragment, mergeResult, center, forceScale) {
  const patch = new Map();
  const model = fragmentModel(fragment);
  const pointByAtomId = new Map();
  for (const atom of fragment.atoms ?? []) {
    const newId = mergeResult.atomIdMap.get(atom.id);
    if (!newId) {
      continue;
    }
    const forceDx = finiteNumber(atom.forceDx);
    const forceDy = finiteNumber(atom.forceDy);
    const dx = finiteNumber(atom.dx) ?? 0;
    const dy = finiteNumber(atom.dy) ?? 0;
    if (forceDx != null && forceDy != null) {
      pointByAtomId.set(atom.id, {
        x: center.x + forceDx,
        y: center.y + forceDy
      });
    } else {
      pointByAtomId.set(atom.id, {
        x: center.x + dx * forceScale,
        y: center.y - dy * forceScale
      });
    }
  }
  placeMissingForceHydrogens(fragment, model, pointByAtomId);
  for (const [sourceId, point] of pointByAtomId) {
    const newId = mergeResult.atomIdMap.get(sourceId);
    if (newId) {
      patch.set(newId, point);
    }
  }
  return patch;
}

function finiteRect(rect) {
  return (
    rect &&
    Number.isFinite(Number(rect.left)) &&
    Number.isFinite(Number(rect.right)) &&
    Number.isFinite(Number(rect.top)) &&
    Number.isFinite(Number(rect.bottom))
  );
}

function rectInside(inner, outer, padding = PASTE_VIEWPORT_PADDING) {
  return (
    finiteRect(inner) &&
    finiteRect(outer) &&
    inner.left >= outer.left + padding &&
    inner.right <= outer.right - padding &&
    inner.top >= outer.top + padding &&
    inner.bottom <= outer.bottom - padding
  );
}

function pastePreviewFitsViewport(context) {
  const layerNode = context.dom.g.select('g.paste-preview-layer').node?.() ?? null;
  const plotNode = context.dom.plotElement ?? layerNode?.ownerSVGElement ?? context.dom.g.node?.()?.ownerSVGElement ?? null;
  const layerRect = layerNode?.getBoundingClientRect?.() ?? null;
  const plotRect = plotNode?.getBoundingClientRect?.() ?? null;
  return rectInside(layerRect, plotRect);
}

/**
 * Creates copy/paste actions for molecule fragments.
 * @param {object} context - Clipboard dependency context.
 * @returns {object} Clipboard actions.
 */
export function createClipboardActions(context) {
  let clipboardFragment = null;
  let pasteState = null;

  function clearPreview() {
    context.dom.g.select('g.paste-preview-layer').remove();
  }

  function hasPastePreview() {
    return !!pasteState;
  }

  function copySelection() {
    const mol = context.molecule.getActive();
    if (!mol) {
      return false;
    }
    const mode = context.state.getMode();
    const selectedAtomIds = context.selection.getSelectedAtomIds();
    const selectedBondIds = context.selection.getSelectedBondIds();
    const forceAtomPositions =
      mode === 'force'
        ? new Map(
            (context.force?.getNodes?.() ?? [])
              .map(node => ({ id: node?.id, x: finiteNumber(node?.x), y: finiteNumber(node?.y) }))
              .filter(node => node.id != null && node.x != null && node.y != null)
              .map(node => [node.id, { x: node.x, y: node.y }])
          )
        : converted2dForceAtomPositions(context, mol) ?? rendered2dAtomPositions(context, mol);
    clipboardFragment = createMoleculeFragment(mol, {
      atomIds: selectedAtomIds.size > 0 || selectedBondIds.size > 0 ? selectedAtomIds : null,
      bondIds: selectedAtomIds.size > 0 || selectedBondIds.size > 0 ? selectedBondIds : null,
      forceAtomPositions
    });
    return !!clipboardFragment;
  }

  function defaultPasteCenter(mode) {
    const { width = 600, height = 400 } = context.plot.getSize();
    if (mode === 'force') {
      return { x: width / 2, y: height / 2 };
    }
    return localToMoleculeCenter(context, { x: width / 2, y: height / 2 });
  }

  function setPasteCenterFromLocalPoint(point, mode) {
    pasteState.center = mode === 'force' ? { x: point.x, y: point.y } : localToMoleculeCenter(context, point);
  }

  function syncPastePreviewToMode() {
    if (!pasteState) {
      return false;
    }
    const mode = context.state.getMode();
    if (mode !== '2d' && mode !== 'force') {
      cancelPastePreview();
      return false;
    }
    if (pasteState.mode !== mode) {
      const localCenter = fragmentCenterLocal(context, pasteState.mode, pasteState.center);
      pasteState.mode = mode;
      setPasteCenterFromLocalPoint(localCenter, mode);
    }
    drawPreview(context, pasteState.fragment, pasteState.mode, pasteState.center);
    return true;
  }

  function beginPastePreview() {
    if (!clipboardFragment || context.overlays.hasReactionPreview() || context.overlays.hasActiveResonanceView()) {
      return false;
    }
    const mode = context.state.getMode();
    if (mode !== '2d' && mode !== 'force') {
      return false;
    }
    pasteState = {
      fragment: clipboardFragment,
      mode,
      center: defaultPasteCenter(mode)
    };
    context.view.clearPrimitiveHover();
    drawPreview(context, pasteState.fragment, pasteState.mode, pasteState.center);
    return true;
  }

  function updatePastePreview(event) {
    if (!pasteState) {
      return false;
    }
    const [x, y] = context.pointer(event, context.dom.g.node());
    const mode = context.state.getMode();
    if (mode !== '2d' && mode !== 'force') {
      cancelPastePreview();
      return false;
    }
    pasteState.mode = mode;
    setPasteCenterFromLocalPoint({ x, y }, mode);
    drawPreview(context, pasteState.fragment, pasteState.mode, pasteState.center);
    return true;
  }

  function cancelPastePreview() {
    if (!pasteState) {
      return false;
    }
    pasteState = null;
    clearPreview();
    return true;
  }

  function placePastePreview() {
    if (!pasteState) {
      return false;
    }
    syncPastePreviewToMode();
    if (!pasteState) {
      return false;
    }
    const mol = context.molecule.getActive();
    if (!mol) {
      cancelPastePreview();
      return false;
    }
    const { fragment, center, mode } = pasteState;
    const zoomSnapshot = mode === '2d' ? context.view.captureZoomTransform?.() : null;
    context.history.takeSnapshot();
    const moleculeCenter = mode === 'force' ? fragment.center : center;
    const mergeResult = mergeMoleculeFragment(mol, fragment, { center: moleculeCenter });
    const preservePlacedView = pastePreviewFitsViewport(context);
    pasteState = null;
    clearPreview();
    if (!mergeResult) {
      return false;
    }

    context.selection.clear();
    if (mode === 'force') {
      for (const atomId of mergeResult.atomIds) {
        context.selection.getSelectedAtomIds().add(atomId);
      }
      for (const bondId of mergeResult.bondIds) {
        context.selection.getSelectedBondIds().add(bondId);
      }
      context.view.setPreserveSelectionOnNextRender(true);
    }

    if (mode === 'force') {
      context.renderers.renderMol(mol, {
        preserveHistory: true,
        preserveView: preservePlacedView,
        forcePreservePositions: true,
        forceInitialPatchPos: forcePatchForFragment(fragment, mergeResult, center, context.view.forceScale)
      });
    } else {
      context.view2D?.syncDerivedState?.(mol);
      context.renderers.draw2d?.();
      context.view.restore2dEditViewport?.(zoomSnapshot, { zoomToFit: { pad: 0 } });
    }
    context.analysis?.syncInputField?.(mol);
    context.analysis?.updateFormula?.(mol);
    context.analysis?.updateDescriptors?.(mol);
    context.analysis?.updatePanels?.(mol);
    context.renderers.refreshSelectionOverlay();
    return true;
  }

  return {
    copySelection,
    beginPastePreview,
    updatePastePreview,
    placePastePreview,
    cancelPastePreview,
    hasPastePreview,
    syncPastePreviewToMode,
    clearPreview
  };
}
