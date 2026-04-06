/** @module app/render/scene-2d */

import { getRenderOptions, atomColor, renderAtomLabel, renderLonePairDots, renderBondOrder, prepareAromaticBondRendering } from './helpers.js';
import { getBondEnOverlayData } from './bond-en-polarity.js';
import {
  labelHalfW,
  labelHalfH,
  labelTextOffset,
  formatChargeLabel,
  computeChargeBadgePlacement,
  getAtomLabel,
  computeLonePairDotPositions,
  syncDisplayStereo,
  stereoBondCenterIdForRender,
  atomBBox
} from '../../layout/mol2d-helpers.js';

function _compute2dFitTransform(ctx, atoms) {
  const { minX, maxX, minY, maxY } = atomBBox(atoms);
  const W = ctx.plotEl.clientWidth || 600;
  const H = ctx.plotEl.clientHeight || 400;
  const PAD = ctx.helpers.hasReactionPreview() ? 12 : 18;
  const pads = ctx.helpers.viewportFitPadding(PAD);
  const horizontalPad = Math.max(PAD, (pads.left + pads.right) / 2);
  const verticalPad = Math.max(PAD, (pads.top + pads.bottom) / 2);
  const scale = ctx.constants.scale;
  const molSVGW = (maxX - minX) * scale || 1;
  const molSVGH = (maxY - minY) * scale || 1;
  const fitCap = ctx.helpers.hasReactionPreview() ? 1.28 : 1;
  const fitScale = Math.min(Math.max(1, W - horizontalPad * 2) / molSVGW, Math.max(1, H - verticalPad * 2) / molSVGH, fitCap);
  const fitTx = W / 2 - (W / 2) * fitScale;
  const fitTy = H / 2 - (H / 2) * fitScale;
  return ctx.d3.zoomIdentity.translate(fitTx, fitTy).scale(fitScale);
}

export function createTwoDSceneRenderer(ctx) {
  const DRAW_MODE_ATOM_HIT_PAD = 6;

  function draw2d() {
    const mol = ctx.state.getMol();
    if (!mol) {
      return;
    }
    const hCounts = ctx.state.getHCounts();
    const toSVGPt = ctx.helpers.toSVGPt;
    const { showLonePairs } = getRenderOptions();
    const fontSize = ctx.constants.getFontSize();
    const valenceWarningMap = ctx.helpers.valenceWarningMapFor(mol);
    ctx.state.setActiveValenceWarningMap(valenceWarningMap);

    const stereoMap = ctx.state.getStereoMap();
    const atoms = [...mol.atoms.values()].filter(a => a.x != null && a.visible !== false);
    const bondInfos = [];
    for (const bond of mol.bonds.values()) {
      const [a1, a2] = bond.getAtomObjects(mol);
      if (!a1 || !a2 || a1.x == null || a2.x == null) {continue;}
      const isHBond = a1.visible === false || a2.visible === false;
      if (isHBond && !(stereoMap && stereoMap.has(bond.id))) {continue;}
      bondInfos.push({ bond, a1, a2 });
    }

    ctx.g.selectAll('*').remove();
    ctx.cache.reset();

    let bgLayer = null;
    let labelLayer = null;
    let lonePairLayer = null;
    let bondLayer = null;
    const lonePairDotsByAtomId = new Map();

    function _get2dLonePairDots(atom, label) {
      if (!showLonePairs) {
        return [];
      }
      const cached = lonePairDotsByAtomId.get(atom.id);
      if (cached) {
        return cached;
      }
      const dots = computeLonePairDotPositions(atom, mol, {
        pointForAtom: toSVGPt,
        label,
        fontSize,
        offsetFromBoundary: label ? 5 : 6,
        dotSpacing: 4.2
      });
      lonePairDotsByAtomId.set(atom.id, dots);
      return dots;
    }

    function _draw2dLonePairs() {
      if (!showLonePairs || !lonePairLayer) {
        return;
      }
      lonePairLayer.selectAll('*').remove();
      for (const atom of atoms) {
        const label = getAtomLabel(atom, hCounts, toSVGPt, mol);
        const dots = _get2dLonePairDots(atom, label);
        if (dots.length === 0) {
          continue;
        }
        const atomGroup = lonePairLayer.append('g').attr('class', 'atom-lone-pairs').attr('data-atom-id', atom.id);
        renderLonePairDots(atomGroup, dots, { radius: 1.45, fill: '#111111' });
      }
    }

    function _redraw2dBondEnOverlay() {
      ctx.g.select('g.bond-en-overlay').remove();
      const overlayData = getBondEnOverlayData(mol);
      if (!overlayData) {return;}
      const enLayer = ctx.g.append('g').attr('class', 'bond-en-overlay').style('pointer-events', 'none');
      const bondInfoMap = new Map(bondInfos.map(bi => [bi.bond.id, bi]));
      const EN_FS = 12;
      const EN_CHW = EN_FS * 0.62;
      const EN_CHH = EN_FS * 1.2;
      const EN_PAD = 3;
      const EN_BASE = 15;
      const placed = [];
      function _enOverlaps(cx, cy, hw, hh) {
        for (const p of placed) {
          if (Math.abs(cx - p.cx) < hw + p.hw + EN_PAD && Math.abs(cy - p.cy) < hh + p.hh + EN_PAD) {return true;}
        }
        return false;
      }
      for (const { bondId, label, t } of overlayData) {
        const bi = bondInfoMap.get(bondId);
        if (!bi) {continue;}
        const p1 = toSVGPt(bi.a1);
        const p2 = toSVGPt(bi.a2);
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const hw = (label.length * EN_CHW) / 2;
        const hh = EN_CHH / 2;
        let pref = 1;
        const order = renderBondOrder(bi.bond);
        if (order >= 2 || order === 1.5) {
          pref = -ctx.helpers.secondaryDir(bi.a1, bi.a2, mol, toSVGPt);
        }
        const offsets = [EN_BASE * pref, EN_BASE * -pref, EN_BASE * 2 * pref, EN_BASE * 2 * -pref, EN_BASE * 3 * pref, EN_BASE * 3 * -pref];
        let cx = mx + nx * EN_BASE * pref;
        let cy = my + ny * EN_BASE * pref;
        for (const off of offsets) {
          const tx = mx + nx * off;
          const ty = my + ny * off;
          if (!_enOverlaps(tx, ty, hw, hh)) {
            cx = tx;
            cy = ty;
            break;
          }
        }
        placed.push({ cx, cy, hw, hh });
        enLayer
          .append('text')
          .attr('x', cx)
          .attr('y', cy)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', `${EN_FS}px`)
          .attr('fill', ctx.helpers.enLabelColor(t))
          .text(label);
      }
    }

    function _capture2dDragState(event, atomIds = [], bondIds = []) {
      const [pX, pY] = ctx.d3.pointer(event.sourceEvent, ctx.g.node());
      const selectedDragAtomIds = ctx.helpers.getSelectedDragAtomIds(mol, atomIds, bondIds);
      const movedAtomIds = selectedDragAtomIds ? new Set(selectedDragAtomIds) : new Set(atomIds);
      if (!selectedDragAtomIds) {
        for (const bondId of bondIds) {
          const bond = mol.bonds.get(bondId);
          if (!bond) {continue;}
          movedAtomIds.add(bond.atoms[0]);
          movedAtomIds.add(bond.atoms[1]);
        }
      }

      const atomPositions = new Map();
      for (const atomId of movedAtomIds) {
        const movedAtom = mol.atoms.get(atomId);
        if (!movedAtom || movedAtom.x == null) {continue;}
        atomPositions.set(atomId, { x: movedAtom.x, y: movedAtom.y });
      }
      return {
        pX,
        pY,
        atomPositions,
        movedAtomIds: new Set(atomPositions.keys())
      };
    }

    function _redraw2dDragTargets(movedAtomIds) {
      lonePairDotsByAtomId.clear();
      for (const atomId of movedAtomIds) {
        const movedAtom = mol.atoms.get(atomId);
        if (!movedAtom || movedAtom.x == null) {continue;}
        const np = toSVGPt(movedAtom);
        labelLayer.select(`[data-atom-id="${atomId}"]`).attr('transform', `translate(${np.x},${np.y})`);
        const lbl = getAtomLabel(movedAtom, hCounts, toSVGPt, mol);
        const hw = labelHalfW(lbl, fontSize);
        const hh = labelHalfH(lbl, fontSize);
        const dxLabel = labelTextOffset(lbl, fontSize);
        bgLayer
          .select(`[data-atom-id="${atomId}"]`)
          .attr('x', np.x + dxLabel - hw)
          .attr('y', np.y - hh);
      }

      for (const bInfo of bondInfos) {
        if (!movedAtomIds.has(bInfo.a1.id) && !movedAtomIds.has(bInfo.a2.id)) {continue;}
        const bGroup = bondLayer.select(`[data-bond-id="${bInfo.bond.id}"]`);
        const hitLine = bGroup.select('.bond-hit');
        bGroup.selectAll(':not(.bond-hit)').remove();
        const st = stereoMap ? stereoMap.get(bInfo.bond.id) : null;
        let ssa1 = bInfo.a1;
        let ssa2 = bInfo.a2;
        if (st) {
          const centerId = stereoBondCenterIdForRender(mol, bInfo.bond.id);
          if (centerId === ssa2.id) {[ssa1, ssa2] = [ssa2, ssa1];}
        }
        ctx.helpers.drawBond(bGroup, bInfo.bond, ssa1, ssa2, mol, toSVGPt, st ?? null);
        const hp1 = toSVGPt(ssa1);
        const hp2 = toSVGPt(ssa2);
        hitLine.attr('x1', hp1.x).attr('y1', hp1.y).attr('x2', hp2.x).attr('y2', hp2.y).raise();
      }

      ctx.helpers.redrawHighlights();
      ctx.helpers.redrawSelection();
      _redraw2dValenceWarnings();
      _draw2dLonePairs();
      _redraw2dBondEnOverlay();
    }

    function _redraw2dValenceWarnings() {
      ctx.g.select('g.valence-warning-layer').remove();
      const warningAtoms = atoms.filter(atom => valenceWarningMap.has(atom.id));
      if (warningAtoms.length === 0) {return;}
      const warningLayer = ctx.g.append('g').attr('class', 'valence-warning-layer').style('pointer-events', 'none');
      for (const atom of warningAtoms) {
        const { x, y } = toSVGPt(atom);
        const r = Math.max(labelHalfW(getAtomLabel(atom, hCounts, toSVGPt, mol) || atom.name, fontSize), 10) + 7;
        warningLayer
          .append('circle')
          .attr('class', 'valence-warning')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', r)
          .attr('fill', ctx.constants.valenceWarningFill)
          .attr('stroke', 'none');
      }
    }

    ctx.helpers.redrawHighlights();
    ctx.helpers.redrawSelection();
    _redraw2dValenceWarnings();

    bondLayer = ctx.g.append('g').attr('class', 'bonds');
    for (const bi of bondInfos) {
      const bg = bondLayer.append('g').attr('data-bond-id', bi.bond.id);
      const stereoType = stereoMap ? stereoMap.get(bi.bond.id) : null;
      let sa1 = bi.a1;
      let sa2 = bi.a2;
      if (stereoType) {
        const centerId = stereoBondCenterIdForRender(mol, bi.bond.id);
        if (centerId === sa2.id) {[sa1, sa2] = [sa2, sa1];}
      }
      ctx.helpers.drawBond(bg, bi.bond, sa1, sa2, mol, toSVGPt, stereoType ?? null);

      const p1 = toSVGPt(sa1);
      const p2 = toSVGPt(sa2);
      bg.append('line')
        .attr('class', 'bond-hit')
        .attr('x1', p1.x)
        .attr('y1', p1.y)
        .attr('x2', p2.x)
        .attr('y2', p2.y)
        .attr('stroke', '#000')
        .attr('stroke-opacity', 0)
        .attr(
          'stroke-width',
          (() => {
            const order = renderBondOrder(bi.bond);
            return order >= 3 ? 24 : order >= 1.5 ? 18 : 12;
          })()
        )
        .style('pointer-events', 'stroke')
        .on('mousedown', event => {
          if (!ctx.overlay.getDrawBondMode()) {return;}
          event.preventDefault();
          event.stopPropagation();
          ctx.actions.promoteBondOrder(bi.bond.id);
        })
        .on('click', event => {
          ctx.events.handle2dBondClick(event, bi.bond.id);
        })
        .on('dblclick', event => {
          ctx.events.handle2dBondDblClick(event, bi.bond.atoms);
        })
        .on('mouseover', event => {
          ctx.events.handle2dBondMouseOver(event, bi.bond, sa1, sa2);
        })
        .on('mousemove', event => ctx.events.handle2dBondMouseMove(event))
        .on('mouseout', () => {
          ctx.events.handle2dBondMouseOut();
        })
        .style('cursor', 'grab')
        .call(
          ctx.drag.create2dBondDrag(mol, bi.bond.id, {
            captureDragState: (event, _molecule, atomIds = [], bondIds = []) => _capture2dDragState(event, atomIds, bondIds),
            redrawDragTargets: (_molecule, movedAtomIds) => _redraw2dDragTargets(movedAtomIds),
            pointer: sourceEvent => ctx.d3.pointer(sourceEvent, ctx.g.node()),
            scale: ctx.constants.scale,
            draw: () => draw2d()
          })
        );
    }

    ctx.helpers.drawReactionPreviewArrow2d(toSVGPt, atoms);

    bgLayer = ctx.g.append('g').attr('class', 'atom-bgs');
    for (const atom of atoms) {
      const label = getAtomLabel(atom, hCounts, toSVGPt, mol);
      const hw = labelHalfW(label, fontSize);
      if (hw === 0) {continue;}
      const hh = labelHalfH(label, fontSize);
      const dx = labelTextOffset(label, fontSize);
      const { x, y } = toSVGPt(atom);
      bgLayer
        .append('rect')
        .attr('class', 'atom-bg')
        .attr('data-atom-id', atom.id)
        .attr('x', x + dx - hw)
        .attr('y', y - hh)
        .attr('width', hw * 2)
        .attr('height', hh * 2)
        .attr('rx', 2);
    }

    labelLayer = ctx.g.append('g').attr('class', 'atom-labels');
    for (const atom of atoms) {
      const { x, y } = toSVGPt(atom);
      const symbol = atom.name;
      const charge = atom.getCharge();
      const label = getAtomLabel(atom, hCounts, toSVGPt, mol);
      const labelDx = labelTextOffset(label, fontSize);

      const hitGroup = labelLayer.append('g').attr('data-atom-id', atom.id).attr('transform', `translate(${x},${y})`);

      hitGroup
        .append('circle')
        .attr('class', 'atom-hit')
        .attr('r', Math.max(labelHalfW(label || symbol, fontSize), 10) + (ctx.overlay.getDrawBondMode() ? DRAW_MODE_ATOM_HIT_PAD : 0))
        .style('cursor', 'grab')
        .on('mousedown.drawbond', (event) => {
          ctx.events.handle2dAtomMouseDownDrawBond(event, atom.id);
        })
        .on('click', event => {
          ctx.events.handle2dAtomClick(event, atom.id);
        })
        .on('dblclick', event => {
          ctx.events.handle2dAtomDblClick(event, atom.id);
        })
        .on('mouseover', event => {
          ctx.events.handle2dAtomMouseOver(event, atom, mol, valenceWarningMap.get(atom.id) ?? null);
        })
        .on('mousemove', event => ctx.events.handle2dAtomMouseMove(event))
        .on('mouseout', () => {
          ctx.events.handle2dAtomMouseOut(atom.id);
        });

      if (label) {
        renderAtomLabel(hitGroup, label, symbol === 'H' ? '#333333' : atomColor(symbol, '2d'), labelDx, fontSize);
        if (charge !== 0) {
          const sign = formatChargeLabel(charge);
          const lonePairDots = _get2dLonePairDots(atom, label);
          const placement = computeChargeBadgePlacement(atom, mol, {
            pointForAtom: toSVGPt,
            label,
            fontSize,
            chargeLabel: sign,
            extraOccupiedAngles: lonePairDots.map(dot => Math.atan2(dot.y - y, dot.x - x)).filter(Number.isFinite)
          });
          if (placement) {
            hitGroup
              .append('circle')
              .attr('class', 'atom-charge-ring')
              .attr('cx', placement.x - x)
              .attr('cy', placement.y - y)
              .attr('r', placement.radius)
              .attr('pointer-events', 'none')
              .attr('fill', 'white')
              .attr('stroke', '#111')
              .attr('stroke-width', 0.9);
            hitGroup
              .append('text')
              .attr('class', 'atom-charge-text')
              .attr('x', placement.x - x)
              .attr('y', placement.y - y)
              .style('font-size', `${placement.fontSize}px`)
              .attr('pointer-events', 'none')
              .attr('fill', '#111')
              .attr('text-anchor', 'middle')
              .attr('dominant-baseline', 'central')
              .text(sign);
          }
        }
      }

      hitGroup.call(
        ctx.drag.create2dAtomDrag(mol, atom.id, {
          captureDragState: (event, _molecule, atomIds = [], bondIds = []) => _capture2dDragState(event, atomIds, bondIds),
          redrawDragTargets: (_molecule, movedAtomIds) => _redraw2dDragTargets(movedAtomIds),
          pointer: sourceEvent => ctx.d3.pointer(sourceEvent, ctx.g.node()),
          scale: ctx.constants.scale,
          draw: () => draw2d(),
          setDraggingCursor: () => {
            hitGroup.select('circle').style('cursor', 'grabbing');
          },
          resetCursor: () => {
            hitGroup.select('circle').style('cursor', 'grab');
          }
        })
      );
    }

    if (showLonePairs) {
      lonePairLayer = ctx.g.append('g').attr('class', 'lone-pairs').style('pointer-events', 'none');
      _draw2dLonePairs();
    }

    _redraw2dBondEnOverlay();
  }

  function render2d(mol, options = {}) {
    const { recomputeResonance = true, refreshResonancePanel = true, preserveGeometry = false, preserveAnalysis = false } = options;

    const hCounts = new Map();
    for (const [, atom] of mol.atoms) {
      if (atom.name === 'H') {
        continue;
      }
      const count = atom.getNeighbors(mol).filter(n => n.name === 'H').length;
      if (count > 0) {
        hCounts.set(atom.id, count);
      }
    }
    mol.hideHydrogens();
    prepareAromaticBondRendering(mol);

    if (!preserveGeometry) {
      ctx.helpers.generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    }
    ctx.helpers.alignReaction2dProductOrientation(mol);
    ctx.helpers.spreadReaction2dProductComponents(mol, 1.5);
    ctx.helpers.centerReaction2dPairCoords(mol, 1.5);

    for (const [, atom] of mol.atoms) {
      if (atom.name !== 'H' || atom.visible !== false) {continue;}
      const nbrs = atom.getNeighbors(mol);
      if (nbrs.length !== 1) {continue;}
      const parent = nbrs[0];
      if (!parent.getChirality()) {continue;}
      const others = parent.getNeighbors(mol).filter(n => n.id !== atom.id);
      let sumX = 0;
      let sumY = 0;
      let cnt = 0;
      for (const nb of others) {
        if (nb.x != null) {
          sumX += nb.x - parent.x;
          sumY += nb.y - parent.y;
          cnt++;
        }
      }
      const angle = cnt > 0 ? Math.atan2(-sumY, -sumX) : 0;
      const hLen = 1.5 * 0.75;
      atom.x = parent.x + Math.cos(angle) * hLen;
      atom.y = parent.y + Math.sin(angle) * hLen;
    }

    const { rotationDeg, flipH, flipV } = ctx.view.getOrientation();
    if (rotationDeg !== 0 || flipH || flipV) {
      const allAtoms = [...mol.atoms.values()].filter(a => a.x != null);
      let mx = 0;
      let my = 0;
      for (const a of allAtoms) {
        mx += a.x;
        my += a.y;
      }
      mx /= allAtoms.length;
      my /= allAtoms.length;
      if (rotationDeg !== 0) {
        const rad = (rotationDeg * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        for (const a of allAtoms) {
          const dx = a.x - mx;
          const dy = a.y - my;
          a.x = mx + dx * cosR - dy * sinR;
          a.y = my + dx * sinR + dy * cosR;
        }
      }
      if (flipH) {
        for (const a of allAtoms) {a.x = 2 * mx - a.x;}
      }
      if (flipV) {
        for (const a of allAtoms) {a.y = 2 * my - a.y;}
      }
    }

    const atoms = [...mol.atoms.values()].filter(a => a.x != null && a.visible !== false);
    if (atoms.length === 0) {return;}

    const { cx, cy } = atomBBox(atoms);
    ctx.svg.call(ctx.zoom.transform, _compute2dFitTransform(ctx, atoms));

    const stereoMap = syncDisplayStereo(mol);
    for (const [bondId] of stereoMap) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {continue;}
      const [ba1, ba2] = bond.getAtomObjects(mol);
      const hAtom = ba1?.visible === false ? ba1 : ba2?.visible === false ? ba2 : null;
      const heavyAt = hAtom ? (hAtom === ba1 ? ba2 : ba1) : null;
      if (!heavyAt) {continue;}
      const n = (hCounts.get(heavyAt.id) ?? 0) - 1;
      if (n <= 0) {hCounts.delete(heavyAt.id);}
      else {hCounts.set(heavyAt.id, n);}
    }

    ctx.state.setScene({ mol, hCounts, cx, cy, stereoMap });
    if (ctx.state.getPreserveSelectionOnNextRender()) {
      ctx.selection.syncSelectionToMolecule(mol);
    } else {
      ctx.selection.clearSelection();
    }
    ctx.state.setPreserveSelectionOnNextRender(false);

    draw2d();

    if (!preserveAnalysis) {
      ctx.analysis.updateFormula(mol);
      ctx.analysis.updateDescriptors(mol);
      ctx.analysis.updatePanels(mol, { recomputeResonance, refreshResonancePanel });
    }
  }

  function fitCurrent2dView() {
    const mol = ctx.state.getMol();
    if (!mol) {return;}
    const atoms = [...mol.atoms.values()].filter(a => a.x != null && a.visible !== false);
    if (atoms.length === 0) {return;}
    const { cx, cy } = atomBBox(atoms);
    ctx.state.setCenter(cx, cy);
    ctx.svg.call(ctx.zoom.transform, _compute2dFitTransform(ctx, atoms));
  }

  return {
    draw2d,
    render2d,
    fitCurrent2dView
  };
}
