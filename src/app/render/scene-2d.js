/** @module app/render/scene-2d */

import { getRenderOptions, atomColor, renderAtomLabel, renderLonePairDots, renderBondOrder, prepareAromaticBondRendering } from './helpers.js';
import { getBondEnOverlayData } from './bond-en-overlay.js';
import { buildBondOverlayBlockerSegments, defaultBondOverlayBaseOffset, pickHydrogenBondOverlayPlacement, pickBondOverlayLabelPlacement } from './bond-overlay-placement.js';
import { getBondLengthsOverlayData } from './bond-lengths-overlay.js';
import { getAtomNumberMap, multipleBondSideBlockerAngle, pickAtomAnnotationPlacement } from './atom-numbering.js';
import {
  labelHalfW,
  labelHalfH,
  labelTextOffset,
  ringLabelOffset,
  formatChargeLabel,
  computeChargeBadgePlacement,
  getAtomLabel,
  computeLonePairDotPositions,
  syncDisplayStereo,
  stereoBondCenterIdForRender,
  atomBBox
} from '../../layout/mol2d-helpers.js';
import {
  DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE,
  synthesizeHydrogenPosition
} from '../../layout/engine/stereo/wedge-geometry.js';

/**
 * Returns the placed incident ring polygons for one atom.
 * @param {object} molecule - Molecule graph.
 * @param {string} atomId - Atom id.
 * @returns {Array<Array<{x: number, y: number}>>} Incident ring polygons.
 */
function incidentRingPolygonsForAtom(molecule, atomId) {
  return molecule
    .getRings()
    .filter(ringAtomIds => ringAtomIds.includes(atomId))
    .map(ringAtomIds =>
      ringAtomIds
        .map(ringAtomId => molecule.atoms.get(ringAtomId))
        .filter(atom => atom && atom.x != null && atom.y != null)
        .map(atom => ({ x: atom.x, y: atom.y }))
    )
    .filter(polygon => polygon.length >= 3);
}

/**
 * Projects hidden stereo hydrogens into drawable positions around their chiral parent atoms.
 * @param {object} molecule - Molecule graph.
 * @param {number} bondLength - Reference hidden-hydrogen bond length.
 * @param {Map<string, string>|null} stereoMap - Current display stereo map.
 * @returns {Map<string, {x: number, y: number}>} Projected hidden-hydrogen coordinates keyed by atom id.
 */
function projectHiddenStereoHydrogens(molecule, bondLength, stereoMap = null) {
  const projectedCoords = new Map();
  for (const [, atom] of molecule.atoms) {
    if (atom.name !== 'H') {
      continue;
    }
    const neighbors = atom.getNeighbors(molecule);
    if (neighbors.length !== 1) {
      continue;
    }
    const parent = neighbors[0];
    if (!parent.getChirality()) {
      continue;
    }
    const bond = molecule.getBond(atom.id, parent.id);
    const hasCoincidentCoords =
      atom.x != null && atom.y != null && parent.x != null && parent.y != null && Math.abs(atom.x - parent.x) <= 1e-6 && Math.abs(atom.y - parent.y) <= 1e-6;
    const hasDisplayedStereo = !!bond && ((stereoMap && stereoMap.has(bond.id)) || bond.properties?.display?.as);
    const shouldProject = atom.visible === false || (hasDisplayedStereo && hasCoincidentCoords);
    if (!shouldProject) {
      continue;
    }
    const knownPositions = parent
      .getNeighbors(molecule)
      .filter(neighbor => neighbor.id !== atom.id && neighbor.x != null && neighbor.y != null)
      .map(neighbor => ({ x: neighbor.x, y: neighbor.y }));
    const projectedPosition = synthesizeHydrogenPosition({ x: parent.x, y: parent.y }, knownPositions, bondLength, {
      incidentRingPolygons: incidentRingPolygonsForAtom(molecule, parent.id),
      preferCardinalAxes: true,
      fixedRadius: true,
      cardinalAxisSectorTolerance: hasDisplayedStereo ? DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE : undefined
    });
    projectedCoords.set(atom.id, projectedPosition);
  }
  return projectedCoords;
}

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

/**
 * Returns the coordinate set that should drive 2D viewport fitting.
 * Visible explicit stereo hydrogens are fit against their projected render
 * positions so coincident helper coordinates cannot leave them off-screen.
 * @param {object} molecule - Molecule currently shown in 2D.
 * @param {Map<string, {x: number, y: number}>} projectedCoords - Projected stereo-hydrogen positions.
 * @returns {Array<{x: number, y: number}>} Coordinate points to include in the fit box.
 */
function fitPointsFor2dView(molecule, projectedCoords = new Map()) {
  const points = [];
  for (const atom of molecule?.atoms?.values?.() ?? []) {
    if (atom?.visible === false) {
      continue;
    }
    const projectedPosition = projectedCoords.get(atom.id);
    if (projectedPosition) {
      points.push(projectedPosition);
      continue;
    }
    if (atom?.x == null || atom?.y == null) {
      continue;
    }
    points.push(atom);
  }
  return points;
}

/**
 * Creates the 2D scene renderer, providing `draw2d`, `render2d`, `fitCurrent2dView`, and a projected-aware `toSVGPt` helper for the active SVG canvas.
 * @param {object} ctx - Context providing `state`, `helpers`, `constants`, `view`, `overlay`, `drag`, `events`, `zoom`, `svg`, `g`, `d3`, `cache`, `selection`, and `analysis`.
 * @returns {object} Object with `draw2d`, `render2d`, `fitCurrent2dView`, and `toSVGPt` functions.
 */
export function create2DSceneRenderer(ctx) {
  const DRAW_MODE_ATOM_HIT_PAD = 6;
  let projectedHiddenStereoCoords = new Map();
  const HIDDEN_STEREO_BOND_LENGTH = 1.5 * 0.75;

  function shouldUseProjectedStereoHydrogenPosition(atom, molecule = ctx.state.getMol(), stereoMap = ctx.state.getStereoMap()) {
    if (!atom || atom.name !== 'H' || !molecule) {
      return false;
    }
    const projectedPosition = projectedHiddenStereoCoords.get(atom.id);
    if (!projectedPosition) {
      return false;
    }
    const [parent] = atom.getNeighbors(molecule);
    if (!parent) {
      return false;
    }
    const bond = molecule.getBond(atom.id, parent.id);
    const hasCoincidentCoords =
      atom.x != null && atom.y != null && parent.x != null && parent.y != null && Math.abs(atom.x - parent.x) <= 1e-6 && Math.abs(atom.y - parent.y) <= 1e-6;
    return atom.visible === false || (!!bond && ((stereoMap && stereoMap.has(bond.id)) || bond.properties?.display?.as) && hasCoincidentCoords);
  }

  /**
   * Seeds projected visible stereo hydrogens onto real 2D coordinates before a
   * manual drag starts so neighboring edits cannot silently reproject them.
   * Hidden stereochemical hydrogens stay virtual and continue to render from
   * their parent atoms until they are explicitly shown.
   * @param {object|null} [molecule] - Molecule containing the stereo hydrogens.
   * @param {Map<string, string>|null} [stereoMap] - Current display stereo map.
   * @returns {Set<string>} Atom ids whose real coordinates were materialized.
   */
  function materializeProjectedVisibleStereoHydrogens(molecule = ctx.state.getMol(), stereoMap = ctx.state.getStereoMap()) {
    const materializedAtomIds = new Set();
    if (!molecule) {
      return materializedAtomIds;
    }
    for (const [atomId, projectedPosition] of projectedHiddenStereoCoords) {
      const atom = molecule.atoms.get(atomId);
      if (!atom || atom.visible === false) {
        continue;
      }
      if (!shouldUseProjectedStereoHydrogenPosition(atom, molecule, stereoMap)) {
        continue;
      }
      atom.x = projectedPosition.x;
      atom.y = projectedPosition.y;
      materializedAtomIds.add(atomId);
    }
    return materializedAtomIds;
  }

  /**
   * Converts an atom to its current 2D SVG point, honoring projected stereo-hydrogen positions when active.
   * @param {object} atom - Atom whose current rendered point should be returned.
   * @param {object|null} [molecule] - Molecule containing the atom.
   * @param {Map<string, string>|null} [stereoMap] - Current display stereo map.
   * @returns {{x: number, y: number}} Current rendered SVG point for the atom.
   */
  function toSVGPt(atom, molecule = ctx.state.getMol(), stereoMap = ctx.state.getStereoMap()) {
    const projectedPosition = shouldUseProjectedStereoHydrogenPosition(atom, molecule, stereoMap) ? projectedHiddenStereoCoords.get(atom.id) : null;
    if (projectedPosition) {
      return ctx.helpers.toSVGPt(projectedPosition);
    }
    if (atom.x != null && atom.y != null) {
      return ctx.helpers.toSVGPt(atom);
    }
    if (atom.name === 'H' && atom.visible === false && molecule) {
      const [parent] = atom.getNeighbors(molecule);
      if (parent?.x != null && parent?.y != null) {
        return ctx.helpers.toSVGPt(parent);
      }
    }
    return ctx.helpers.toSVGPt(atom);
  }

  function draw2d() {
    const mol = ctx.state.getMol();
    if (!mol) {
      return;
    }
    const stereoMap = ctx.state.getStereoMap();
    projectedHiddenStereoCoords = projectHiddenStereoHydrogens(mol, HIDDEN_STEREO_BOND_LENGTH, stereoMap);
    const hCounts = ctx.state.getHCounts();
    const { showLonePairs } = getRenderOptions();
    const fontSize = ctx.constants.getFontSize();
    const valenceWarningMap = ctx.helpers.valenceWarningMapFor(mol);
    ctx.state.setActiveValenceWarningMap(valenceWarningMap);

    const atoms = [...mol.atoms.values()].filter(a => a.x != null && a.visible !== false);
    const bondInfos = [];
    for (const bond of mol.bonds.values()) {
      const [a1, a2] = bond.getAtomObjects(mol);
      const firstPosition = a1
        ? (projectedHiddenStereoCoords.get(a1.id) ?? (a1.x != null && a1.y != null ? a1 : a1.name === 'H' && a1.visible === false ? (a1.getNeighbors(mol)[0] ?? null) : null))
        : null;
      const secondPosition = a2
        ? (projectedHiddenStereoCoords.get(a2.id) ?? (a2.x != null && a2.y != null ? a2 : a2.name === 'H' && a2.visible === false ? (a2.getNeighbors(mol)[0] ?? null) : null))
        : null;
      if (!firstPosition || !secondPosition) {
        continue;
      }
      const isHBond = a1.visible === false || a2.visible === false;
      if (isHBond && !(stereoMap && stereoMap.has(bond.id))) {
        continue;
      }
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

    function _pick2dHydrogenBondOverlayPlacement(atomA, atomB, label, overlayFontSize, placedBoxes) {
      const hydrogenAtom = atomA?.name === 'H' || atomA?.name === 'D' ? atomA : atomB?.name === 'H' || atomB?.name === 'D' ? atomB : null;
      if (!hydrogenAtom) {
        return null;
      }
      const otherAtom = hydrogenAtom === atomA ? atomB : atomA;
      if (!otherAtom) {
        return null;
      }
      const hydrogenPoint = toSVGPt(hydrogenAtom);
      const otherPoint = toSVGPt(otherAtom);
      const hydrogenLabel = getAtomLabel(hydrogenAtom, hCounts, toSVGPt, mol) ?? hydrogenAtom.name;
      const hydrogenRadius = Math.max(labelHalfW(hydrogenLabel, overlayFontSize) + 2, labelHalfH(hydrogenLabel, overlayFontSize) + 2);
      return pickHydrogenBondOverlayPlacement({
        hydrogenPoint,
        otherPoint,
        label,
        fontSize: overlayFontSize,
        hydrogenRadius,
        placedBoxes
      });
    }

    function _redraw2dBondEnOverlay() {
      ctx.g.select('g.bond-en-overlay').remove();
      const overlayData = getBondEnOverlayData(mol);
      if (!overlayData) {
        return;
      }
      const enLayer = ctx.g.append('g').attr('class', 'bond-en-overlay').style('pointer-events', 'none');
      const bondInfoMap = new Map(bondInfos.map(bi => [bi.bond.id, bi]));
      const EN_FS = getRenderOptions().bondEnFontSize;
      const bondOffset = ctx.constants.bondOffset2d ?? 7;
      const wedgeHalfWidth = ctx.constants.wedgeHalfWidth ?? 6;
      const wedgeDashes = ctx.constants.wedgeDashes ?? 6;
      const blockerSegments = bondInfos.flatMap(bi => {
        const stereoType = (stereoMap ? stereoMap.get(bi.bond.id) : null) ?? bi.bond.properties?.display?.as ?? null;
        const start = toSVGPt(bi.a1);
        const end = toSVGPt(bi.a2);
        const preferredSide = renderBondOrder(bi.bond) === 2 || renderBondOrder(bi.bond) === 1.5 ? ctx.helpers.secondaryDir(bi.a1, bi.a2, mol, toSVGPt) : 1;
        return buildBondOverlayBlockerSegments({
          start,
          end,
          bond: bi.bond,
          stereoType,
          preferredSide,
          bondOffset,
          wedgeHalfWidth,
          wedgeDashes
        });
      });
      const placed = [];
      for (const atom of atoms) {
        const label = getAtomLabel(atom, hCounts, toSVGPt, mol);
        if (!label) {
          continue;
        }
        const { x, y } = toSVGPt(atom);
        placed.push({ cx: x, cy: y, hw: labelHalfW(label, fontSize) + 4, hh: fontSize * 0.7 });
      }
      for (const { bondId, label, t } of overlayData) {
        const bi = bondInfoMap.get(bondId);
        if (!bi) {
          continue;
        }
        const p1 = toSVGPt(bi.a1);
        const p2 = toSVGPt(bi.a2);
        const stereoType = (stereoMap ? stereoMap.get(bi.bond.id) : null) ?? bi.bond.properties?.display?.as ?? null;
        const pref = renderBondOrder(bi.bond) >= 2 || renderBondOrder(bi.bond) === 1.5 ? -ctx.helpers.secondaryDir(bi.a1, bi.a2, mol, toSVGPt) : 1;
        const placement =
          _pick2dHydrogenBondOverlayPlacement(bi.a1, bi.a2, label, EN_FS, placed) ??
          pickBondOverlayLabelPlacement({
            start: p1,
            end: p2,
            label,
            fontSize: EN_FS,
            preferredSide: pref,
            placedBoxes: placed,
            blockerSegments,
            baseOffset: defaultBondOverlayBaseOffset({
              bond: bi.bond,
              stereoType,
              fontSize: EN_FS,
              bondOffset,
              wedgeHalfWidth
            })
          });
        const { cx, cy } = placement;
        placed.push(placement);
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

    function _redraw2dBondLengthsOverlay() {
      ctx.g.select('g.bond-lengths-overlay').remove();
      const overlayData = getBondLengthsOverlayData(mol);
      if (!overlayData) {
        return;
      }
      const blLayer = ctx.g.append('g').attr('class', 'bond-lengths-overlay').style('pointer-events', 'none');
      const bondInfoMap = new Map(bondInfos.map(bi => [bi.bond.id, bi]));
      const BL_FS = getRenderOptions().bondLengthFontSize;
      const bondOffset = ctx.constants.bondOffset2d ?? 7;
      const wedgeHalfWidth = ctx.constants.wedgeHalfWidth ?? 6;
      const wedgeDashes = ctx.constants.wedgeDashes ?? 6;
      const blockerSegments = bondInfos.flatMap(bi => {
        const stereoType = (stereoMap ? stereoMap.get(bi.bond.id) : null) ?? bi.bond.properties?.display?.as ?? null;
        const start = toSVGPt(bi.a1);
        const end = toSVGPt(bi.a2);
        const preferredSide = renderBondOrder(bi.bond) === 2 || renderBondOrder(bi.bond) === 1.5 ? ctx.helpers.secondaryDir(bi.a1, bi.a2, mol, toSVGPt) : 1;
        return buildBondOverlayBlockerSegments({
          start,
          end,
          bond: bi.bond,
          stereoType,
          preferredSide,
          bondOffset,
          wedgeHalfWidth,
          wedgeDashes
        });
      });

      // Pre-seed placed boxes with visible atom labels so the label avoids them.
      const placed = [];
      for (const atom of atoms) {
        const label = getAtomLabel(atom, hCounts, toSVGPt, mol);
        if (!label) {
          continue;
        }
        const { x, y } = toSVGPt(atom);
        placed.push({ cx: x, cy: y, hw: labelHalfW(label, fontSize) + 4, hh: fontSize * 0.7 });
      }

      for (const { bondId, label } of overlayData) {
        const bi = bondInfoMap.get(bondId);
        if (!bi) {
          continue;
        }
        const p1 = toSVGPt(bi.a1);
        const p2 = toSVGPt(bi.a2);
        const stereoType = (stereoMap ? stereoMap.get(bi.bond.id) : null) ?? bi.bond.properties?.display?.as ?? null;
        const pref = -ctx.helpers.secondaryDir(bi.a1, bi.a2, mol, toSVGPt);
        const placement =
          _pick2dHydrogenBondOverlayPlacement(bi.a1, bi.a2, label, BL_FS, placed) ??
          pickBondOverlayLabelPlacement({
            start: p1,
            end: p2,
            label,
            fontSize: BL_FS,
            preferredSide: pref,
            placedBoxes: placed,
            blockerSegments,
            baseOffset: defaultBondOverlayBaseOffset({
              bond: bi.bond,
              stereoType,
              fontSize: BL_FS,
              bondOffset,
              wedgeHalfWidth
            })
          });
        const { cx, cy } = placement;
        placed.push(placement);
        blLayer
          .append('text')
          .attr('x', cx)
          .attr('y', cy)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', `${BL_FS}px`)
          .attr('fill', '#000')
          .text(label);
      }
    }

    function _capture2dDragState(event, atomIds = [], bondIds = []) {
      materializeProjectedVisibleStereoHydrogens(mol, stereoMap);
      const [pX, pY] = ctx.d3.pointer(event.sourceEvent, ctx.g.node());
      const selectedDragAtomIds = ctx.helpers.getSelectedDragAtomIds(mol, atomIds, bondIds);
      const movedAtomIds = selectedDragAtomIds ? new Set(selectedDragAtomIds) : new Set(atomIds);
      if (!selectedDragAtomIds) {
        for (const bondId of bondIds) {
          const bond = mol.bonds.get(bondId);
          if (!bond) {
            continue;
          }
          movedAtomIds.add(bond.atoms[0]);
          movedAtomIds.add(bond.atoms[1]);
        }
      }

      const atomPositions = new Map();
      for (const atomId of movedAtomIds) {
        const movedAtom = mol.atoms.get(atomId);
        if (!movedAtom || movedAtom.x == null) {
          continue;
        }
        const projectedPosition = shouldUseProjectedStereoHydrogenPosition(movedAtom) ? projectedHiddenStereoCoords.get(atomId) : null;
        atomPositions.set(atomId, projectedPosition ? { x: projectedPosition.x, y: projectedPosition.y } : { x: movedAtom.x, y: movedAtom.y });
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
        if (!movedAtom || movedAtom.x == null) {
          continue;
        }
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
        if (!movedAtomIds.has(bInfo.a1.id) && !movedAtomIds.has(bInfo.a2.id)) {
          continue;
        }
        const bGroup = bondLayer.select(`[data-bond-id="${bInfo.bond.id}"]`);
        const hitLine = bGroup.select('.bond-hit');
        bGroup.selectAll(':not(.bond-hit)').remove();
        const st = (stereoMap ? stereoMap.get(bInfo.bond.id) : null) ?? bInfo.bond.properties?.display?.as ?? null;
        let ssa1 = bInfo.a1;
        let ssa2 = bInfo.a2;
        if (st) {
          const centerId = stereoBondCenterIdForRender(mol, bInfo.bond.id);
          if (centerId === ssa2.id) {
            [ssa1, ssa2] = [ssa2, ssa1];
          }
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
      _redraw2dBondLengthsOverlay();
      _redraw2dAtomNumberingOverlay();
    }

    function _redraw2dValenceWarnings() {
      ctx.g.select('g.valence-warning-layer').remove();
      const warningAtoms = atoms.filter(atom => valenceWarningMap.has(atom.id));
      if (warningAtoms.length === 0) {
        return;
      }
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

    function _bind2dAtomEvents(target, atom) {
      return target
        .on('mousedown.drawbond', event => {
          ctx.events.handle2dAtomMouseDownDrawBond(event, atom.id);
        })
        .on('click', event => {
          ctx.events.handle2dAtomClick(event, atom.id);
        })
        .on('contextmenu', event => {
          ctx.events.handle2dAtomContextMenu(event, atom);
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
    }

    ctx.helpers.redrawHighlights();
    ctx.helpers.redrawSelection();
    _redraw2dValenceWarnings();

    bondLayer = ctx.g.append('g').attr('class', 'bonds');
    for (const bi of bondInfos) {
      const bg = bondLayer.append('g').attr('data-bond-id', bi.bond.id);
      const stereoType = (stereoMap ? stereoMap.get(bi.bond.id) : null) ?? bi.bond.properties?.display?.as ?? null;
      let sa1 = bi.a1;
      let sa2 = bi.a2;
      if (stereoType) {
        const centerId = stereoBondCenterIdForRender(mol, bi.bond.id);
        if (centerId === sa2.id) {
          [sa1, sa2] = [sa2, sa1];
        }
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
          if (!ctx.overlay.getDrawBondMode()) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
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
      if (hw === 0) {
        continue;
      }
      const hh = labelHalfH(label, fontSize);
      const { dx, dy } = ringLabelOffset(atom, mol, toSVGPt, label, fontSize);
      const { x, y } = toSVGPt(atom);
      bgLayer
        .append('rect')
        .attr('class', 'atom-bg')
        .attr('data-atom-id', atom.id)
        .attr('x', x + dx - hw)
        .attr('y', y + dy - hh)
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
      const { dx: labelDx, dy: labelDy } = ringLabelOffset(atom, mol, toSVGPt, label, fontSize);

      const hitGroup = labelLayer.append('g').attr('data-atom-id', atom.id).attr('transform', `translate(${x},${y})`);

      const atomHit = hitGroup
        .append('circle')
        .attr('class', 'atom-hit')
        .attr('r', Math.max(labelHalfW(label || symbol, fontSize), 10) + (ctx.overlay.getDrawBondMode() ? DRAW_MODE_ATOM_HIT_PAD : 0))
        .style('cursor', 'grab');
      _bind2dAtomEvents(atomHit, atom);

      if (label) {
        renderAtomLabel(hitGroup, label, symbol === 'H' ? '#333333' : atomColor(symbol, '2d'), labelDx, labelDy, fontSize);
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

      atomHit.call(
        ctx.drag.create2dAtomDrag(mol, atom.id, {
          captureDragState: (event, _molecule, atomIds = [], bondIds = []) => _capture2dDragState(event, atomIds, bondIds),
          redrawDragTargets: (_molecule, movedAtomIds) => _redraw2dDragTargets(movedAtomIds),
          pointer: sourceEvent => ctx.d3.pointer(sourceEvent, ctx.g.node()),
          scale: ctx.constants.scale,
          draw: () => draw2d(),
          setDraggingCursor: () => {
            atomHit.style('cursor', 'grabbing');
          },
          resetCursor: () => {
            atomHit.style('cursor', 'grab');
          }
        })
      );
    }

    if (showLonePairs) {
      lonePairLayer = ctx.g.append('g').attr('class', 'lone-pairs').style('pointer-events', 'none');
      _draw2dLonePairs();
    }

    _redraw2dBondEnOverlay();
    _redraw2dBondLengthsOverlay();
    _redraw2dAtomNumberingOverlay();
  }

  function _redraw2dAtomNumberingOverlay() {
    ctx.g.select('g.atom-numbering-overlay').remove();
    const mol = ctx.state.getMol();
    if (!mol) {
      return;
    }
    const numberMap = getAtomNumberMap(mol);
    if (!numberMap) {
      return;
    }
    const { showLonePairs, atomNumberingFontSize } = getRenderOptions();
    const NUM_FS = atomNumberingFontSize;
    const fSize = ctx.constants.getFontSize();
    const hCounts = ctx.state.getHCounts();
    const atoms = [...mol.atoms.values()].filter(a => a.x != null && a.visible !== false);
    const numLayer = ctx.g.append('g').attr('class', 'atom-numbering-overlay').style('pointer-events', 'none');
    const placedBoxes = [];
    for (const atom of atoms) {
      const label = getAtomLabel(atom, hCounts, toSVGPt, mol);
      if (!label) {
        continue;
      }
      const { x, y } = toSVGPt(atom);
      const { dx, dy } = ringLabelOffset(atom, mol, toSVGPt, label, fSize);
      placedBoxes.push({
        cx: x + dx,
        cy: y + dy,
        hw: labelHalfW(label, fSize) + 4,
        hh: labelHalfH(label, fSize) + 2
      });
    }
    for (const atom of atoms) {
      const num = numberMap.get(atom.id);
      if (num == null) {
        continue;
      }
      const { x, y } = toSVGPt(atom);
      const label = String(num);
      // Blocked angles: ALL neighbors (including hidden H — avoids OH-label overlap),
      // plus charge badge direction and lone pair directions when relevant.
      const allNeighbors = atom.getNeighbors(mol).filter(n => n.x != null);
      const visNeighbors = allNeighbors.filter(n => n.visible !== false);
      const blockedSectors = allNeighbors.map(nb => {
        const { x: nx, y: ny } = toSVGPt(nb);
        const angle = Math.atan2(ny - y, nx - x);
        const order = renderBondOrder(mol.getBond(atom.id, nb.id));
        const spread = order >= 2 ? 0.52 : 0.4;
        return { angle, spread };
      });
      if (atom.getCharge?.() !== 0) {
        const placement = computeChargeBadgePlacement(atom, mol, {
          pointForAtom: toSVGPt,
          neighbors: visNeighbors,
          fontSize: fSize,
          containerChargeAngle: null
        });
        if (placement) {
          blockedSectors.push({ angle: placement.angle, spread: 0.3 });
        }
      }
      if (showLonePairs) {
        const lp = computeLonePairDotPositions(atom, mol, {
          pointForAtom: toSVGPt,
          label: null,
          fontSize: fSize,
          offsetFromBoundary: 6,
          dotSpacing: 4.2
        });
        for (const dot of lp) {
          blockedSectors.push({ angle: Math.atan2(dot.y - y, dot.x - x), spread: 0.26 });
        }
      }
      for (const nb of allNeighbors) {
        const bond = mol.getBond(atom.id, nb.id);
        const order = renderBondOrder(bond);
        if (order !== 2 && order !== 1.5) {
          continue;
        }
        const { x: nx, y: ny } = toSVGPt(nb);
        const dir = ctx.helpers.secondaryDir(atom, nb, mol, toSVGPt);
        const sideAngle = multipleBondSideBlockerAngle({ x, y }, { x: nx, y: ny }, dir);
        if (sideAngle != null) {
          blockedSectors.push({ angle: sideAngle, spread: 0.5 });
        }
      }
      const placement = pickAtomAnnotationPlacement({
        center: { x, y },
        label,
        fontSize: NUM_FS,
        blockedSectors,
        placedBoxes
      });
      placedBoxes.push(placement);
      numLayer
        .append('text')
        .attr('class', 'atom-num')
        .attr('data-atom-id', atom.id)
        .attr('x', placement.cx)
        .attr('y', placement.cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', `${NUM_FS}px`)
        .attr('fill', '#444')
        .text(label);
    }
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
      ctx.helpers.generate2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    }
    ctx.helpers.alignReaction2dProductOrientation(mol);
    ctx.helpers.spreadReaction2dProductComponents(mol, 1.5);
    ctx.helpers.centerReaction2dPairCoords(mol, 1.5);

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
        for (const a of allAtoms) {
          a.x = 2 * mx - a.x;
        }
      }
      if (flipV) {
        for (const a of allAtoms) {
          a.y = 2 * my - a.y;
        }
      }
    }

    const stereoMap = syncDisplayStereo(mol);
    for (const [bondId] of stereoMap) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const [ba1, ba2] = bond.getAtomObjects(mol);
      const hAtom = ba1?.visible === false && ba1.name === 'H' ? ba1 : ba2?.visible === false && ba2.name === 'H' ? ba2 : null;
      if (hAtom) {
        hAtom.visible = true;
        continue;
      }
      const heavyAt = ba1?.visible === false ? (ba2 ?? null) : ba2?.visible === false ? (ba1 ?? null) : null;
      if (!heavyAt) {
        continue;
      }
      const n = (hCounts.get(heavyAt.id) ?? 0) - 1;
      if (n <= 0) {
        hCounts.delete(heavyAt.id);
      } else {
        hCounts.set(heavyAt.id, n);
      }
    }

    const projectedFitCoords = projectHiddenStereoHydrogens(mol, HIDDEN_STEREO_BOND_LENGTH, stereoMap);
    const fitPoints = fitPointsFor2dView(mol, projectedFitCoords);
    if (fitPoints.length === 0) {
      return;
    }

    const { cx, cy } = atomBBox(fitPoints);
    ctx.svg.call(ctx.zoom.transform, _compute2dFitTransform(ctx, fitPoints));

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
    if (!mol) {
      return;
    }
    const stereoMap = ctx.state.getStereoMap();
    const projectedFitCoords = projectHiddenStereoHydrogens(mol, HIDDEN_STEREO_BOND_LENGTH, stereoMap);
    const fitPoints = fitPointsFor2dView(mol, projectedFitCoords);
    if (fitPoints.length === 0) {
      return;
    }
    const { cx, cy } = atomBBox(fitPoints);
    ctx.state.setCenter(cx, cy);
    ctx.svg.call(ctx.zoom.transform, _compute2dFitTransform(ctx, fitPoints));
  }

  return {
    draw2d,
    render2d,
    fitCurrent2dView,
    toSVGPt
  };
}
