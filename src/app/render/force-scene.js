/** @module app/render/force-scene */

import {
  getRenderOptions,
  atomDisplayColor,
  atomDisplayOpacity,
  bondDisplayColor,
  bondDisplayOpacity,
  strokeColor,
  singleBondWidth,
  prepareAromaticBondRendering,
  atomRadius,
  xOffset,
  yOffset,
  PI_STROKE,
  ARO_STROKE
} from './helpers.js';
import { formatChargeLabel, chargeBadgeMetrics, computeChargeBadgePlacement, computeLonePairDotPositions, heavyDegree, secondaryDir, syncDisplayStereo } from '../../layout/mol2d-helpers.js';
import { getBondEnOverlayData } from './bond-en-overlay.js';
import { buildBondOverlayBlockerSegments, defaultBondOverlayBaseOffset, pickHydrogenBondOverlayPlacement, pickBondOverlayLabelPlacement } from './bond-overlay-placement.js';
import { getBondLengthsOverlayData } from './bond-lengths-overlay.js';
import { getAtomNumberMap, multipleBondAnnotationBlockerAngles, pickAtomAnnotationPlacement } from './atom-numbering.js';
import { organometallicGeometryKind, organometallicProjectedDisplayAssignmentCount } from '../../layout/engine/families/organometallic-geometry.js';
import { ringAtomKey, ringFillDomId } from '../../core/style.js';
import { buildRingFillShape } from '../../layout/ring-fill-shape.js';
import { drawResonanceElectronFlow2d, resonanceArrowOccupiedAnglesForAtom } from './resonance-arrows.js';

const FORCE_STANDARD_UNLABELED_ATOMS = new Set(['C', 'H', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I']);

function forceLinkRenderOrder(link) {
  return link?.renderOrder ?? link?.order ?? 1;
}

/**
 * Returns whether a force-mode atom should keep its symbol visible even when
 * normal atom labels are hidden.
 * @param {object} node - Force graph node.
 * @returns {boolean} True when the atom is outside the common organic palette.
 */
function shouldAutoLabelForceAtom(node) {
  return typeof node?.name === 'string' && !FORCE_STANDARD_UNLABELED_ATOMS.has(node.name);
}

/**
 * Removes an automatically assigned display hint from a bond while preserving
 * any manual display choice.
 * @param {object} bond - Bond-like object whose display hint may be cleared.
 * @returns {void}
 */
function clearAutoDisplayStereo(bond) {
  if (!bond?.properties?.display || bond.properties.display.manual === true) {
    return;
  }
  delete bond.properties.display.as;
  delete bond.properties.display.centerId;
  delete bond.properties.display.manual;
  if (Object.keys(bond.properties.display).length === 0) {
    delete bond.properties.display;
  }
}

/**
 * Copies automatically generated display hints from a seeded clone back onto
 * the live force-mode molecule, clearing stale auto hints that disappeared.
 * @param {object} seededMolecule - Clone populated with fresh display hints.
 * @param {object} molecule - Live molecule shown in force mode.
 * @returns {void}
 */
function copyAutoDisplayStereoFromSeed(seededMolecule, molecule) {
  for (const [bondId, seededBond] of seededMolecule.bonds) {
    const realBond = molecule.bonds.get(bondId);
    if (!realBond || realBond.properties.display?.manual === true) {
      continue;
    }
    if (seededBond.properties.display?.as) {
      realBond.properties.display = { ...seededBond.properties.display };
      continue;
    }
    clearAutoDisplayStereo(realBond);
  }
}

/**
 * Returns whether a bond-like object should count as a coordination ligand
 * for force-mode projected organometallic seeding.
 * @param {object} bond - Bond-like object to inspect.
 * @returns {boolean} True when the bond kind resolves to a supported ligand link.
 */
function isCoordinationBondLike(bond) {
  if (!bond || typeof bond !== 'object') {
    return false;
  }
  const kind = typeof bond.getKind === 'function' ? bond.getKind() : (bond.kind ?? bond.properties?.kind ?? 'covalent');
  return kind === 'covalent' || kind === 'coordinate';
}

/**
 * Returns whether the molecule contains a transition-metal center whose
 * coordination count could produce projected wedge/dash display hints.
 * @param {object} molecule - Molecule-like graph to inspect.
 * @returns {boolean} True when a projected organometallic seed is worthwhile.
 */
function hasProjectedOrganometallicDisplayCandidate(molecule) {
  for (const atom of molecule?.atoms?.values?.() ?? []) {
    const group = atom?.properties?.group ?? 0;
    if (group < 3 || group > 12) {
      continue;
    }
    let coordinationBondCount = 0;
    for (const bondId of atom.bonds ?? []) {
      const bond = molecule.bonds.get(bondId);
      if (isCoordinationBondLike(bond)) {
        coordinationBondCount++;
      }
    }
    if (expectedProjectedDisplayAssignmentCount(atom, coordinationBondCount) > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Counts renderer-facing wedge/dash assignments currently attached to one
 * projected coordination center.
 * @param {object} molecule - Molecule-like graph to inspect.
 * @param {string} centerId - Candidate metal-center atom ID.
 * @returns {number} Number of wedge/dash assignments anchored on the center.
 */
function countProjectedDisplayAssignments(molecule, centerId) {
  let count = 0;
  for (const bond of molecule?.bonds?.values?.() ?? []) {
    const displayAs = bond?.properties?.display?.as ?? null;
    if ((displayAs === 'wedge' || displayAs === 'dash') && bond.properties.display?.centerId === centerId) {
      count++;
    }
  }
  return count;
}

/**
 * Returns the expected number of projected wedge/dash assignments for one
 * coordination center based on its current supported publication geometry.
 * @param {object} atom - Candidate metal-center atom.
 * @param {number} coordinationBondCount - Number of supported ligands on the center.
 * @returns {number} Expected projected assignment count.
 */
function expectedProjectedDisplayAssignmentCount(atom, coordinationBondCount) {
  const geometryKind = organometallicGeometryKind(atom?.name ?? '', coordinationBondCount);
  return organometallicProjectedDisplayAssignmentCount(geometryKind);
}

/**
 * Returns whether the molecule has a supported projected organometallic center
 * whose current display hints are missing one side of the projection.
 * @param {object} molecule - Molecule-like graph to inspect.
 * @returns {boolean} True when force-mode seeding should repair the display hints.
 */
function hasIncompleteProjectedOrganometallicDisplay(molecule) {
  for (const atom of molecule?.atoms?.values?.() ?? []) {
    const group = atom?.properties?.group ?? 0;
    if (group < 3 || group > 12) {
      continue;
    }
    let coordinationBondCount = 0;
    for (const bondId of atom.bonds ?? []) {
      const bond = molecule.bonds.get(bondId);
      if (isCoordinationBondLike(bond)) {
        coordinationBondCount++;
      }
    }
    const expectedProjectedAssignments = expectedProjectedDisplayAssignmentCount(atom, coordinationBondCount);
    if (expectedProjectedAssignments > 0 && countProjectedDisplayAssignments(molecule, atom.id) < expectedProjectedAssignments) {
      return true;
    }
  }
  return false;
}

function forceRingFillData(molecule) {
  const ringFills = typeof molecule.getRingFills === 'function' ? molecule.getRingFills() : (molecule.properties?.style?.ringFills ?? []);
  if (ringFills.length === 0 || typeof molecule.getRings !== 'function') {
    return [];
  }
  const ringByKey = new Map(molecule.getRings().map(ringAtomIds => [ringAtomKey(ringAtomIds), ringAtomIds]));
  return ringFills
    .map(fill => {
      const ringAtomIds = ringByKey.get(ringAtomKey(fill.atomIds ?? []));
      return ringAtomIds ? { ...fill, atomIds: ringAtomIds } : null;
    })
    .filter(Boolean);
}

/**
 * Repositions hidden hydrogens on a seeded clone so tetrahedral stereo syncing
 * can use a real local direction instead of coincident parent coordinates.
 * @param {object} molecule - Seeded clone containing computed 2D coordinates.
 * @param {number} bondLength - Display bond length used for the seed layout.
 * @returns {void}
 */
function placeHiddenHydrogensForForceStereoSeed(molecule, bondLength) {
  for (const [, atom] of molecule.atoms) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const nbrs = atom.getNeighbors(molecule);
    if (nbrs.length !== 1) {
      continue;
    }
    const parent = nbrs[0];
    if (!parent.getChirality() || parent.x == null) {
      continue;
    }
    const others = parent.getNeighbors(molecule).filter(neighbor => neighbor.id !== atom.id);
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const neighbor of others) {
      if (neighbor.x != null) {
        sumX += neighbor.x - parent.x;
        sumY += neighbor.y - parent.y;
        count++;
      }
    }
    const angle = count > 0 ? Math.atan2(-sumY, -sumX) : 0;
    atom.x = parent.x + Math.cos(angle) * (bondLength * 0.75);
    atom.y = parent.y + Math.sin(angle) * (bondLength * 0.75);
  }
}

/**
 * Seeds missing automatic wedge/dash display hints from a temporary 2D layout
 * so force mode can render stereo and projected organometallic cues on first
 * load without requiring a manual 2D round-trip.
 * @param {object} ctx - Force-scene dependency context.
 * @param {object} molecule - Live molecule shown in force mode.
 * @param {boolean} isReactionPreviewMol - Whether the molecule is a reaction-preview clone.
 * @returns {void}
 */
function seedForceAutoDisplayStereo(ctx, molecule, isReactionPreviewMol) {
  const hasDisplayStereo = [...molecule.bonds.values()].some(bond => bond.properties.display?.as);
  const hasChiralCenters = (molecule.getChiralCenters?.()?.length ?? 0) > 0;
  const needsProjectedOrganometallicSeed = hasProjectedOrganometallicDisplayCandidate(molecule) && hasIncompleteProjectedOrganometallicDisplay(molecule);
  const skipReactionPreviewStereoSeed = isReactionPreviewMol && molecule.__reactionPreview?.skipForceStereoSeed === true;
  const shouldSeed = needsProjectedOrganometallicSeed || (!skipReactionPreviewStereoSeed && ((!hasDisplayStereo && hasChiralCenters) || (isReactionPreviewMol && hasChiralCenters)));
  if (!shouldSeed) {
    return;
  }

  const layoutBondLength = getRenderOptions().layoutBondLength ?? 1.5;
  const seededMolecule = molecule.clone();
  seededMolecule.hideHydrogens();
  ctx.helpers.generate2dCoords(seededMolecule, { suppressH: true, bondLength: layoutBondLength });
  ctx.helpers.alignReaction2dProductOrientation(seededMolecule, layoutBondLength);

  if (hasChiralCenters) {
    placeHiddenHydrogensForForceStereoSeed(seededMolecule, layoutBondLength);
    syncDisplayStereo(seededMolecule);
  }

  copyAutoDisplayStereoFromSeed(seededMolecule, molecule);

  if (isReactionPreviewMol && seededMolecule.__reactionPreview) {
    molecule.__reactionPreview = seededMolecule.__reactionPreview;
  }
}

function _capturePreviousNodePositions(simulation) {
  return new Map(
    simulation.nodes().map(node => [
      node.id,
      {
        x: node.x,
        y: node.y,
        vx: node.vx,
        vy: node.vy,
        fx: node.fx,
        fy: node.fy,
        anchorX: node.anchorX,
        anchorY: node.anchorY,
        forcePlacementParentId: node.forcePlacementParentId,
        forcePlacementAngle: node.forcePlacementAngle
      }
    ])
  );
}

/**
 * Creates the force-scene renderer that builds and updates the D3 force-layout SVG visualization.
 * @param {object} ctx - Structured dependency context providing d3, svg, zoom, g, plotEl, simulation, constants, state, cache, helpers, events, drag, and callbacks.
 * @returns {object} Object with an `updateForce` method for re-rendering after molecule or layout changes.
 */
export function createForceSceneRenderer(ctx) {
  /**
   * Rebuilds the force scene for the provided molecule, optionally preserving prior positions or seeding from a custom anchor layout.
   * @param {object} molecule - Molecule to render in force mode.
   * @param {object} [options] - Optional force-render controls.
   * @param {boolean} [options.preservePositions] - When true, reuses the prior node positions and velocities where possible.
   * @param {boolean} [options.preserveView] - When true, preserves the current zoom transform.
   * @param {boolean} [options.keepInView] - When true, keeps the graph inside the viewport after restoring a preserved transform.
   * @param {Map<string, {x: number, y: number}>|null} [options.anchorLayout] - Optional precomputed heavy-atom anchors keyed by atom id.
   * @param {Map<string, {x: number, y: number}>|null} [options.initialPatchPos] - Optional initial patch positions applied before the first restarted tick.
   * @param {number} [options.fitPad] - Optional padding for the initial viewport fit.
   * @param {number} [options.fitScaleMultiplier] - Optional zoom multiplier for the initial viewport fit.
   * @param {boolean} [options.ignoreOverlayPadding] - When true, fits without reserving UI overlay gutters.
   * @param {boolean} [options.fitReactionLike] - When true, uses reaction-preview overlay padding for the initial viewport fit.
   * @returns {void}
   */
  function updateForce(
    molecule,
    {
      preservePositions = false,
      preserveView = preservePositions,
      keepInView = false,
      anchorLayout = null,
      initialPatchPos = null,
      fitPad = null,
      fitScaleMultiplier = null,
      ignoreOverlayPadding = false,
      fitReactionLike = false
    } = {}
  ) {
    prepareAromaticBondRendering(molecule);
    const { showLonePairs } = getRenderOptions();
    const valenceWarningMap = ctx.helpers.valenceWarningMapFor(molecule);
    ctx.state.setActiveValenceWarningMap(valenceWarningMap);
    ctx.state.setForceAutoFitEnabled(!preserveView);
    ctx.state.disableKeepInView();

    const previousNodePositions = preservePositions ? _capturePreviousNodePositions(ctx.simulation) : null;
    const previousZoomTransform = preserveView ? ctx.d3.zoomTransform(ctx.svg.node()) : null;

    const resolvedAnchorLayout = anchorLayout ?? ctx.helpers.buildForceAnchorLayout(molecule);

    const isReactionPreviewMol = [...molecule.atoms.keys()].some(id => typeof id === 'string' && id.includes(':'));
    seedForceAutoDisplayStereo(ctx, molecule, isReactionPreviewMol);
    if (ctx.state.getPreserveSelectionOnNextRender()) {
      ctx.state.syncSelectionToMolecule(molecule);
    } else {
      ctx.state.clearSelection();
    }
    ctx.state.setPreserveSelectionOnNextRender(false);

    const graph = ctx.helpers.convertMolecule(molecule);
    const atomForNode = node => molecule.atoms.get(node?.id) ?? node;
    const bondForLink = link => molecule.bonds.get(link?.id) ?? link;
    const forceNodeById = new Map(graph.nodes.map(node => [node.id, node]));
    ctx.g.selectAll('*').remove();
    ctx.cache.reset();

    if (!preserveView) {
      ctx.svg.call(ctx.zoom.transform, ctx.d3.zoomIdentity);
    }

    const forceRingFills = forceRingFillData(molecule);
    const forceRingAtomIds = typeof molecule.getRings === 'function' ? molecule.getRings() : [];
    let forceRingFillPaths = null;
    if (forceRingFills.length > 0) {
      forceRingFillPaths = ctx.g
        .append('g')
        .attr('class', 'force-ring-fills')
        .style('pointer-events', 'none')
        .selectAll('path.force-ring-fill')
        .data(forceRingFills, fill => fill.id)
        .enter()
        .append('path')
        .attr('class', 'ring-fill force-ring-fill')
        .attr('data-ring-fill-id', fill => ringFillDomId(fill.atomIds))
        .attr('fill-rule', 'evenodd')
        .attr('fill', fill => fill.color)
        .attr('fill-opacity', fill => fill.opacity ?? 0.25)
        .attr('stroke', 'none');
    }

    function _updateForceRingFills() {
      if (!forceRingFillPaths) {
        return;
      }
      forceRingFillPaths.attr('d', fill => {
        const shape = buildRingFillShape(fill.atomIds, forceRingAtomIds, atomId => {
          const node = forceNodeById.get(atomId);
          return node && Number.isFinite(node.x) && Number.isFinite(node.y) ? node : null;
        });
        return shape?.path ?? '';
      });
    }

    const bondEnter = ctx.g
      .selectAll('line.link-base')
      .data(graph.links, d => d.id)
      .enter();

    const valenceWarningNodes = graph.nodes.filter(node => valenceWarningMap.has(node.id));
    const valenceWarningCircles = ctx.g
      .append('g')
      .attr('class', 'valence-warning-layer')
      .style('pointer-events', 'none')
      .selectAll('circle.valence-warning')
      .data(valenceWarningNodes, d => d.id)
      .enter()
      .append('circle')
      .attr('class', 'valence-warning')
      .attr('r', d => atomRadius(d.protons) + 6)
      .attr('fill', ctx.constants.valenceWarningFill)
      .attr('stroke', 'none');
    ctx.cache.setValenceWarningCircles(valenceWarningCircles);

    const singleBond = bondEnter
      .append('line')
      .filter(d => {
        const order = forceLinkRenderOrder(d);
        return order === 1 || order === 2 || order === 3;
      })
      .attr('class', 'link')
      .attr('data-bond-id', d => d.id)
      .style('stroke-width', d => singleBondWidth(forceLinkRenderOrder(d)))
      .style('stroke', d => bondDisplayColor(bondForLink(d)))
      .style('stroke-opacity', d => bondDisplayOpacity(bondForLink(d)))
      .style('pointer-events', 'none');

    const doubleSep = bondEnter
      .append('line')
      .filter(d => forceLinkRenderOrder(d) === 2)
      .attr('class', 'separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', PI_STROKE.stroke)
      .style('stroke-width', PI_STROKE.width)
      .style('stroke-opacity', d => bondDisplayOpacity(bondForLink(d)))
      .style('pointer-events', 'none');

    const aroBond1 = bondEnter
      .append('line')
      .filter(d => forceLinkRenderOrder(d) === 1.5)
      .attr('class', 'link separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', ARO_STROKE.stroke)
      .style('stroke-width', ARO_STROKE.width)
      .style('stroke-opacity', d => bondDisplayOpacity(bondForLink(d)))
      .style('pointer-events', 'none');

    const aroBond2 = bondEnter
      .append('line')
      .filter(d => forceLinkRenderOrder(d) === 1.5)
      .attr('class', 'link separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', ARO_STROKE.stroke)
      .style('stroke-width', ARO_STROKE.width)
      .style('stroke-dasharray', ARO_STROKE.dashArray)
      .style('stroke-opacity', d => bondDisplayOpacity(bondForLink(d)))
      .style('pointer-events', 'none');

    const tripleSep1 = bondEnter
      .append('line')
      .filter(d => forceLinkRenderOrder(d) === 3)
      .attr('class', 'separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', PI_STROKE.stroke)
      .style('stroke-width', PI_STROKE.width)
      .style('stroke-opacity', d => bondDisplayOpacity(bondForLink(d)))
      .style('pointer-events', 'none');

    const tripleSep2 = bondEnter
      .append('line')
      .filter(d => forceLinkRenderOrder(d) === 3)
      .attr('class', 'separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', PI_STROKE.stroke)
      .style('stroke-width', PI_STROKE.width)
      .style('stroke-opacity', d => bondDisplayOpacity(bondForLink(d)))
      .style('pointer-events', 'none');

    const bondHoverTarget = bondEnter
      .append('line')
      .attr('class', 'bond-hover-target')
      .style('stroke', 'transparent')
      .style('stroke-width', '14px')
      .style('pointer-events', 'stroke')
      .style('cursor', 'grab')
      .on('mousedown', (event, d) => {
        ctx.events.handleForceBondMouseDownRingTemplate(event, d);
      })
      .on('click', (event, d) => {
        ctx.events.handleForceBondClick(event, d.id, molecule);
      })
      .on('dblclick', (event, d) => {
        const bond = molecule.bonds.get(d.id);
        if (!bond) {
          return;
        }
        ctx.events.handleForceBondDblClick(event, bond.atoms);
      })
      .on('mouseover', (event, d) => {
        ctx.events.handleForceBondMouseOver(event, d.id, molecule);
      })
      .on('mousemove', event => ctx.events.handleForceBondMouseMove(event))
      .on('mouseout', () => {
        ctx.events.handleForceBondMouseOut();
      })
      .call(ctx.drag.createForceBondDrag(ctx.simulation, molecule));

    // Stereo bond display (wedge / dash) — pre-create elements positioned in tick
    const stereoBondLayer = ctx.g.append('g').attr('class', 'force-stereo-bonds').style('pointer-events', 'none');
    const FORCE_STEREO_SCALE = getRenderOptions().forceBondThicknessMultiplier;
    const FORCE_WEDGE_HW = 5 * FORCE_STEREO_SCALE;
    const FORCE_DASH_COUNT = 5;
    const FORCE_DASH_STROKE = 1.2 * FORCE_STEREO_SCALE;
    const forceStereoBondInfo = [];
    for (const link of graph.links) {
      const bond = molecule.bonds.get(link.id);
      const displayAs = bond?.properties?.display?.as;
      if (displayAs !== 'wedge' && displayAs !== 'dash') {
        continue;
      }
      const centerId = bond.properties.display?.centerId ?? link.source.id;
      const stereoColor = bondDisplayColor(bond) ?? '#111';
      const stereoOpacity = bondDisplayOpacity(bond);
      if (displayAs === 'wedge') {
        const poly = stereoBondLayer.append('polygon').attr('data-bond-id', link.id).attr('fill', stereoColor).attr('fill-opacity', stereoOpacity).attr('pointer-events', 'none');
        forceStereoBondInfo.push({ type: 'wedge', element: poly, centerId, link });
      } else {
        const lines = [];
        for (let i = 0; i < FORCE_DASH_COUNT; i++) {
          lines.push(
            stereoBondLayer
              .append('line')
              .attr('data-bond-id', link.id)
              .attr('stroke', stereoColor)
              .attr('stroke-opacity', stereoOpacity)
              .attr('stroke-width', FORCE_DASH_STROKE)
              .attr('stroke-linecap', 'round')
              .attr('pointer-events', 'none')
          );
        }
        forceStereoBondInfo.push({ type: 'dash', elements: lines, centerId, link });
      }
    }
    // Hide the plain stroke for dash bonds (its hash lines replace it); wedge polygons cover the line automatically
    singleBond.filter(d => molecule.bonds.get(d.id)?.properties?.display?.as === 'dash').style('stroke', 'none');

    function _updateForceStereoDisplay() {
      for (const info of forceStereoBondInfo) {
        const { centerId, link } = info;
        const src = centerId === link.source.id ? link.source : link.target;
        const tgt = centerId === link.source.id ? link.target : link.source;
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const length = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / length;
        const ny = dx / length;
        if (info.type === 'wedge') {
          info.element.attr('points', `${src.x},${src.y} ${tgt.x - nx * FORCE_WEDGE_HW},${tgt.y - ny * FORCE_WEDGE_HW} ${tgt.x + nx * FORCE_WEDGE_HW},${tgt.y + ny * FORCE_WEDGE_HW}`);
        } else {
          for (let i = 0; i < FORCE_DASH_COUNT; i++) {
            const t = (i + 1) / (FORCE_DASH_COUNT + 1);
            const px = src.x + dx * t;
            const py = src.y + dy * t;
            const hw = FORCE_WEDGE_HW * t;
            info.elements[i]
              .attr('x1', px - nx * hw)
              .attr('y1', py - ny * hw)
              .attr('x2', px + nx * hw)
              .attr('y2', py + ny * hw);
          }
        }
      }
    }

    const atom = ctx.g
      .selectAll('circle.node')
      .data(graph.nodes, d => d.id)
      .enter()
      .append('circle')
      .attr('class', 'node')
      .attr('r', d => atomRadius(d.protons))
      .attr('fill', d => atomDisplayColor(atomForNode(d), 'force'))
      .attr('fill-opacity', d => atomDisplayOpacity(atomForNode(d)))
      .attr('stroke', d => strokeColor(d.name))
      .attr('stroke-opacity', d => atomDisplayOpacity(atomForNode(d)))
      .attr('stroke-width', 1)
      .call(ctx.drag.createForceAtomDrag(ctx.simulation))
      .on('mousedown.drawbond', (event, d) => {
        ctx.events.handleForceAtomMouseDownDrawBond(event, d);
      })
      .on('click', (event, d) => {
        ctx.events.handleForceAtomClick(event, d, molecule);
      })
      .on('contextmenu', (event, d) => {
        ctx.events.handleForceAtomContextMenu(event, d);
      })
      .on('dblclick', (event, d) => {
        ctx.events.handleForceAtomDblClick(event, d.id);
      })
      .on('mouseover', (event, d) => {
        ctx.events.handleForceAtomMouseOver(event, d, molecule, valenceWarningMap.get(d.id) ?? null);
      })
      .on('mousemove', event => ctx.events.handleForceAtomMouseMove(event))
      .on('mouseout', (event, d) => {
        ctx.events.handleForceAtomMouseOut(d.id);
      });

    const atomSymbol = ctx.g
      .selectAll('text.atom-symbol')
      .data(graph.nodes, d => d.id)
      .enter()
      .append('text')
      .attr('class', d => (shouldAutoLabelForceAtom(d) ? 'atom-symbol force-auto-label' : 'atom-symbol'))
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-family', 'Arial, Helvetica, sans-serif')
      .attr('font-weight', 'bold')
      .attr('font-size', d => (d.name.length > 1 ? '7px' : '9px'))
      .attr('fill', d => {
        const atom = atomForNode(d);
        if (d.name === 'H' && !atom.properties?.style) {
          return '#111';
        }
        const hex = atomDisplayColor(atom, 'force');
        const cr = parseInt(hex.slice(1, 3), 16);
        const cg = parseInt(hex.slice(3, 5), 16);
        const cb = parseInt(hex.slice(5, 7), 16);
        return cr * 0.299 + cg * 0.587 + cb * 0.114 > 140 ? '#333' : '#fff';
      })
      .attr('opacity', d => atomDisplayOpacity(atomForNode(d)))
      .text(d => d.name);

    const forceLonePairLayer = showLonePairs ? ctx.g.append('g').attr('class', 'force-lone-pairs').style('pointer-events', 'none') : null;

    const forceChargeFontSize = 11;
    const chargeBadgeColor = '#111111';
    const chargeLabel = ctx.g
      .selectAll('g.charge-label')
      .data(
        graph.nodes.filter(d => d.charge !== 0),
        d => d.id
      )
      .enter()
      .append('g')
      .attr('class', 'charge-label')
      .attr('pointer-events', 'none');
    chargeLabel
      .append('circle')
      .attr('class', 'charge-label-ring')
      .attr('r', d => chargeBadgeMetrics(formatChargeLabel(d.charge), forceChargeFontSize).radius)
      .attr('fill', 'white')
      .attr('stroke', chargeBadgeColor)
      .attr('stroke-width', 0.9)
      .attr('opacity', d => atomDisplayOpacity(atomForNode(d)));
    chargeLabel
      .append('text')
      .attr('class', 'charge-label-text')
      .attr('font-family', 'Arial, Helvetica, sans-serif')
      .attr('font-size', d => `${chargeBadgeMetrics(formatChargeLabel(d.charge), forceChargeFontSize).fontSize}px`)
      .attr('font-weight', '700')
      .attr('fill', chargeBadgeColor)
      .attr('opacity', d => atomDisplayOpacity(atomForNode(d)))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .text(d => formatChargeLabel(d.charge));

    const forceLonePairDotsByAtomId = new Map();
    const forceChargeAngleByAtomId = new Map();
    const forceResonanceArrowOptions = {
      atomEndPad: 0,
      atomToBondSourceOffset: ({ atom }) => atomRadius(atom?.properties?.protons, 'force') + 3,
      atomTargetCenterTangent: true,
      atomTargetCircleRadius: (_endpoint, atom) => atomRadius(atom?.properties?.protons, 'force'),
      atomTargetCircleAngle: Math.PI / 6,
      atomTargetCircleClearance: 3,
      atomTargetMinBend: 20,
      minArrowLength: 8,
      strokeWidth: 2,
      chargeAvoidanceRadius: 40,
      chargeAvoidanceSpread: 0.72
    };
    const pointForForceAtom = atom => {
      const node = forceNodeById.get(atom?.id);
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        return null;
      }
      return { x: node.x, y: node.y };
    };
    const orientationPointForForceAtom = atom => {
      const node = forceNodeById.get(atom?.id);
      if (!node) {
        return null;
      }
      if (Number.isFinite(node.anchorX) && Number.isFinite(node.anchorY)) {
        return { x: node.anchorX, y: node.anchorY };
      }
      if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
        return { x: node.x, y: node.y };
      }
      return null;
    };

    function _seedForceOverlayPlacedBoxes() {
      return graph.nodes.map(node => {
        const atomFontSize = node.name.length > 1 ? 7 : 9;
        return {
          cx: node.x,
          cy: node.y,
          hw: (String(node.name).length * atomFontSize * 0.62) / 2 + 2,
          hh: atomFontSize * 0.7
        };
      });
    }

    function _forceLonePairDotsForAtom(atom) {
      if (!showLonePairs || atom.name === 'H') {
        return [];
      }
      const cached = forceLonePairDotsByAtomId.get(atom.id);
      if (cached) {
        return cached;
      }
      const node = forceNodeById.get(atom.id);
      if (!node) {
        return [];
      }
      const dots = computeLonePairDotPositions(atom, molecule, {
        pointForAtom: pointForForceAtom,
        orientationPointForAtom: orientationPointForForceAtom,
        baseRadius: atomRadius(node.protons, 'force'),
        offsetFromBoundary: 7,
        dotSpacing: 6
      });
      forceLonePairDotsByAtomId.set(atom.id, dots);
      return dots;
    }

    function _updateForceLonePairs() {
      if (!forceLonePairLayer) {
        return;
      }
      forceLonePairDotsByAtomId.clear();
      const dots = [];
      for (const atom of molecule.atoms.values()) {
        const atomDots = _forceLonePairDotsForAtom(atom);
        for (let i = 0; i < atomDots.length; i++) {
          dots.push({ id: `${atom.id}:${i}`, atomId: atom.id, ...atomDots[i] });
        }
      }

      const lonePairDots = forceLonePairLayer.selectAll('circle.force-lone-pair').data(dots, d => d.id);
      lonePairDots
        .enter()
        .append('circle')
        .attr('class', 'force-lone-pair')
        .attr('r', 2.1)
        .attr('fill', '#f0d84d')
        .attr('stroke', '#111111')
        .attr('stroke-width', 0.7)
        .merge(lonePairDots)
        .attr('opacity', d => atomDisplayOpacity(molecule.atoms.get(d.atomId)))
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
      lonePairDots.exit().remove();
    }

    function _updateForceChargeLabels() {
      chargeLabel.attr('transform', d => {
        const atom = molecule.atoms.get(d.id);
        if (!atom) {
          return 'translate(-9999,-9999)';
        }
        const center = pointForForceAtom(atom);
        if (!center) {
          return 'translate(-9999,-9999)';
        }
        const arrowOccupiedAngles = resonanceArrowOccupiedAnglesForAtom(molecule, atom, pointForForceAtom, forceResonanceArrowOptions);
        const placement = computeChargeBadgePlacement(atom, molecule, {
          pointForAtom: pointForForceAtom,
          orientationPointForAtom: orientationPointForForceAtom,
          baseRadius: atomRadius(d.protons, 'force'),
          fontSize: forceChargeFontSize,
          chargeLabel: formatChargeLabel(d.charge),
          stickyAngle: forceChargeAngleByAtomId.get(atom.id) ?? null,
          extraOccupiedAngles: [
            ..._forceLonePairDotsForAtom(atom)
              .map(dot => Math.atan2(dot.y - center.y, dot.x - center.x))
              .filter(Number.isFinite),
            ...arrowOccupiedAngles
          ]
        });
        if (placement) {
          forceChargeAngleByAtomId.set(atom.id, placement.angle);
        }
        return placement ? `translate(${placement.x},${placement.y})` : 'translate(-9999,-9999)';
      });
    }

    ctx.helpers.seedForceNodePositions(graph, molecule, resolvedAnchorLayout, {
      previousNodePositions
    });

    ctx.simulation.nodes(graph.nodes);
    ctx.simulation.force('link').links(graph.links);
    ctx.simulation
      .force('charge')
      .strength(node => (ctx.helpers.isHydrogenNode(node) ? ctx.constants.forceLayoutHRepulsion : ctx.constants.forceLayoutHeavyRepulsion))
      .distanceMax(180);
    ctx.simulation
      .force('link')
      .strength(link => (ctx.helpers.isHydrogenNode(link.source) || ctx.helpers.isHydrogenNode(link.target) ? 0.8 : 0.9))
      .distance(ctx.helpers.forceLinkDistance);
    ctx.simulation.force('anchor', ctx.helpers.forceAnchorRadius());
    const hydrogenRepulsionForce = ctx.helpers.forceHydrogenRepulsion();
    hydrogenRepulsionForce.links?.(graph.links);
    ctx.simulation.force('hRepel', hydrogenRepulsionForce);
    ctx.simulation.force('hPlace', ctx.helpers.forceHydrogenPlacement(graph.links));
    const hasInitialPatch = initialPatchPos?.size > 0;
    if (hasInitialPatch) {
      // Apply converter/edit-driven force patches before the first restarted
      // tick so nodes do not animate in from the temporary seed layout.
      ctx.helpers.patchForceNodePositions(initialPatchPos, { alpha: 0, restart: false });
      ctx.helpers.reseatHydrogensAroundPatched(initialPatchPos, { resetVelocity: true });
    }
    if (!preservePositions && !hasInitialPatch && typeof ctx.simulation.tick === 'function') {
      ctx.simulation.alpha(ctx.constants.forceLayoutInitialSettleAlpha);
      ctx.simulation.tick(ctx.constants.forceLayoutInitialSettleTicks);
      ctx.helpers.reseatForceGraphHydrogens(graph, { resetVelocity: true });
    }
    ctx.simulation.alpha(preservePositions || hasInitialPatch ? ctx.constants.forceLayoutEditRestartAlpha : ctx.constants.forceLayoutInitialRestartAlpha).restart();
    _updateForceRingFills();
    _updateForceLonePairs();
    _updateForceChargeLabels();
    _updateForceStereoDisplay();

    const forceEnData = getBondEnOverlayData(molecule);
    const forceLinkById = new Map(graph.links.map(link => [link.id, link]));
    let forceBondEnPlacementBoxes = [];
    let forceBondEnLayer = null;
    let forceBondEnLabels = null;
    if (forceEnData) {
      forceBondEnLayer = ctx.g.append('g').attr('class', 'force-bond-en').style('pointer-events', 'none');
      const labelData = forceEnData.map(({ bondId, label, t }) => ({ link: forceLinkById.get(bondId), bond: molecule.bonds.get(bondId), label, t })).filter(d => d.link && d.bond);
      forceBondEnLabels = forceBondEnLayer
        .selectAll('text.force-bond-en-label')
        .data(labelData)
        .enter()
        .append('text')
        .attr('class', 'force-bond-en-label')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', `${getRenderOptions().bondEnFontSize}px`)
        .attr('pointer-events', 'none')
        .attr('fill', d => ctx.helpers.enLabelColor(d.t))
        .text(d => d.label);
    }

    function _updateForceBondEnLabels() {
      if (!forceBondEnLabels) {
        forceBondEnPlacementBoxes = [];
        return;
      }
      const fontSize = getRenderOptions().bondEnFontSize;
      const bondOffset = ctx.constants.bondOffset ?? 2;
      const blockerSegments = forceBondEnLabels.data().flatMap(d => {
        const start = { x: d.link.source.x, y: d.link.source.y };
        const end = { x: d.link.target.x, y: d.link.target.y };
        const atomA = molecule.atoms.get(d.link.source.id);
        const atomB = molecule.atoms.get(d.link.target.id);
        const order = forceLinkRenderOrder(d.link);
        const preferredSide = order === 2 || order === 1.5 ? -secondaryDir(atomA, atomB, molecule, pointForForceAtom) : 1;
        return buildBondOverlayBlockerSegments({
          start,
          end,
          bond: d.bond,
          order,
          stereoType: d.bond.properties.display?.as ?? null,
          preferredSide,
          bondOffset,
          wedgeHalfWidth: 5,
          wedgeDashes: 6
        });
      });
      const placed = _seedForceOverlayPlacedBoxes();
      const placements = [];
      forceBondEnLabels.attr('transform', d => {
        const start = { x: d.link.source.x, y: d.link.source.y };
        const end = { x: d.link.target.x, y: d.link.target.y };
        const atomA = molecule.atoms.get(d.link.source.id);
        const atomB = molecule.atoms.get(d.link.target.id);
        const hydrogenNode = atomA?.name === 'H' || atomA?.name === 'D' ? d.link.source : atomB?.name === 'H' || atomB?.name === 'D' ? d.link.target : null;
        const otherNode = hydrogenNode === d.link.source ? d.link.target : d.link.source;
        if (hydrogenNode && otherNode) {
          const placement = pickHydrogenBondOverlayPlacement({
            hydrogenPoint: { x: hydrogenNode.x, y: hydrogenNode.y },
            otherPoint: { x: otherNode.x, y: otherNode.y },
            label: d.label,
            fontSize,
            hydrogenRadius: atomRadius(hydrogenNode.protons, 'force'),
            placedBoxes: placed
          });
          placed.push(placement);
          placements.push(placement);
          return `translate(${placement.cx},${placement.cy})`;
        }
        const order = forceLinkRenderOrder(d.link);
        const preferredSide = order === 2 || order === 1.5 ? -secondaryDir(atomA, atomB, molecule, pointForForceAtom) : 1;
        const placement = pickBondOverlayLabelPlacement({
          start,
          end,
          label: d.label,
          fontSize,
          preferredSide,
          placedBoxes: placed,
          blockerSegments,
          baseOffset: defaultBondOverlayBaseOffset({
            bond: d.bond,
            order,
            stereoType: d.bond.properties.display?.as ?? null,
            fontSize,
            bondOffset,
            wedgeHalfWidth: 5
          })
        });
        placed.push(placement);
        placements.push(placement);
        return `translate(${placement.cx},${placement.cy})`;
      });
      forceBondEnPlacementBoxes = placements;
    }
    _updateForceBondEnLabels();

    const forceBondLengthsData = getBondLengthsOverlayData(molecule);
    let forceBondLengthPlacementBoxes = [];
    let forceBondLengthLayer = null;
    let forceBondLengthLabels = null;
    if (forceBondLengthsData) {
      forceBondLengthLayer = ctx.g.append('g').attr('class', 'force-bond-lengths').style('pointer-events', 'none');
      const blLabelData = forceBondLengthsData.map(({ bondId, label }) => ({ link: forceLinkById.get(bondId), bond: molecule.bonds.get(bondId), label })).filter(d => d.link && d.bond);
      forceBondLengthLabels = forceBondLengthLayer
        .selectAll('text.force-bond-length-label')
        .data(blLabelData)
        .enter()
        .append('text')
        .attr('class', 'force-bond-length-label')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', `${getRenderOptions().bondLengthFontSize}px`)
        .attr('pointer-events', 'none')
        .attr('fill', '#000')
        .text(d => d.label);
    }
    function _updateForceBondLengthLabels() {
      if (!forceBondLengthLabels) {
        forceBondLengthPlacementBoxes = [];
        return;
      }
      const fontSize = getRenderOptions().bondLengthFontSize;
      const bondOffset = ctx.constants.bondOffset ?? 2;
      const blockerSegments = forceBondLengthLabels.data().flatMap(d => {
        const start = { x: d.link.source.x, y: d.link.source.y };
        const end = { x: d.link.target.x, y: d.link.target.y };
        const atomA = molecule.atoms.get(d.link.source.id);
        const atomB = molecule.atoms.get(d.link.target.id);
        const order = forceLinkRenderOrder(d.link);
        const preferredSide = order === 2 || order === 1.5 ? -secondaryDir(atomA, atomB, molecule, pointForForceAtom) : 1;
        return buildBondOverlayBlockerSegments({
          start,
          end,
          bond: d.bond,
          order,
          stereoType: d.bond.properties.display?.as ?? null,
          preferredSide,
          bondOffset,
          wedgeHalfWidth: 5,
          wedgeDashes: 6
        });
      });
      const placed = _seedForceOverlayPlacedBoxes();
      const placements = [];
      forceBondLengthLabels.attr('transform', d => {
        const start = { x: d.link.source.x, y: d.link.source.y };
        const end = { x: d.link.target.x, y: d.link.target.y };
        const atomA = molecule.atoms.get(d.link.source.id);
        const atomB = molecule.atoms.get(d.link.target.id);
        const hydrogenNode = atomA?.name === 'H' || atomA?.name === 'D' ? d.link.source : atomB?.name === 'H' || atomB?.name === 'D' ? d.link.target : null;
        const otherNode = hydrogenNode === d.link.source ? d.link.target : d.link.source;
        if (hydrogenNode && otherNode) {
          const placement = pickHydrogenBondOverlayPlacement({
            hydrogenPoint: { x: hydrogenNode.x, y: hydrogenNode.y },
            otherPoint: { x: otherNode.x, y: otherNode.y },
            label: d.label,
            fontSize,
            hydrogenRadius: atomRadius(hydrogenNode.protons, 'force'),
            placedBoxes: placed
          });
          placed.push(placement);
          placements.push(placement);
          return `translate(${placement.cx},${placement.cy})`;
        }
        const order = forceLinkRenderOrder(d.link);
        const preferredSide = order === 2 || order === 1.5 ? -secondaryDir(atomA, atomB, molecule, pointForForceAtom) : 1;
        const placement = pickBondOverlayLabelPlacement({
          start,
          end,
          label: d.label,
          fontSize,
          preferredSide,
          placedBoxes: placed,
          blockerSegments,
          baseOffset: defaultBondOverlayBaseOffset({
            bond: d.bond,
            order,
            stereoType: d.bond.properties.display?.as ?? null,
            fontSize,
            bondOffset,
            wedgeHalfWidth: 5
          })
        });
        placed.push(placement);
        placements.push(placement);
        return `translate(${placement.cx},${placement.cy})`;
      });
      forceBondLengthPlacementBoxes = placements;
    }
    _updateForceBondLengthLabels();

    const forceNumberMap = getAtomNumberMap(molecule);
    const forceNodeById2 = forceNodeById;
    let forceAtomNumberLayer = null;
    let forceAtomNumberLabels = null;
    if (forceNumberMap) {
      const nodeNeighbors = new Map(graph.nodes.map(n => [n.id, []]));
      const nodeLinks = new Map(graph.nodes.map(n => [n.id, []]));
      for (const link of graph.links) {
        nodeNeighbors.get(link.source.id)?.push(link.target);
        nodeNeighbors.get(link.target.id)?.push(link.source);
        nodeLinks.get(link.source.id)?.push(link);
        nodeLinks.get(link.target.id)?.push(link);
      }
      forceAtomNumberLayer = ctx.g.append('g').attr('class', 'force-atom-numbering').style('pointer-events', 'none');
      const numData = [...forceNumberMap.entries()]
        .map(([id, num]) => ({
          node: forceNodeById2.get(id),
          label: String(num),
          neighbors: nodeNeighbors.get(id) ?? [],
          links: nodeLinks.get(id) ?? []
        }))
        .filter(d => d.node);
      forceAtomNumberLabels = forceAtomNumberLayer
        .selectAll('text.force-atom-num')
        .data(numData)
        .enter()
        .append('text')
        .attr('class', 'force-atom-num')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', `${getRenderOptions().atomNumberingFontSize}px`)
        .attr('pointer-events', 'none')
        .attr('fill', '#444')
        .text(d => d.label);
    }
    function _updateForceAtomNumberLabels() {
      if (!forceAtomNumberLabels) {
        return;
      }
      const placed = [...forceBondEnPlacementBoxes, ...forceBondLengthPlacementBoxes];
      forceAtomNumberLabels.attr('transform', d => {
        const { node, neighbors, links, label } = d;
        const blockedSectors = neighbors.map(nb => {
          const angle = Math.atan2(nb.y - node.y, nb.x - node.x);
          const link = links.find(candidate => candidate.source.id === nb.id || candidate.target.id === nb.id);
          const spread = forceLinkRenderOrder(link) >= 2 ? 0.52 : 0.4;
          return { angle, spread };
        });
        const chargeAngle = forceChargeAngleByAtomId.get(node.id) ?? null;
        if (chargeAngle != null) {
          blockedSectors.push({ angle: chargeAngle, spread: 0.3 });
        }
        const atom = molecule.atoms.get(node.id);
        if (atom && showLonePairs) {
          const lp = _forceLonePairDotsForAtom(atom);
          for (const dot of lp) {
            blockedSectors.push({ angle: Math.atan2(dot.y - node.y, dot.x - node.x), spread: 0.32 });
          }
        }
        if (atom) {
          for (const link of links) {
            const order = forceLinkRenderOrder(link);
            if (order !== 2 && order !== 1.5 && order !== 3) {
              continue;
            }
            const otherNode = link.source.id === node.id ? link.target : link.source;
            const otherAtom = molecule.atoms.get(otherNode.id);
            if (!otherAtom) {
              continue;
            }
            const dir = secondaryDir(atom, otherAtom, molecule, pointForForceAtom);
            const terminal = order === 2 && (heavyDegree(atom, molecule) === 1 || heavyDegree(otherAtom, molecule) === 1);
            for (const sideAngle of multipleBondAnnotationBlockerAngles(node, otherNode, { order, side: dir, terminal })) {
              blockedSectors.push({ angle: sideAngle, spread: order >= 3 ? 0.56 : 0.5 });
            }
          }
        }
        const placement = pickAtomAnnotationPlacement({
          center: { x: node.x, y: node.y },
          label,
          fontSize: getRenderOptions().atomNumberingFontSize,
          blockedSectors,
          placedBoxes: placed
        });
        placed.push(placement);
        return `translate(${placement.cx},${placement.cy})`;
      });
    }
    _updateForceAtomNumberLabels();

    function _raiseForceAnnotationLayers() {
      atomSymbol.raise?.();
      forceLonePairLayer?.raise?.();
      chargeLabel.raise?.();
      forceBondEnLayer?.raise?.();
      forceBondLengthLayer?.raise?.();
      forceAtomNumberLayer?.raise?.();
    }

    /**
     * Updates all force-rendered scene layers from the current simulation node
     * positions. This is called once before overlay/highlight rendering so no
     * reaction preview layer can flash ahead of the main molecule.
     * @returns {void}
     */
    function _updateForceScenePositions() {
      ctx.helpers.renderReactionPreviewArrowForce(graph.nodes, molecule);

      singleBond
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      doubleSep
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      aroBond1
        .attr('x1', d => d.source.x - xOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('y1', d => d.source.y - yOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('x2', d => d.target.x - xOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('y2', d => d.target.y - yOffset(ctx.constants.bondOffset, d.source, d.target));

      aroBond2
        .attr('x1', d => d.source.x - xOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('y1', d => d.source.y - yOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('x2', d => d.target.x - xOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('y2', d => d.target.y - yOffset(-ctx.constants.bondOffset, d.source, d.target));

      tripleSep1
        .attr('x1', d => d.source.x - xOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('y1', d => d.source.y - yOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('x2', d => d.target.x - xOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('y2', d => d.target.y - yOffset(ctx.constants.bondOffset, d.source, d.target));

      tripleSep2
        .attr('x1', d => d.source.x - xOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('y1', d => d.source.y - yOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('x2', d => d.target.x - xOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('y2', d => d.target.y - yOffset(-ctx.constants.bondOffset, d.source, d.target));

      bondHoverTarget
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      atom.attr('cx', d => d.x).attr('cy', d => d.y);
      atomSymbol.attr('x', d => d.x).attr('y', d => d.y);
      _updateForceRingFills();

      const forceValenceWarningCircles = ctx.cache.getValenceWarningCircles();
      if (forceValenceWarningCircles) {
        forceValenceWarningCircles.attr('cx', d => d.x).attr('cy', d => d.y);
      }

      _updateForceLonePairs();
      _updateForceChargeLabels();
      _updateForceBondEnLabels();
      _updateForceBondLengthLabels();
      _updateForceAtomNumberLabels();
      _updateForceStereoDisplay();
      drawResonanceElectronFlow2d(ctx.g, molecule, atom => forceNodeById.get(atom.id) ?? atom, forceResonanceArrowOptions);
      _raiseForceAnnotationLayers();

      const highlightLines = ctx.cache.getHighlightLines();
      const highlightCircles = ctx.cache.getHighlightCircles();
      if (highlightLines) {
        highlightLines
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
        highlightCircles?.attr('cx', d => d.x).attr('cy', d => d.y);
      }
      const selectionLines = ctx.cache.getSelectionLines();
      const selectionCircles = ctx.cache.getSelectionCircles();
      if (selectionLines) {
        selectionLines
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
        selectionCircles?.attr('cx', d => d.x).attr('cy', d => d.y);
      }

      if (ctx.state.isForceAutoFitEnabled()) {
        const fitTransform = ctx.helpers.forceFitTransform(graph.nodes, fitPad ?? ctx.constants.forceLayoutInitialFitPad, {
          hydrogenRadiusScale: ctx.constants.forceLayoutInitialHRadiusScale,
          scaleMultiplier: fitScaleMultiplier ?? ctx.constants.forceLayoutInitialZoomMultiplier,
          ignoreOverlayPadding,
          reactionLike: fitReactionLike === true || molecule?.__reactionPreview?.resonancePair === true
        });
        if (fitTransform) {
          ctx.svg.call(ctx.zoom.transform, fitTransform);
          ctx.state.setForceAutoFitEnabled(false);
          ctx.state.enableKeepInView(ctx.constants.forceLayoutInitialKeepInViewTicks);
        }
      } else if (ctx.state.isKeepInViewEnabled()) {
        if (ctx.state.getKeepInViewTicks() > 0) {
          ctx.state.setKeepInViewTicks(ctx.state.getKeepInViewTicks() - 1);
          if (ctx.state.getKeepInViewTicks() <= 0) {
            ctx.state.disableKeepInView();
            return;
          }
        }
        if (ctx.simulation.alpha() < ctx.constants.forceLayoutKeepInViewAlphaMin) {
          ctx.state.disableKeepInView();
          return;
        }
        const transform = ctx.d3.zoomTransform(ctx.svg.node());
        const fitTransform = ctx.helpers.forceFitTransform(graph.nodes, ctx.constants.forceLayoutFitPad);
        if (fitTransform && ctx.helpers.zoomTransformsDiffer(fitTransform, transform)) {
          ctx.svg.call(ctx.zoom.transform, fitTransform);
          ctx.state.disableKeepInView();
        }
      }
    }

    ctx.simulation.on('tick', _updateForceScenePositions);
    _updateForceScenePositions();

    if (preserveView && previousZoomTransform) {
      ctx.svg.call(ctx.zoom.transform, previousZoomTransform);
    }
    if (keepInView) {
      ctx.state.enableKeepInView(ctx.constants.forceLayoutInitialKeepInViewTicks);
    }

    if (ctx.callbacks.hasHighlights()) {
      ctx.callbacks.applyForceHighlights();
    }
    if (ctx.callbacks.hasSelection()) {
      ctx.callbacks.applyForceSelection();
    }
  }

  return {
    updateForce
  };
}
