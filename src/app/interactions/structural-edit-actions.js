/** @module app/interactions/structural-edit-actions */

import { ReactionPreviewPolicy, ResonancePolicy, SnapshotPolicy, ViewportPolicy } from '../core/editor-actions.js';

const FORCE_RESEAT_HYDROGEN_DISTANCE = 25;

export function createStructuralEditActions(context) {
  function buildForceInitialPatchPos(atomIds) {
    const simulation = context.force.getSimulation?.();
    const previousNodes = simulation?.nodes?.();
    if (!Array.isArray(previousNodes) || previousNodes.length === 0) {
      return null;
    }

    const previousNodePositions = new Map();
    for (const node of previousNodes) {
      if (!Number.isFinite(node?.x) || !Number.isFinite(node?.y)) {
        continue;
      }
      previousNodePositions.set(node.id, { x: node.x, y: node.y });
    }

    const patchPos = new Map();
    for (const atomId of atomIds) {
      const position = previousNodePositions.get(atomId);
      if (!position) {
        continue;
      }
      patchPos.set(atomId, position);
    }

    return patchPos.size > 0 ? patchPos : null;
  }

  function restore2dEditViewport(zoomSnapshot, { reactionRestored = false, reactionEntryZoomSnapshot = null, resonanceReset = false, zoomToFit = false } = {}) {
    if (context.getMode() !== '2d') {
      return;
    }
    if (reactionRestored && reactionEntryZoomSnapshot) {
      context.view.restoreZoomTransformSnapshot(reactionEntryZoomSnapshot);
      return;
    }
    if (resonanceReset && zoomSnapshot) {
      context.view.restoreZoomTransformSnapshot(zoomSnapshot);
      return;
    }
    if (zoomToFit) {
      context.view.zoomToFitIf2d();
    }
  }

  function prepareResonanceStructuralEdit(mol) {
    const structuralEdit = context.resonance.prepareResonanceStateForStructuralEdit(mol);
    if (structuralEdit.resonanceCleared || structuralEdit.resonanceReset) {
      mol = context.molecule.getActive();
    }
    return { mol: structuralEdit.mol ?? mol, resonanceReset: structuralEdit.resonanceReset };
  }

  function dearomatizeBondAromaticComponent(mol, startBondId) {
    const visitedBondIds = new Set();
    const atomIds = new Set();
    const queue = [startBondId];

    while (queue.length > 0) {
      const bondId = queue.shift();
      if (visitedBondIds.has(bondId)) {
        continue;
      }
      const bond = mol.bonds.get(bondId);
      if (!bond?.properties?.aromatic) {
        continue;
      }
      visitedBondIds.add(bondId);
      for (const atomId of bond.atoms) {
        atomIds.add(atomId);
        const atom = mol.atoms.get(atomId);
        if (!atom) {
          continue;
        }
        for (const neighborBondId of atom.bonds) {
          if (visitedBondIds.has(neighborBondId)) {
            continue;
          }
          const neighborBond = mol.bonds.get(neighborBondId);
          if (neighborBond?.properties?.aromatic) {
            queue.push(neighborBondId);
          }
        }
      }
    }

    for (const bondId of visitedBondIds) {
      const bond = mol.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      bond.properties.order = Number.isInteger(bond.properties.localizedOrder) ? bond.properties.localizedOrder : 1;
      bond.properties.aromatic = false;
      delete bond.properties.localizedOrder;
    }
    for (const atomId of atomIds) {
      const atom = mol.atoms.get(atomId);
      if (atom) {
        atom.properties.aromatic = false;
      }
    }
  }

  function promoteBondOrder(bondId, options = {}) {
    const {
      reactionRestored = false,
      reactionEntryZoomSnapshot = null,
      skipReactionPreviewPrep = false,
      skipResonancePrep = false,
      skipSnapshot = false,
      zoomSnapshot = context.getMode() === '2d' ? context.view.captureZoomTransformSnapshot() : null
    } = options;

    return context.controller.performStructuralEdit(
      'promote-bond-order',
      {
        overlayPolicy: skipReactionPreviewPrep ? ReactionPreviewPolicy.preserve : ReactionPreviewPolicy.prepareBondTarget,
        reactionPreviewPayload: skipReactionPreviewPrep ? null : bondId,
        reactionEdit: skipReactionPreviewPrep ? { bondId, restored: reactionRestored, entryZoomTransform: reactionEntryZoomSnapshot } : null,
        resonancePolicy: skipResonancePrep ? ResonancePolicy.preserve : ResonancePolicy.normalizeForEdit,
        snapshotPolicy: skipSnapshot ? SnapshotPolicy.skip : SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.restoreEdit,
        zoomSnapshot,
        preflight: ({ mol, mode, reactionEdit }) => {
          const targetBondId = skipReactionPreviewPrep ? bondId : (reactionEdit?.bondId ?? bondId);
          const bond = mol.bonds.get(targetBondId);
          if (!bond) {
            return false;
          }
          if (mode === 'force') {
            const [atom1, atom2] = bond.getAtomObjects(mol);
            if (atom1?.name === 'H' || atom2?.name === 'H') {
              return false;
            }
          }
          return true;
        }
      },
      ({ mol, mode, reactionEdit }) => {
        const targetBondId = skipReactionPreviewPrep ? bondId : (reactionEdit?.bondId ?? bondId);
        let bond = mol.bonds.get(targetBondId);
        if (!bond) {
          return { cancelled: true };
        }

        if (mode === 'force') {
          const [atom1, atom2] = bond.getAtomObjects(mol);
          if (atom1?.name === 'H' || atom2?.name === 'H') {
            return { cancelled: true };
          }
        }

        const activeBondId = bond.id;
        const wasAromatic = !!bond.properties.aromatic;
        if (wasAromatic) {
          dearomatizeBondAromaticComponent(mol, activeBondId);
          bond = mol.bonds.get(activeBondId);
          if (!bond) {
            return { cancelled: true };
          }
        }

        const currentOrder = Math.round(bond.properties.order ?? 1);
        const nextOrder = currentOrder >= 3 ? 1 : currentOrder + 1;
        bond.properties.order = nextOrder;
        bond.properties.aromatic = false;
        delete bond.properties.localizedOrder;

        const [atom1, atom2] = bond.getAtomObjects(mol);
        const affected = new Set([atom1?.id, atom2?.id].filter(Boolean));
        mol.clearStereoAnnotations(affected);
        if (!wasAromatic) {
          context.chemistry.kekulize(mol);
          context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        }
        mol.repairImplicitHydrogens(affected);

        const forceResult =
          mode === 'force'
            ? {
                options: { preservePositions: true },
                beforeRender: () =>
                  new Set(
                    context.force
                      .getSimulation()
                      .nodes()
                      .map(node => node.id)
                  ),
                afterRender: (_editContext, prevNodeIds) => {
                  const simulation = context.force.getSimulation();
                  const nodes = simulation.nodes();
                  const allLinks = simulation.force('link').links();
                  const newHNodes = nodes.filter(node => node.name === 'H' && !prevNodeIds.has(node.id));
                  const newHIds = new Set(newHNodes.map(node => node.id));

                  if (newHNodes.length > 0) {
                    const newHByParent = new Map();
                    for (const hNode of newHNodes) {
                      const link = allLinks.find(currentLink => currentLink.source === hNode || currentLink.target === hNode);
                      if (!link) {
                        continue;
                      }
                      const parent = link.source === hNode ? link.target : link.source;
                      if (!newHByParent.has(parent)) {
                        newHByParent.set(parent, []);
                      }
                      newHByParent.get(parent).push(hNode);
                    }
                    for (const [parent, hNodes] of newHByParent) {
                      context.force.placeHydrogensAroundParent(parent, hNodes, allLinks, {
                        distance: FORCE_RESEAT_HYDROGEN_DISTANCE,
                        excludeIds: newHIds
                      });
                    }
                  }

                  for (const node of nodes) {
                    node.vx = 0;
                    node.vy = 0;
                    node.fx = node.x;
                    node.fy = node.y;
                  }
                  simulation.on('end.unfix', () => {
                    for (const node of simulation.nodes()) {
                      node.fx = null;
                      node.fy = null;
                    }
                    simulation.on('end.unfix', null);
                    simulation.alpha(0.08).restart();
                  });
                  simulation.alpha(0);
                }
              }
            : null;

        return {
          suppressDrawBondHover: true,
          clearPrimitiveHover: true,
          restorePrimitiveHover: {
            bondIds: [activeBondId]
          },
          force: forceResult
        };
      }
    );
  }

  function changeAtomElements(atomIds, newEl, options = {}) {
    const {
      zoomSnapshot = context.getMode() === '2d' ? context.view.captureZoomTransformSnapshot() : null,
      overlayPolicy = ReactionPreviewPolicy.prepareEditTargets,
      reactionPreviewPayload = atomIds.length > 0 ? { atomId: atomIds[0] } : null,
      reactionEdit = null
    } = options;

    if (!atomIds.length) {
      return { performed: false, cancelled: true };
    }

    return context.controller.performStructuralEdit(
      'change-atom-elements',
      {
        overlayPolicy,
        reactionPreviewPayload,
        reactionEdit,
        resonancePolicy: ResonancePolicy.normalizeForEdit,
        snapshotPolicy: SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.restoreEdit,
        zoomSnapshot,
        preflight: ({ mol }) =>
          atomIds.some(atomId => {
            const atom = mol.atoms.get(atomId);
            return atom && atom.name !== newEl;
          })
      },
      ({ mol, mode }) => {
        const toChange = atomIds.filter(atomId => {
          const atom = mol.atoms.get(atomId);
          return atom && atom.name !== newEl;
        });
        if (toChange.length === 0) {
          return { cancelled: true };
        }
        for (const atomId of toChange) {
          mol.changeAtomElement(atomId, newEl);
        }
        const affected = new Set(toChange);
        mol.clearStereoAnnotations(affected);
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        mol.repairImplicitHydrogens(affected);
        const initialPatchPos = mode === 'force' ? buildForceInitialPatchPos(toChange) : null;
        return {
          clearSelection: true,
          clearPrimitiveHover: true,
          suppressPrimitiveHover: true,
          restorePrimitiveHover: {
            atomIds: toChange
          },
          force:
            mode === 'force'
              ? {
                  options: { preservePositions: true, preserveView: true, initialPatchPos }
                }
              : null
        };
      }
    );
  }

  function replaceForceHydrogenWithDrawElement(atomId, mol = context.molecule.getCurrentForceMol()) {
    if (!mol) {
      return;
    }

    return context.controller.performStructuralEdit(
      'replace-force-hydrogen-with-draw-element',
      {
        overlayPolicy: ReactionPreviewPolicy.prepareEditTargets,
        reactionPreviewPayload: { atomId },
        resonancePolicy: ResonancePolicy.normalizeForEdit,
        snapshotPolicy: SnapshotPolicy.take,
        viewportPolicy: ViewportPolicy.none
      },
      ({ mol, reactionEdit }) => {
        const targetAtomId = reactionEdit?.atomId ?? atomId;
        const targetAtom = mol.atoms.get(targetAtomId);
        if (!targetAtom) {
          return { cancelled: true };
        }

        mol.changeAtomElement(targetAtomId, context.getDrawBondElement());
        const affected = new Set([targetAtomId]);
        mol.clearStereoAnnotations(affected);
        context.chemistry.kekulize(mol);
        context.chemistry.refreshAromaticity(mol, { preserveKekule: true });
        mol.repairImplicitHydrogens(affected);

        return {
          force: {
            options: { preservePositions: true, preserveView: true },
            beforeRender: () => {
              const simulation = context.force.getSimulation();
              const preHNode = simulation.nodes().find(node => node.id === targetAtomId);
              const preHX = preHNode?.x;
              const preHY = preHNode?.y;
              let parentNode = null;

              if (preHNode) {
                const allLinks = simulation.force('link').links();
                for (const link of allLinks) {
                  const source = link.source;
                  const target = link.target;
                  if (source?.id === targetAtomId && !context.force.isHydrogenNode(target)) {
                    parentNode = target;
                    break;
                  }
                  if (target?.id === targetAtomId && !context.force.isHydrogenNode(source)) {
                    parentNode = source;
                    break;
                  }
                }
              }

              return { parentNode, preHX, preHY };
            },
            afterRender: (_editContext, aux) => {
              if (!aux?.parentNode || aux.preHX == null || aux.preHY == null) {
                return;
              }
              const angle = Math.atan2(aux.preHY - aux.parentNode.y, aux.preHX - aux.parentNode.x);
              const position = {
                x: aux.parentNode.x + Math.cos(angle) * context.constants.forceBondLength,
                y: aux.parentNode.y + Math.sin(angle) * context.constants.forceBondLength
              };
              const patchPos = new Map([[targetAtomId, position]]);
              context.force.patchNodePositions(patchPos);
              context.force.reseatHydrogensAroundPatched(patchPos);
            }
          }
        };
      }
    );
  }

  return {
    restore2dEditViewport,
    prepareResonanceStructuralEdit,
    promoteBondOrder,
    changeAtomElements,
    replaceForceHydrogenWithDrawElement
  };
}
