import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ReactionPreviewPolicy, ResonancePolicy, SnapshotPolicy, ViewportPolicy } from '../../../src/app/core/editor-actions.js';
import { repairImplicitHydrogensWhenValenceImproves } from '../../../src/app/interactions/implicit-hydrogen-repair.js';
import { createStructuralEditActions } from '../../../src/app/interactions/structural-edit-actions.js';
import { Molecule } from '../../../src/core/Molecule.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { refreshAromaticity } from '../../../src/algorithms/aromaticity.js';
import { generateAndRefine2dCoords } from '../../../src/layout/index.js';
import { kekulize, syncDisplayStereo } from '../../../src/layout/mol2d-helpers.js';
import { validateValence } from '../../../src/validation/index.js';

function makeAtom(id, name) {
  return {
    id,
    name,
    bonds: [],
    properties: { aromatic: false, charge: 0 },
    getCharge() {
      return this.properties.charge ?? 0;
    },
    getNeighbors(mol) {
      return this.bonds
        .map(bondId => mol.bonds.get(bondId))
        .filter(Boolean)
        .map(bond => mol.atoms.get(bond.getOtherAtom(id)))
        .filter(Boolean);
    }
  };
}

function makeBond(id, atomId1, atomId2, properties = {}) {
  return {
    id,
    atoms: [atomId1, atomId2],
    properties: { order: 1, aromatic: false, ...properties },
    setStereo(value) {
      this.properties.stereo = value;
    },
    setAromatic(value) {
      this.properties.aromatic = value;
      this.properties.order = value ? 1.5 : 1;
    },
    setOrder(value) {
      this.properties.order = value;
      this.properties.aromatic = false;
    },
    getAtomObjects(mol) {
      return [mol.atoms.get(atomId1) ?? null, mol.atoms.get(atomId2) ?? null];
    },
    getOtherAtom(atomId) {
      if (atomId === atomId1) {
        return atomId2;
      }
      if (atomId === atomId2) {
        return atomId1;
      }
      return null;
    }
  };
}

function attachBond(mol, bond) {
  mol.bonds.set(bond.id, bond);
  mol.atoms.get(bond.atoms[0]).bonds.push(bond.id);
  mol.atoms.get(bond.atoms[1]).bonds.push(bond.id);
}

function makeBaseContext(overrides = {}) {
  const calls = [];
  const activeMol = overrides.activeMol ?? null;
  const simulation = overrides.simulation ?? {
    nodes: () => [],
    force: () => ({ links: () => [] }),
    on() {},
    alpha() {
      return this;
    },
    restart() {
      return this;
    }
  };

  const context = {
    controller: {
      performStructuralEdit: (...args) => {
        calls.push(['performStructuralEdit', ...args]);
        return undefined;
      }
    },
    getMode: () => overrides.mode ?? '2d',
    getDrawBondElement: () => overrides.drawBondElement ?? 'N',
    molecule: {
      getActive: () => overrides.liveMol ?? activeMol,
      getCurrentForceMol: () => activeMol
    },
    view: {
      captureZoomTransformSnapshot: () => 'zoom-snapshot',
      getZoomTransform: () => overrides.zoomTransform ?? { x: 0, y: 0, k: 1 },
      restoreZoomTransformSnapshot: snapshot => {
        calls.push(['restoreZoomTransformSnapshot', snapshot]);
      },
      zoomToFitIf2d: options => {
        calls.push(['zoomToFitIf2d', options]);
      }
    },
    resonance: {
      prepareResonanceStateForStructuralEdit: mol => ({ mol, resonanceReset: false, resonanceCleared: false })
    },
    chemistry: {
      kekulize: mol => {
        calls.push(['kekulize', mol]);
      },
      refreshAromaticity: (mol, options) => {
        calls.push(['refreshAromaticity', mol, options]);
      }
    },
    force: {
      getSimulation: () => simulation,
      isHydrogenNode: node => node?.name === 'H',
      placeHydrogensAroundParent: (...args) => {
        calls.push(['placeHydrogensAroundParent', ...args]);
      },
      patchNodePositions: (patchPos, options = {}) => {
        calls.push(['patchNodePositions', patchPos, options]);
      },
      reseatHydrogensAroundPatched: patchPos => {
        calls.push(['reseatHydrogensAroundPatched', patchPos]);
      }
    },
    constants: {
      forceBondLength: overrides.forceBondLength ?? 30
    }
  };

  return { calls, context: { ...context, ...overrides.context } };
}

describe('createStructuralEditActions', () => {
  it('restores the saved reaction-entry zoom before any other 2D viewport handling', () => {
    const { context, calls } = makeBaseContext();
    const actions = createStructuralEditActions(context);

    actions.restore2dEditViewport('zoom-snapshot', {
      reactionRestored: true,
      reactionEntryZoomSnapshot: 'reaction-entry-zoom',
      resonanceReset: true,
      zoomToFit: true
    });

    assert.deepEqual(calls, [['restoreZoomTransformSnapshot', 'reaction-entry-zoom']]);
  });

  it('checks 2D fit after restoring reaction-entry zoom when a reaction edit requests it', () => {
    const { context, calls } = makeBaseContext();
    const actions = createStructuralEditActions(context);

    actions.restore2dEditViewport('zoom-snapshot', {
      reactionRestored: true,
      reactionEntryZoomSnapshot: 'reaction-entry-zoom',
      zoomToFit: { pad: 0 }
    });

    assert.deepEqual(calls, [
      ['restoreZoomTransformSnapshot', 'reaction-entry-zoom'],
      ['zoomToFitIf2d', { pad: 0 }]
    ]);
  });

  it('auto-fits 2D edits that exit resonance mode instead of restoring the locked resonance zoom', () => {
    const { context, calls } = makeBaseContext();
    const actions = createStructuralEditActions(context);

    actions.restore2dEditViewport('zoom-snapshot', {
      resonanceReset: true
    });

    assert.deepEqual(calls, [['zoomToFitIf2d', { force: true }]]);
  });

  it('restores normal 2D edit zoom before checking whether the result needs fitting', () => {
    const { context, calls } = makeBaseContext();
    const actions = createStructuralEditActions(context);

    actions.restore2dEditViewport('zoom-snapshot', {
      zoomToFit: true
    });

    assert.deepEqual(calls, [
      ['restoreZoomTransformSnapshot', 'zoom-snapshot'],
      ['zoomToFitIf2d', undefined]
    ]);
  });

  it('passes structured 2D fit options through after restoring the edit zoom', () => {
    const { context, calls } = makeBaseContext();
    const actions = createStructuralEditActions(context);

    actions.restore2dEditViewport('zoom-snapshot', {
      zoomToFit: { pad: 0 }
    });

    assert.deepEqual(calls, [
      ['restoreZoomTransformSnapshot', 'zoom-snapshot'],
      ['zoomToFitIf2d', { pad: 0 }]
    ]);
  });

  it('passes an already-prepared resonance reset through skipped bond promotion prep', () => {
    const { context, calls } = makeBaseContext();
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder('b1', {
      skipResonancePrep: true,
      resonanceReset: true
    });

    const [, options] = calls[0].slice(1);
    assert.equal(options.resonanceReset, true);
    assert.equal(options.resonancePolicy, ResonancePolicy.preserve);
    assert.equal(options.viewportPolicy, ViewportPolicy.restoreEdit);
  });

  it('falls back to the active molecule when resonance prep resets the live view', () => {
    const liveMol = { id: 'live-mol' };
    const { context } = makeBaseContext({
      activeMol: liveMol,
      liveMol,
      context: {
        resonance: {
          prepareResonanceStateForStructuralEdit: () => ({
            mol: null,
            resonanceReset: true,
            resonanceCleared: false
          })
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.prepareResonanceStructuralEdit({ id: 'stale-mol' });

    assert.deepEqual(result, { mol: liveMol, resonanceReset: true });
  });

  it('places a carbon ring template through a structural edit', () => {
    const mol = new Molecule();
    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(5, 600, 200);

    assert.equal(result.performed, true);
    assert.equal(result.result.twoD.drawOnly, true);
    assert.deepEqual(result.result.twoD.zoomToFit, { pad: 0 });
    assert.equal(result.result.restorePrimitiveHover, undefined);
    assert.equal(result.result.clearPrimitiveHover, true);
    const carbons = [...mol.atoms.values()].filter(atom => atom.name === 'C');
    const hydrogens = [...mol.atoms.values()].filter(atom => atom.name === 'H');
    assert.equal(carbons.length, 5);
    assert.equal(hydrogens.length, 10);
    assert.deepEqual(
      carbons.map(atom => atom.id).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
      ['C1', 'C2', 'C3', 'C4', 'C5']
    );
    assert.ok(hydrogens.every(atom => /^H\d+$/.test(atom.id)));
    assert.equal(mol.bonds.size, 15);
    assert.ok(carbons.every(atom => Number.isFinite(atom.x) && Number.isFinite(atom.y)));
    assert.ok(hydrogens.every(atom => atom.visible === false));
  });

  it('uses an explicit start angle for free ring-template placement', () => {
    const mol = new Molecule();
    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(4, 600, 200, { ringStartAngle: 0 });
    const firstCarbon = mol.atoms.get('C1');

    assert.equal(result.performed, true);
    assert.ok(firstCarbon.x > 7.5);
    assert.ok(Math.abs(firstCarbon.y) < 1e-12);
  });

  it('uses the configured layout bond length for 2D ring-template placement', () => {
    const mol = new Molecule();
    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        options: {
          getRenderOptions: () => ({ layoutBondLength: 2 })
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 600, 200);

    const [firstId, secondId] = result.result.ringAtomIds;
    const first = mol.atoms.get(firstId);
    const second = mol.atoms.get(secondId);
    assert.ok(Math.abs(Math.hypot(first.x - second.x, first.y - second.y) - 2) < 1e-9);
  });

  it('uses the configured layout bond length for 2D bond-anchored ring-template placement', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 2;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        options: {
          getRenderOptions: () => ({ layoutBondLength: 2 })
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    const ringAtomIds = new Set(result.result.ringAtomIds);
    const ringBonds = [...mol.bonds.values()].filter(bond => ringAtomIds.has(bond.atoms[0]) && ringAtomIds.has(bond.atoms[1]));
    for (const bond of ringBonds) {
      const [first, second] = bond.getAtomObjects(mol);
      assert.ok(Math.abs(Math.hypot(first.x - second.x, first.y - second.y) - 2) < 1e-9);
    }
    assert.equal(result.result.ringAtomIds.length, 6);
  });

  it('places the benzene ring template as an alternating six-member ring', () => {
    const mol = new Molecule();
    const { context, calls } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate('benzene', 600, 200);

    assert.equal(result.performed, true);
    assert.equal(result.result.ringAtomIds.length, 6);
    const ringAtomIdSet = new Set(result.result.ringAtomIds);
    const carbons = [...mol.atoms.values()].filter(atom => atom.name === 'C');
    const hydrogens = [...mol.atoms.values()].filter(atom => atom.name === 'H');
    const ringBonds = [...mol.bonds.values()].filter(bond => ringAtomIdSet.has(bond.atoms[0]) && ringAtomIdSet.has(bond.atoms[1]));
    const ringBondOrders = ringBonds.map(bond => bond.properties.order);

    assert.equal(carbons.length, 6);
    assert.equal(hydrogens.length, 6);
    assert.equal(ringBonds.length, 6);
    assert.equal(ringBondOrders.filter(order => order === 2).length, 3);
    assert.equal(ringBondOrders.filter(order => order === 1).length, 3);
    assert.equal(mol.bonds.size, 12);
    assert.ok(calls.some(call => call[0] === 'kekulize'));
    assert.equal(
      calls.some(call => call[0] === 'refreshAromaticity'),
      false
    );
  });

  it('uses a clicked existing atom as one vertex of a regular ring template', () => {
    const mol = new Molecule();
    const anchor = mol.addAtom(null, 'C');
    anchor.x = 0;
    anchor.y = 0;
    const substituent = mol.addAtom(null, 'C');
    substituent.x = -1.5;
    substituent.y = 0;
    mol.addBond(null, anchor.id, substituent.id, { order: 1 });

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, { anchorAtomId: anchor.id });

    assert.equal(result.performed, true);
    assert.equal(result.result.twoD.drawOnly, true);
    assert.deepEqual(result.result.twoD.zoomToFit, { pad: 0 });
    const ringAtomIds = result.result.ringAtomIds;
    assert.equal(ringAtomIds.length, 6);
    assert.equal(ringAtomIds[0], anchor.id);
    assert.equal(mol.atoms.size, 21);
    assert.equal(mol.bonds.size, 21);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 7);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'H' && atom.visible === false).length, 14);

    const edgeLengths = ringAtomIds.map((atomId, index) => {
      const atom = mol.atoms.get(atomId);
      const next = mol.atoms.get(ringAtomIds[(index + 1) % ringAtomIds.length]);
      return Math.hypot(atom.x - next.x, atom.y - next.y);
    });
    assert.ok(edgeLengths.every(length => Math.abs(length - 1.5) < 1e-6));
    const newRingAtoms = ringAtomIds.slice(1).map(atomId => mol.atoms.get(atomId));
    assert.ok(
      newRingAtoms.every(atom => atom.x > -0.001),
      'expected the ring to be placed away from the existing left-side substituent'
    );
  });

  it('strips pendant hydrogens from OH and NH2 atoms reused as ring-template vertices', () => {
    const makePlacementContext = mol =>
      makeBaseContext({
        activeMol: mol,
        context: {
          plot: {
            getSize: () => ({ width: 600, height: 400 })
          },
          view2D: {
            getCenterX: () => 0,
            getCenterY: () => 0
          },
          constants: {
            forceBondLength: 30,
            scale: 40,
            forceScale: 25
          },
          controller: {
            performStructuralEdit(_kind, options, mutate) {
              const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
              assert.equal(options.preflight(editContext), true);
              const result = mutate(editContext);
              return { performed: true, result, mol };
            }
          }
        }
      }).context;
    const hydrogenNeighborCount = (mol, atom) => atom.getNeighbors(mol).filter(neighbor => neighbor.name === 'H').length;

    const alcohol = new Molecule();
    const methyl = alcohol.addAtom(null, 'C');
    methyl.x = -1.5;
    methyl.y = 0;
    const oxygen = alcohol.addAtom(null, 'O');
    oxygen.x = 0;
    oxygen.y = 0;
    alcohol.addBond(null, methyl.id, oxygen.id, { order: 1 });
    assert.equal(hydrogenNeighborCount(alcohol, oxygen), 1);

    const alcoholActions = createStructuralEditActions(makePlacementContext(alcohol));
    const alcoholResult = alcoholActions.placeRingTemplate(6, 300, 200, { anchorAtomId: oxygen.id });

    assert.equal(alcoholResult.performed, true);
    assert.equal(hydrogenNeighborCount(alcohol, oxygen), 0);

    const phenoxyLikeAlcohol = new Molecule();
    const phenoxyCarbon = phenoxyLikeAlcohol.addAtom(null, 'C');
    phenoxyCarbon.x = -1.5;
    phenoxyCarbon.y = 0;
    const phenoxyOxygen = phenoxyLikeAlcohol.addAtom(null, 'O');
    phenoxyOxygen.x = 0;
    phenoxyOxygen.y = 0;
    phenoxyLikeAlcohol.addBond(null, phenoxyCarbon.id, phenoxyOxygen.id, { order: 1 });
    assert.equal(hydrogenNeighborCount(phenoxyLikeAlcohol, phenoxyOxygen), 1);

    const phenoxyActions = createStructuralEditActions(makePlacementContext(phenoxyLikeAlcohol));
    const phenoxyResult = phenoxyActions.placeRingTemplate('benzene', 300, 200, { anchorAtomId: phenoxyOxygen.id });

    assert.equal(phenoxyResult.performed, true);
    assert.equal(hydrogenNeighborCount(phenoxyLikeAlcohol, phenoxyOxygen), 0);

    const amine = new Molecule();
    const carbon = amine.addAtom(null, 'C');
    carbon.x = -1.5;
    carbon.y = 0;
    const nitrogen = amine.addAtom(null, 'N');
    nitrogen.x = 0;
    nitrogen.y = 0;
    amine.addBond(null, carbon.id, nitrogen.id, { order: 1 });
    assert.equal(hydrogenNeighborCount(amine, nitrogen), 2);

    const amineActions = createStructuralEditActions(makePlacementContext(amine));
    const amineResult = amineActions.placeRingTemplate(6, 300, 200, { anchorAtomId: nitrogen.id });

    assert.equal(amineResult.performed, true);
    assert.equal(hydrogenNeighborCount(amine, nitrogen), 0);
  });

  it('does not place ring templates on reaction-preview product-side anchors', () => {
    const mol = new Molecule();
    const reactant = mol.addAtom('reactant-a1', 'C');
    reactant.x = -2;
    reactant.y = 0;
    const productA = mol.addAtom('product-a1', 'C');
    productA.x = 2;
    productA.y = 0;
    const productB = mol.addAtom('product-a2', 'C');
    productB.x = 3.5;
    productB.y = 0;
    const productBond = mol.addBond('product-b1', productA.id, productB.id, { order: 1 });
    mol.__reactionPreview = {
      reactantAtomIds: new Set([reactant.id])
    };
    const initialAtomCount = mol.atoms.size;
    const initialBondCount = mol.bonds.size;
    let mutationCount = 0;

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), false);
            if (options.preflight(editContext)) {
              mutationCount++;
              mutate(editContext);
            }
            return { performed: false, cancelled: true };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const atomResult = actions.placeRingTemplate(6, 300, 200, { anchorAtomId: productA.id });
    const bondResult = actions.placeRingTemplate(6, 300, 200, { anchorBondId: productBond.id });

    assert.deepEqual(atomResult, { performed: false, cancelled: true });
    assert.deepEqual(bondResult, { performed: false, cancelled: true });
    assert.equal(mutationCount, 0);
    assert.equal(mol.atoms.size, initialAtomCount);
    assert.equal(mol.bonds.size, initialBondCount);
  });

  it('prepares reaction-preview targets before placing ring templates', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom('a1', 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom('a2', 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const bond = mol.addBond('b1', atomA.id, atomB.id, { order: 1 });
    const captured = [];

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured.push({ kind, options });
            const editContext = { mol, mode: '2d', reactionEdit: { restored: true }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            return { performed: true, result: mutate(editContext), mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.placeRingTemplate(6, 300, 200, { anchorAtomId: atomA.id });
    actions.placeRingTemplate(6, 300, 200, { anchorBondId: bond.id });

    assert.equal(captured[0].kind, 'place-ring-template');
    assert.equal(captured[0].options.overlayPolicy, ReactionPreviewPolicy.prepareEditTargets);
    assert.deepEqual(captured[0].options.reactionPreviewPayload, { atomId: atomA.id });
    assert.equal(captured[1].kind, 'place-ring-template');
    assert.equal(captured[1].options.overlayPolicy, ReactionPreviewPolicy.prepareBondTarget);
    assert.equal(captured[1].options.reactionPreviewPayload, bond.id);
  });

  it('uses an explicit snapped orientation when placing an anchored ring template', () => {
    const mol = new Molecule();
    const anchor = mol.addAtom(null, 'C');
    anchor.x = 0;
    anchor.y = 0;

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, {
      anchorAtomId: anchor.id,
      anchorCenterAngle: 0
    });

    assert.equal(result.performed, true);
    assert.equal(result.result.twoD.drawOnly, true);
    assert.deepEqual(result.result.twoD.zoomToFit, { pad: 0 });
    const ringAtomIds = result.result.ringAtomIds;
    const newRingAtoms = ringAtomIds.slice(1).map(atomId => mol.atoms.get(atomId));
    assert.ok(
      newRingAtoms.every(atom => atom.x > 0.7),
      'expected the oriented ring to extend to the right of the anchor'
    );
  });

  it('reuses overlapped existing atoms and bonds when placing an anchored ring template', () => {
    const mol = new Molecule();
    const anchor = mol.addAtom(null, 'C');
    anchor.x = 0;
    anchor.y = 0;
    const fusedAtom = mol.addAtom(null, 'C');
    fusedAtom.x = 0.75;
    fusedAtom.y = -1.299038105676658;
    const fusedBond = mol.addBond(null, anchor.id, fusedAtom.id, { order: 1 });

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, {
      anchorAtomId: anchor.id,
      anchorCenterAngle: 0
    });

    assert.equal(result.performed, true);
    const ringAtomIds = result.result.ringAtomIds;
    assert.equal(ringAtomIds.length, 6);
    assert.deepEqual(ringAtomIds.slice(0, 2), [anchor.id, fusedAtom.id]);
    assert.equal(mol.getBond(anchor.id, fusedAtom.id).id, fusedBond.id);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 6);
    assert.equal([...mol.bonds.values()].filter(bond => bond.atoms.includes(anchor.id) && bond.atoms.includes(fusedAtom.id)).length, 1);
    for (let index = 0; index < ringAtomIds.length; index++) {
      assert.ok(mol.getBond(ringAtomIds[index], ringAtomIds[(index + 1) % ringAtomIds.length]));
    }
  });

  it('uses a clicked existing bond as one edge of a ring template', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    assert.equal(result.performed, true);
    assert.equal(result.result.twoD.drawOnly, true);
    assert.deepEqual(result.result.twoD.zoomToFit, { pad: 0 });
    assert.equal(mol.getBond(atomA.id, atomB.id).id, anchorBond.id);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 6);
    assert.equal([...mol.bonds.values()].filter(bond => bond.atoms.includes(atomA.id) && bond.atoms.includes(atomB.id)).length, 1);
    const ringAtomIds = result.result.ringAtomIds;
    assert.equal(ringAtomIds.length, 6);
    assert.deepEqual(ringAtomIds.slice(0, 2), [atomA.id, atomB.id]);
    assert.equal(
      ringAtomIds.slice(2).every(atomId => mol.atoms.get(atomId).y > 0),
      true
    );
    for (let index = 0; index < ringAtomIds.length; index++) {
      const atom1 = mol.atoms.get(ringAtomIds[index]);
      const atom2 = mol.atoms.get(ringAtomIds[(index + 1) % ringAtomIds.length]);
      assert.ok(mol.getBond(atom1.id, atom2.id));
      assert.ok(Math.abs(Math.hypot(atom2.x - atom1.x, atom2.y - atom1.y) - 1.5) < 1e-6);
    }
  });

  it('keeps the shared edge single when placing bond-anchored benzene', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate('benzene', 300, 200, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    assert.equal(result.performed, true);
    const ringAtomIds = result.result.ringAtomIds;
    const ringBondOrders = ringAtomIds.map((atomId, index) => mol.getBond(atomId, ringAtomIds[(index + 1) % ringAtomIds.length]).properties.order);
    const ringLocalizedOrders = ringAtomIds.map((atomId, index) => mol.getBond(atomId, ringAtomIds[(index + 1) % ringAtomIds.length]).properties.localizedOrder);
    assert.deepEqual(ringAtomIds.slice(0, 2), [atomA.id, atomB.id]);
    assert.equal(mol.getBond(atomA.id, atomB.id).id, anchorBond.id);
    assert.deepEqual(ringBondOrders, [1, 2, 1, 2, 1, 2]);
    assert.deepEqual(ringLocalizedOrders, [1, 2, 1, 2, 1, 2]);
  });

  it('preserves existing aromatic heavy bonds when placing benzene on an aromatic bond', () => {
    const mol = parseSMILES('CC(=O)C(Cl)Cc1c(C)ccc2c1cccc2');
    kekulize(mol);
    const anchorBond = mol.bonds.get('6');
    const [atomAId, atomBId] = anchorBond.atoms;
    const existingHeavyBondProperties = new Map(
      [...mol.bonds.values()]
        .filter(bond => bond.atoms.every(atomId => mol.atoms.get(atomId)?.name !== 'H'))
        .map(bond => [
          bond.id,
          {
            order: bond.properties.order,
            aromatic: bond.properties.aromatic,
            localizedOrder: bond.properties.localizedOrder
          }
        ])
    );
    mol.atoms.get(atomAId).x = 0;
    mol.atoms.get(atomAId).y = 0;
    mol.atoms.get(atomBId).x = 1.5;
    mol.atoms.get(atomBId).y = 0;

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        chemistry: {
          kekulize,
          refreshAromaticity: () => {}
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate('benzene', 300, 200, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    assert.equal(result.performed, true);
    const ringAtomIds = result.result.ringAtomIds;
    const ringLocalizedOrders = ringAtomIds.map((atomId, index) => mol.getBond(atomId, ringAtomIds[(index + 1) % ringAtomIds.length]).properties.localizedOrder);
    assert.deepEqual(ringAtomIds.slice(0, 2), anchorBond.atoms);
    assert.equal(ringLocalizedOrders[0], 1);
    assert.ok(ringLocalizedOrders.filter(order => order === 2).length >= 2);
    for (const [bondId, properties] of existingHeavyBondProperties) {
      const bond = mol.bonds.get(bondId);
      assert.ok(bond, `expected existing heavy bond ${bondId} to remain`);
      assert.equal(bond.properties.order, properties.order, `expected bond ${bondId} order to remain stable`);
      assert.equal(bond.properties.aromatic, properties.aromatic, `expected bond ${bondId} aromatic state to remain stable`);
      assert.equal(bond.properties.localizedOrder, properties.localizedOrder, `expected bond ${bondId} localized order to remain stable`);
    }
    assert.equal(
      mol.atoms
        .get(atomAId)
        .getNeighbors(mol)
        .filter(atom => atom.name === 'H').length,
      0
    );
    assert.equal(
      mol.atoms
        .get(atomBId)
        .getNeighbors(mol)
        .filter(atom => atom.name === 'H').length,
      0
    );
    assert.deepEqual(
      ringAtomIds.slice(2).map(
        atomId =>
          mol.atoms
            .get(atomId)
            .getNeighbors(mol)
            .filter(atom => atom.name === 'H' && atom.visible === false).length
      ),
      [1, 1, 1, 1]
    );
  });

  it('uses two benzene double bonds when fused double bonds keep every ring carbon sp2', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom('a0', 'C', { aromatic: true });
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom('a1', 'C', { aromatic: true });
    atomB.x = 1.5;
    atomB.y = 0;
    const externalDoubleAtom = mol.addAtom('x0', 'C', { aromatic: true });
    externalDoubleAtom.x = -1.5;
    externalDoubleAtom.y = 0;
    const secondExternalDoubleAtom = mol.addAtom('x1', 'C', { aromatic: true });
    secondExternalDoubleAtom.x = 3;
    secondExternalDoubleAtom.y = 0;
    const anchorBond = mol.addBond('anchor', atomA.id, atomB.id, { order: 1.5, aromatic: true }, false);
    Object.assign(anchorBond.properties, { localizedOrder: 1 });
    const externalDoubleBond = mol.addBond('oldDouble', atomA.id, externalDoubleAtom.id, { order: 1.5, aromatic: true }, false);
    Object.assign(externalDoubleBond.properties, { localizedOrder: 2 });
    const secondExternalDoubleBond = mol.addBond('oldDoubleB', atomB.id, secondExternalDoubleAtom.id, { order: 1.5, aromatic: true }, false);
    Object.assign(secondExternalDoubleBond.properties, { localizedOrder: 2 });

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        chemistry: {
          kekulize,
          refreshAromaticity
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate('benzene', 300, 200, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    assert.equal(result.performed, true);
    const ringAtomIds = result.result.ringAtomIds;
    const ringLocalizedOrders = ringAtomIds.map((atomId, index) => mol.getBond(atomId, ringAtomIds[(index + 1) % ringAtomIds.length]).properties.localizedOrder);
    assert.equal(ringLocalizedOrders.filter(order => order === 2).length, 2);
    assert.deepEqual(validateValence(mol), []);
  });

  it('uses three benzene double bonds instead of leaving one fused ring carbon sp3', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom('a0', 'C', { aromatic: true });
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom('a1', 'C', { aromatic: true });
    atomB.x = 1.5;
    atomB.y = 0;
    const externalDoubleAtom = mol.addAtom('x0', 'C', { aromatic: true });
    externalDoubleAtom.x = -1.5;
    externalDoubleAtom.y = 0;
    const externalSingleAtom = mol.addAtom('x1', 'C', { aromatic: true });
    externalSingleAtom.x = 3;
    externalSingleAtom.y = 0;
    const anchorBond = mol.addBond('anchor', atomA.id, atomB.id, { order: 1.5, aromatic: true }, false);
    Object.assign(anchorBond.properties, { localizedOrder: 1 });
    const externalDoubleBond = mol.addBond('oldDouble', atomA.id, externalDoubleAtom.id, { order: 1.5, aromatic: true }, false);
    Object.assign(externalDoubleBond.properties, { localizedOrder: 2 });
    const externalSingleBond = mol.addBond('oldSingle', atomB.id, externalSingleAtom.id, { order: 1.5, aromatic: true }, false);
    Object.assign(externalSingleBond.properties, { localizedOrder: 1 });

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        chemistry: {
          kekulize,
          refreshAromaticity
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate('benzene', 300, 200, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    assert.equal(result.performed, true);
    const ringAtomIds = result.result.ringAtomIds;
    const ringLocalizedOrders = ringAtomIds.map((atomId, index) => mol.getBond(atomId, ringAtomIds[(index + 1) % ringAtomIds.length]).properties.localizedOrder);
    assert.equal(ringLocalizedOrders.filter(order => order === 2).length, 3);
  });

  it('repairs new carbon hydrogens when preserving fused benzene placement in force mode', () => {
    const mol = parseSMILES('CC(=O)C(Cl)Cc1c(C)ccc2c1cccc2');
    generateAndRefine2dCoords(mol);
    kekulize(mol);
    const anchorBond = mol.bonds.get('6');
    const nodes = [...mol.atoms.values()].map(atom => ({
      id: atom.id,
      name: atom.name,
      visible: atom.visible,
      x: Number.isFinite(atom.x) ? atom.x * 25 : 0,
      y: Number.isFinite(atom.y) ? atom.y * 25 : 0
    }));

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        chemistry: {
          kekulize,
          refreshAromaticity
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        force: {
          getSimulation: () => ({
            nodes: () => nodes
          }),
          patchNodePositions() {},
          reseatHydrogensAroundPatched() {}
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate('benzene', 0, 0, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    assert.equal(result.performed, true);
    assert.deepEqual(
      result.result.ringAtomIds.slice(2).map(
        atomId =>
          mol.atoms
            .get(atomId)
            .getNeighbors(mol)
            .filter(atom => atom.name === 'H').length
      ),
      [1, 1, 1, 1]
    );
  });

  it('replaces a terminal C-H bond with a benzene attachment instead of fusing through hydrogen', () => {
    const mol = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C1=CC=CC=C1');
    generateAndRefine2dCoords(mol);
    kekulize(mol);
    const anchorBond = mol.bonds.get('28');
    const [heavyAtomId, hydrogenAtomId] = anchorBond.atoms;
    const heavyAtom = mol.atoms.get(heavyAtomId);
    const nodes = [...mol.atoms.values()].map(atom => ({
      id: atom.id,
      name: atom.name,
      visible: atom.visible,
      x: Number.isFinite(atom.x) ? atom.x * 25 : 0,
      y: Number.isFinite(atom.y) ? atom.y * 25 : 0
    }));
    const heavyNode = nodes.find(node => node.id === heavyAtomId);
    const hydrogenNode = nodes.find(node => node.id === hydrogenAtomId);
    hydrogenNode.visible = true;
    hydrogenNode.x = heavyNode.x + 30;
    hydrogenNode.y = heavyNode.y;

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        chemistry: {
          kekulize,
          refreshAromaticity
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        force: {
          getSimulation: () => ({
            nodes: () => nodes
          }),
          patchNodePositions() {},
          reseatHydrogensAroundPatched() {}
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate('benzene', hydrogenNode.x, hydrogenNode.y, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    assert.equal(result.performed, true);
    assert.equal(mol.atoms.get(hydrogenAtomId).name, 'C');
    assert.equal(mol.getBond(heavyAtom.id, hydrogenAtomId).id, anchorBond.id);
    assert.equal(mol.getBond(heavyAtom.id, hydrogenAtomId).properties.order, 1);
    assert.deepEqual(result.result.ringAtomIds[0], hydrogenAtomId);
    assert.deepEqual(validateValence(mol), []);
  });

  it('does not reuse incidental overlap atoms when placing a bond-anchored ring template', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });
    const incidentalAtom = mol.addAtom(null, 'C');
    incidentalAtom.x = 2.25;
    incidentalAtom.y = 1.299038105676658;

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, { anchorBondId: anchorBond.id, anchorBondSide: -1 });

    assert.equal(result.performed, true);
    assert.equal(result.result.ringAtomIds.length, 6);
    assert.equal(result.result.ringAtomIds.includes(incidentalAtom.id), false);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 7);
    assert.equal(result.result.ringAtomIds.slice(2).length, 4);
  });

  it('auto-fuses clicked bond-anchored ring templates when overlap includes an existing bond edge', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });
    const fusedAtom = mol.addAtom(null, 'C');
    fusedAtom.x = 2.25;
    fusedAtom.y = 1.299038105676658;
    const fusedBond = mol.addBond(null, atomB.id, fusedAtom.id, { order: 1 });

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, {
      anchorBondId: anchorBond.id,
      anchorBondSide: -1,
      autoFuseBondPositionReuse: true
    });

    assert.equal(result.performed, true);
    assert.equal(result.result.ringAtomIds.length, 6);
    assert.equal(result.result.ringAtomIds.includes(fusedAtom.id), true);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 6);
    assert.equal(mol.getBond(atomB.id, fusedAtom.id).id, fusedBond.id);
    assert.equal([...mol.bonds.values()].filter(bond => bond.atoms.includes(atomB.id) && bond.atoms.includes(fusedAtom.id)).length, 1);
  });

  it('reuses overlapped atoms for an explicitly dragged bond-anchored ring template', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });
    const fusedAtom = mol.addAtom(null, 'C');
    fusedAtom.x = 2.25;
    fusedAtom.y = 1.299038105676658;

    const { context } = makeBaseContext({
      activeMol: mol,
      context: {
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        view2D: {
          getCenterX: () => 0,
          getCenterY: () => 0
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        },
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, {
      anchorBondId: anchorBond.id,
      anchorBondSide: -1,
      allowBondPositionReuse: true
    });

    assert.equal(result.performed, true);
    assert.equal(result.result.ringAtomIds.length, 6);
    assert.equal(result.result.ringAtomIds.includes(fusedAtom.id), true);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 6);
    assert.equal(mol.getBond(atomB.id, fusedAtom.id)?.atoms.includes(fusedAtom.id), true);
  });

  it('uses the effective preview edge length for force bond-anchored ring templates', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });
    const nodes = [
      { id: atomA.id, name: 'C', x: 0, y: 0 },
      { id: atomB.id, name: 'C', x: 20, y: 0 }
    ];

    const { context } = makeBaseContext({
      activeMol: mol,
      mode: 'force',
      simulation: {
        nodes: () => nodes,
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, { anchorBondId: anchorBond.id, anchorBondSide: 1 });

    assert.equal(result.performed, true);
    const patchPos = result.result.force.options.initialPatchPos;
    const anchorPositionA = patchPos.get(atomA.id);
    const anchorPositionB = patchPos.get(atomB.id);
    assert.ok(Math.abs(Math.hypot(anchorPositionB.x - anchorPositionA.x, anchorPositionB.y - anchorPositionA.y) - 30) < 1e-6);
    assert.ok(Math.abs((anchorPositionA.x + anchorPositionB.x) / 2 - 10) < 1e-6);
    assert.ok(Math.abs((anchorPositionA.y + anchorPositionB.y) / 2) < 1e-6);
  });

  it('merges source force positions when atom-anchored ring placement exits resonance view', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    mol.addBond(null, atomA.id, atomB.id, { order: 1 });
    const nodes = [
      { id: atomA.id, name: 'C', x: 100, y: 80 },
      { id: atomB.id, name: 'C', x: 145, y: 80 },
      { id: '__resonance_product__:a1', name: 'C', x: 310, y: 80 }
    ];

    const { context } = makeBaseContext({
      activeMol: mol,
      mode: 'force',
      simulation: {
        nodes: () => nodes,
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: true };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 100, 80, { anchorAtomId: atomA.id });

    assert.equal(result.performed, true);
    const patchPos = result.result.force.options.initialPatchPos;
    assert.equal(patchPos.has(atomA.id), true);
    assert.equal(patchPos.has(atomB.id), true);
    assert.equal(patchPos.has('__resonance_product__:a1'), false);
    assert.deepEqual(patchPos.get(atomA.id), { x: 100, y: 80 });
    assert.deepEqual(patchPos.get(atomB.id), { x: 145, y: 80 });
    assert.ok(result.result.ringAtomIds.some(atomId => atomId !== atomA.id && patchPos.has(atomId)));
  });

  it('reuses overlapped force nodes for an explicitly dragged force bond-anchored ring template', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });
    const fusedAtom = mol.addAtom(null, 'C');
    fusedAtom.x = 99;
    fusedAtom.y = 99;
    const forceBondLength = 30;
    const fusedForceX = 10 + forceBondLength;
    const fusedForceY = (forceBondLength * Math.sqrt(3)) / 2;
    const nodes = [
      { id: atomA.id, name: 'C', x: 0, y: 0 },
      { id: atomB.id, name: 'C', x: 20, y: 0 },
      { id: fusedAtom.id, name: 'C', x: fusedForceX, y: fusedForceY }
    ];

    const { context } = makeBaseContext({
      activeMol: mol,
      mode: 'force',
      simulation: {
        nodes: () => nodes,
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, {
      anchorBondId: anchorBond.id,
      anchorBondSide: 1,
      allowBondPositionReuse: true
    });

    assert.equal(result.performed, true);
    assert.equal(result.result.ringAtomIds.length, 6);
    assert.equal(result.result.ringAtomIds.includes(fusedAtom.id), true);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 6);
    assert.ok(mol.getBond(atomB.id, fusedAtom.id));
    const fusedPatchPosition = result.result.force.options.initialPatchPos.get(fusedAtom.id);
    assert.ok(Math.abs(fusedPatchPosition.x - fusedForceX) < 1e-6);
    assert.ok(Math.abs(fusedPatchPosition.y - fusedForceY) < 1e-6);
  });

  it('auto-fuses clicked force bond-anchored ring templates using force preview positions', () => {
    const mol = new Molecule();
    const atomA = mol.addAtom(null, 'C');
    atomA.x = 0;
    atomA.y = 0;
    const atomB = mol.addAtom(null, 'C');
    atomB.x = 1.5;
    atomB.y = 0;
    const anchorBond = mol.addBond(null, atomA.id, atomB.id, { order: 1 });
    const fusedAtom = mol.addAtom(null, 'C');
    fusedAtom.x = 99;
    fusedAtom.y = 99;
    const fusedBond = mol.addBond(null, atomB.id, fusedAtom.id, { order: 1 });
    const forceBondLength = 30;
    const fusedForceX = 10 + forceBondLength;
    const fusedForceY = (forceBondLength * Math.sqrt(3)) / 2;
    const nodes = [
      { id: atomA.id, name: 'C', x: 0, y: 0 },
      { id: atomB.id, name: 'C', x: 20, y: 0 },
      { id: fusedAtom.id, name: 'C', x: fusedForceX, y: fusedForceY }
    ];

    const { context } = makeBaseContext({
      activeMol: mol,
      mode: 'force',
      simulation: {
        nodes: () => nodes,
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200, {
      anchorBondId: anchorBond.id,
      autoFuseBondPositionReuse: true
    });

    assert.equal(result.performed, true);
    assert.equal(result.result.ringAtomIds.includes(fusedAtom.id), true);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 6);
    assert.equal(mol.getBond(atomB.id, fusedAtom.id).id, fusedBond.id);
    const fusedPatchPosition = result.result.force.options.initialPatchPos.get(fusedAtom.id);
    assert.ok(Math.abs(fusedPatchPosition.x - fusedForceX) < 1e-6);
    assert.ok(Math.abs(fusedPatchPosition.y - fusedForceY) < 1e-6);
  });

  it('does not reuse incidental single force overlaps for atom-anchored ring templates', () => {
    const mol = new Molecule();
    const anchor = mol.addAtom(null, 'C');
    anchor.x = 0;
    anchor.y = 0;
    const storedCoordOverlap = mol.addAtom(null, 'C');
    storedCoordOverlap.x = 0.75;
    storedCoordOverlap.y = -1.299038105676658;
    const forceOnlyOverlap = mol.addAtom(null, 'C');
    forceOnlyOverlap.x = 99;
    forceOnlyOverlap.y = 99;
    const forceBondLength = 30;
    const forceOverlapPosition = {
      x: forceBondLength * 0.5,
      y: (-forceBondLength * Math.sqrt(3)) / 2
    };
    const nodes = [
      { id: anchor.id, name: 'C', x: 0, y: 0 },
      { id: storedCoordOverlap.id, name: 'C', x: 300, y: 300 },
      { id: forceOnlyOverlap.id, name: 'C', x: forceOverlapPosition.x, y: forceOverlapPosition.y }
    ];

    const { context } = makeBaseContext({
      activeMol: mol,
      mode: 'force',
      simulation: {
        nodes: () => nodes,
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 0, 0, {
      anchorAtomId: anchor.id,
      anchorCenterAngle: 0,
      anchorForceCenterAngle: 0
    });

    assert.equal(result.performed, true);
    assert.equal(result.result.ringAtomIds.includes(storedCoordOverlap.id), false);
    assert.equal(result.result.ringAtomIds.includes(forceOnlyOverlap.id), false);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 8);
  });

  it('reuses only existing-edge force overlaps for atom-anchored ring templates', () => {
    const mol = new Molecule();
    const anchor = mol.addAtom(null, 'C');
    anchor.x = 0;
    anchor.y = 0;
    const fusedAtom = mol.addAtom(null, 'C');
    fusedAtom.x = 99;
    fusedAtom.y = 99;
    const fusedBond = mol.addBond(null, anchor.id, fusedAtom.id, { order: 1 });
    const storedCoordOverlap = mol.addAtom(null, 'C');
    storedCoordOverlap.x = 0.75;
    storedCoordOverlap.y = -1.299038105676658;
    const forceBondLength = 30;
    const forceOverlapPosition = {
      x: forceBondLength * 0.5,
      y: (-forceBondLength * Math.sqrt(3)) / 2
    };
    const nodes = [
      { id: anchor.id, name: 'C', x: 0, y: 0 },
      { id: fusedAtom.id, name: 'C', x: forceOverlapPosition.x, y: forceOverlapPosition.y },
      { id: storedCoordOverlap.id, name: 'C', x: 300, y: 300 }
    ];

    const { context } = makeBaseContext({
      activeMol: mol,
      mode: 'force',
      simulation: {
        nodes: () => nodes,
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 0, 0, {
      anchorAtomId: anchor.id,
      anchorCenterAngle: 0,
      anchorForceCenterAngle: 0
    });

    assert.equal(result.performed, true);
    assert.equal(result.result.ringAtomIds.includes(fusedAtom.id), true);
    assert.equal(result.result.ringAtomIds.includes(storedCoordOverlap.id), false);
    assert.equal(mol.getBond(anchor.id, fusedAtom.id).id, fusedBond.id);
    assert.equal([...mol.atoms.values()].filter(atom => atom.name === 'C').length, 7);
  });

  it('enables force keep-in-view after placing a force-mode ring template', () => {
    const mol = new Molecule();
    const { calls, context } = makeBaseContext({
      activeMol: mol,
      mode: 'force',
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 300, 200);

    assert.equal(result.performed, true);
    assert.equal(result.result.force.options.preserveView, true);
    assert.equal(result.result.force.options.restartSimulation, false);
    assert.equal(result.result.force.enableKeepInView, false);
    const ringAtomIds = result.result.ringAtomIds;
    const patchPos = result.result.force.options.initialPatchPos;
    const firstPosition = patchPos.get(ringAtomIds[0]);
    const secondPosition = patchPos.get(ringAtomIds[1]);
    assert.ok(Math.abs(Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y) - 30) < 1e-6);

    result.result.force.afterRender();

    const patchCall = calls.find(([kind]) => kind === 'patchNodePositions');
    assert.deepEqual(patchCall, ['patchNodePositions', patchPos, { alpha: 0, restart: false }]);
  });

  it('refits force-mode ring placement when committed ring atoms fall outside the viewport', () => {
    const mol = new Molecule();
    const { context } = makeBaseContext({
      activeMol: mol,
      mode: 'force',
      zoomTransform: { x: 0, y: 0, k: 1 },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { restored: false }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            const result = mutate(editContext);
            return { performed: true, result, mol };
          }
        },
        plot: {
          getSize: () => ({ width: 600, height: 400 })
        },
        constants: {
          forceBondLength: 30,
          scale: 40,
          forceScale: 25
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.placeRingTemplate(6, 590, 200);

    assert.equal(result.performed, true);
    assert.equal(result.result.force.options.preserveView, false);
    assert.equal(result.result.force.options.restartSimulation, true);
    assert.equal(result.result.force.enableKeepInView, true);
  });

  it('cycles aromatic bond promotion through the extracted structural-edit action', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'N');
    atom1.properties.aromatic = true;
    atom2.properties.aromatic = true;
    const bond = makeBond('b1', 'a1', 'a2', { order: 2, aromatic: true, localizedOrder: 2 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };
    attachBond(mol, bond);

    let captured = null;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(captured.kind, 'promote-bond-order');
    assert.equal(captured.options.overlayPolicy, ReactionPreviewPolicy.preserve);
    assert.equal(captured.options.resonancePolicy, ResonancePolicy.preserve);
    assert.equal(captured.options.snapshotPolicy, SnapshotPolicy.skip);
    assert.equal(captured.options.viewportPolicy, ViewportPolicy.restoreEdit);
    assert.equal(bond.properties.order, 3);
    assert.equal(bond.properties.aromatic, false);
    assert.equal('localizedOrder' in bond.properties, false);
    assert.equal(atom1.properties.aromatic, false);
    assert.equal(atom2.properties.aromatic, false);
    assert.equal(result.clearPrimitiveHover, true);
    assert.equal(result.suppressDrawBondHover, true);
  });

  it('does not restore primitive hover after promoting a bond from reaction preview', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({
              mol,
              mode: '2d',
              reactionEdit: {
                bondId: 'b1',
                restored: true
              }
            });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1');

    assert.equal(result.clearPrimitiveHover, true);
    assert.equal(result.suppressDrawBondHover, true);
    assert.equal(result.restorePrimitiveHover, undefined);
  });

  it('does not restore primitive hover after promoting a bond from resonance mode', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({
              mol,
              mode: '2d',
              reactionEdit: { bondId: 'b1', restored: false },
              resonanceReset: true
            });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1');

    assert.equal(result.clearPrimitiveHover, true);
    assert.equal(result.suppressDrawBondHover, true);
    assert.equal(result.restorePrimitiveHover, undefined);
  });

  it('rejects resonance product-side bonds before promotion preflight mutates resonance', () => {
    const atom1 = makeAtom('__resonance_product__:a1', 'C');
    const atom2 = makeAtom('__resonance_product__:a2', 'O');
    const bond = makeBond('__resonance_product__:b1', atom1.id, atom2.id, { order: 1 });
    const mol = {
      atoms: new Map([
        [atom1.id, atom1],
        [atom2.id, atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);
    let preflightResult = null;

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options) {
            preflightResult = options.preflight({
              mol,
              mode: 'force',
              reactionEdit: {
                bondId: bond.id,
                restored: false
              }
            });
            return preflightResult ? { unexpected: true } : undefined;
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder(bond.id);

    assert.equal(preflightResult, false);
    assert.equal(result, undefined);
    assert.equal(bond.properties.order, 1);
  });

  it('keeps normal promotion cycling when single bond draw mode is selected', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder('b1', {
      drawBondType: 'single',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(bond.properties.order, 2);
    assert.equal(bond.properties.aromatic, false);
  });

  it('does not repair implicit hydrogens for charged atoms when promoting a bond order', () => {
    const atom1 = makeAtom('a1', 'N');
    atom1.properties.charge = 1;
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    let repairedHydrogens = null;
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens(affected) {
        repairedHydrogens = affected;
      }
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder('b1', {
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(repairedHydrogens, null);
  });

  it('stores manual dash display metadata when explicitly applying a dash bond', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder('b1', {
      drawBondType: 'dash',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.deepEqual(bond.properties.display, {
      as: 'dash',
      centerId: 'a1',
      manual: true
    });
    assert.equal(bond.properties.order, 1);
  });

  it('uses the larger substituent side as the manual wedge center on a clicked non-stereogenic bond', () => {
    const mol = parseSMILES('CCO');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    const oxygen = [...mol.atoms.values()].find(atom => atom.name === 'O');
    const attachedCarbon = oxygen.getNeighbors(mol).find(atom => atom.name === 'C');
    const bond = [...mol.bonds.values()].find(currentBond => currentBond.connects(oxygen.id, attachedCarbon.id));

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder(bond.id, {
      drawBondType: 'wedge',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.deepEqual(bond.properties.display, {
      as: 'wedge',
      centerId: attachedCarbon.id,
      manual: true
    });
  });

  it('treats applying double to an existing double bond as a no-op', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'O');
    const bond = makeBond('b1', 'a1', 'a2', { order: 2 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map()
    };
    attachBond(mol, bond);

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: '2d', reactionEdit: null });
            if (preflightResult === false) {
              return { cancelled: true };
            }
            mutateCalled = true;
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      drawBondType: 'double',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(result.cancelled, true);
    assert.equal(mutateCalled, false);
    assert.equal(bond.properties.order, 2);
  });

  it('treats applying triple to an existing triple bond as a no-op', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'N');
    const bond = makeBond('b1', 'a1', 'a2', { order: 3 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map()
    };
    attachBond(mol, bond);

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: '2d', reactionEdit: null });
            if (preflightResult === false) {
              return { cancelled: true };
            }
            mutateCalled = true;
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      drawBondType: 'triple',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(result.cancelled, true);
    assert.equal(mutateCalled, false);
    assert.equal(bond.properties.order, 3);
  });

  it('treats applying aromatic to an existing aromatic bond as a no-op', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1.5, aromatic: true, localizedOrder: 2 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map()
    };
    attachBond(mol, bond);

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: '2d', reactionEdit: null });
            if (preflightResult === false) {
              return { cancelled: true };
            }
            mutateCalled = true;
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      drawBondType: 'aromatic',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(result.cancelled, true);
    assert.equal(mutateCalled, false);
    assert.equal(bond.properties.aromatic, true);
  });

  it('promotes a manually aromatic cyclohexane ring to aromatic atoms once all ring bonds are aromatic', () => {
    const mol = parseSMILES('C1CCCCC1');
    const ringAtomIds = mol.getRings()[0];
    const ringBonds = ringAtomIds.map((atomId, index) => mol.getBond(atomId, ringAtomIds[(index + 1) % ringAtomIds.length]));
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    for (const bond of ringBonds.slice(0, -1)) {
      actions.promoteBondOrder(bond.id, {
        drawBondType: 'aromatic',
        skipReactionPreviewPrep: true,
        skipResonancePrep: true,
        skipSnapshot: true,
        zoomSnapshot: 'zoom-snapshot'
      });
    }
    assert.equal(
      ringAtomIds.some(atomId => mol.atoms.get(atomId)?.properties.aromatic === true),
      false
    );

    actions.promoteBondOrder(ringBonds.at(-1).id, {
      drawBondType: 'aromatic',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(
      ringBonds.every(bond => bond.properties.aromatic === true && bond.properties.order === 1.5),
      true
    );
    assert.equal(
      ringAtomIds.every(atomId => mol.atoms.get(atomId)?.properties.aromatic === true),
      true
    );
  });

  it('applies the aromatic 1.5 bond type to existing force-mode bonds', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      mode: 'force',
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: 'force', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      drawBondType: 'aromatic',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(bond.properties.aromatic, true);
    assert.equal(bond.properties.order, 1.5);
    assert.equal(bond.properties.localizedOrder, undefined);
    assert.deepEqual(result.force.options, { preservePositions: true });
  });

  it('clears a manual wedge or dash display when single bond mode is selected', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'C');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1, display: { as: 'dash', manual: true, centerId: 'a1' } });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder('b1', {
      drawBondType: 'single',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(bond.properties.order, 1);
    assert.equal(bond.properties.display, undefined);
  });

  it('assigns tetrahedral chirality when applying a wedge to a real stereogenic center', () => {
    const mol = parseSMILES('CC(F)(Cl)Br');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    const center = [...mol.atoms.values()].find(atom => atom.name === 'C' && atom.getNeighbors(mol).some(neighbor => neighbor.name === 'F'));
    const fluorine = [...mol.atoms.values()].find(atom => atom.name === 'F');
    const bond = [...mol.bonds.values()].find(currentBond => currentBond.connects(center.id, fluorine.id));

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder(bond.id, {
      drawBondType: 'wedge',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.match(center.getChirality(), /^[RS]$/);
    assert.deepEqual(bond.properties.display, {
      as: 'wedge',
      manual: true,
      centerId: center.id
    });
  });

  it('allows force-mode dash edits on displayed stereochemical hydrogen bonds and updates chirality', () => {
    const mol = parseSMILES('C[C@H](F)Cl');
    const center = [...mol.atoms.values()].find(atom => atom.name === 'C' && typeof atom.getChirality === 'function' && atom.getChirality());
    const originalChirality = center.getChirality();
    const hydrogen = [...mol.atoms.values()].find(atom => atom.name === 'H' && atom.bonds.length === 1);
    const bond = mol.bonds.get(hydrogen.bonds[0]);
    bond.properties.display = { as: 'wedge', centerId: center.id };

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: 'force', reactionEdit: null });
            assert.equal(preflightResult, true);
            mutateCalled = true;
            return mutate({ mol, mode: 'force', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder(bond.id, {
      drawBondType: 'dash',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(mutateCalled, true);
    assert.deepEqual(bond.properties.display, {
      as: 'dash',
      centerId: center.id,
      manual: true
    });
    assert.notEqual(center.getChirality(), originalChirality);
  });

  it('allows force-mode wedge edits on plain hydrogens attached to potential stereocenters', () => {
    const mol = parseSMILES('CC(F)(Cl)[H]');
    generateAndRefine2dCoords(mol, { suppressH: false, bondLength: 1.5 });
    const center = [...mol.atoms.values()].find(
      atom => atom.name === 'C' && atom.getNeighbors(mol).some(neighbor => neighbor.name === 'F') && atom.getNeighbors(mol).some(neighbor => neighbor.name === 'Cl')
    );
    const hydrogen = center.getNeighbors(mol).find(neighbor => neighbor.name === 'H');
    const bond = mol.bonds.get(hydrogen.bonds.find(bondId => mol.bonds.get(bondId)?.atoms.includes(center.id)));

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: 'force', reactionEdit: null });
            assert.equal(preflightResult, true);
            mutateCalled = true;
            return mutate({ mol, mode: 'force', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder(bond.id, {
      drawBondType: 'wedge',
      preferredCenterId: center.id,
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(mutateCalled, true);
    assert.match(center.getChirality(), /^[RS]$/);
    assert.deepEqual(bond.properties.display, {
      as: 'wedge',
      centerId: center.id,
      manual: true
    });
  });

  it('allows force-mode single edits to clear auto-shown stereochemical hydrogen bonds', () => {
    const mol = parseSMILES('C[C@H](F)Cl');
    const center = [...mol.atoms.values()].find(atom => atom.name === 'C' && typeof atom.getChirality === 'function' && atom.getChirality());
    const hydrogen = [...mol.atoms.values()].find(atom => atom.name === 'H' && atom.bonds.length === 1);
    const bond = mol.bonds.get(hydrogen.bonds[0]);
    bond.properties.display = { as: 'dash', centerId: center.id };

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: 'force', reactionEdit: null });
            assert.equal(preflightResult, true);
            mutateCalled = true;
            return mutate({ mol, mode: 'force', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.promoteBondOrder(bond.id, {
      drawBondType: 'single',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(mutateCalled, true);
    assert.equal(bond.properties.order, 1);
    assert.equal(bond.properties.display, undefined);
    assert.equal(center.getChirality(), null);
  });

  it('treats incompatible bond orders on displayed 2D stereochemical hydrogen bonds as a no-op', () => {
    const mol = parseSMILES('C[C@H](F)Cl');
    const center = [...mol.atoms.values()].find(atom => atom.name === 'C' && typeof atom.getChirality === 'function' && atom.getChirality());
    const hydrogen = [...mol.atoms.values()].find(atom => atom.name === 'H' && atom.bonds.length === 1);
    const bond = mol.bonds.get(hydrogen.bonds[0]);
    bond.properties.display = { as: 'wedge', centerId: center.id };

    for (const drawBondType of ['double', 'triple', 'aromatic']) {
      let mutateCalled = false;
      const { context } = makeBaseContext({
        context: {
          controller: {
            performStructuralEdit(_kind, options, mutate) {
              const preflightResult = options.preflight({ mol, mode: '2d', reactionEdit: null });
              if (preflightResult === false) {
                return { cancelled: true };
              }
              mutateCalled = true;
              return mutate({ mol, mode: '2d', reactionEdit: null });
            }
          }
        }
      });
      const actions = createStructuralEditActions(context);

      const result = actions.promoteBondOrder(bond.id, {
        drawBondType,
        skipReactionPreviewPrep: true,
        skipResonancePrep: true,
        skipSnapshot: true,
        zoomSnapshot: 'zoom-snapshot'
      });

      assert.equal(result.cancelled, true);
      assert.equal(mutateCalled, false);
      assert.equal(bond.properties.order, 1);
      assert.deepEqual(bond.properties.display, {
        as: 'wedge',
        centerId: center.id
      });
      assert.match(center.getChirality(), /^[RS]$/);
    }
  });

  it('keeps non-stereochemical force hydrogen bonds blocked for wedge and dash edits', () => {
    const atom1 = makeAtom('a1', 'C');
    const atom2 = makeAtom('a2', 'H');
    const bond = makeBond('b1', 'a1', 'a2', { order: 1 });
    const mol = {
      atoms: new Map([
        ['a1', atom1],
        ['a2', atom2]
      ]),
      bonds: new Map(),
      clearStereoAnnotations() {},
      repairImplicitHydrogens() {}
    };
    attachBond(mol, bond);

    let mutateCalled = false;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const preflightResult = options.preflight({ mol, mode: 'force', reactionEdit: null });
            if (preflightResult === false) {
              return { cancelled: true };
            }
            mutateCalled = true;
            return mutate({ mol, mode: 'force', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.promoteBondOrder('b1', {
      drawBondType: 'dash',
      skipReactionPreviewPrep: true,
      skipResonancePrep: true,
      skipSnapshot: true,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(result.cancelled, true);
    assert.equal(mutateCalled, false);
  });

  it('changes atom elements through the extracted structural-edit action', () => {
    const atom = makeAtom('a1', 'C');
    const mol = {
      atoms: new Map([['a1', atom]]),
      changeAtomElement(atomId, newEl) {
        this.atoms.get(atomId).name = newEl;
      },
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };

    let captured = null;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            return mutate({ mol, mode: '2d' });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomElements(['a1'], 'N', { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(captured.kind, 'change-atom-elements');
    assert.equal(captured.options.overlayPolicy, ReactionPreviewPolicy.prepareEditTargets);
    assert.equal(captured.options.resonancePolicy, ResonancePolicy.normalizeForEdit);
    assert.equal(atom.name, 'N');
    assert.equal(result.clearSelection, true);
    assert.equal(result.suppressPrimitiveHover, true);
    assert.equal(result.clearPrimitiveHover, true);
  });

  it('projects replaced 2D stereochemical hydrogens away from the parent atom before changing the element', () => {
    for (const newElement of ['C', 'O', 'S']) {
      const mol = parseSMILES('C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
      generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });

      const hydrogen = mol.atoms.get('H4');
      const parent = mol.atoms.get('C3');
      assert.ok(hydrogen, 'expected explicit stereochemical hydrogen H4');
      assert.ok(parent, 'expected attached stereocenter C3');
      assert.equal(hydrogen.name, 'H');
      assert.equal(hydrogen.visible, false);
      assert.equal(hydrogen.x, parent.x);
      assert.equal(hydrogen.y, parent.y);

      const { context } = makeBaseContext({
        activeMol: mol,
        context: {
          controller: {
            performStructuralEdit(_kind, _options, mutate) {
              return mutate({ mol, mode: '2d', reactionEdit: { atomId: hydrogen.id } });
            }
          }
        }
      });
      const actions = createStructuralEditActions(context);

      actions.changeAtomElements([hydrogen.id], newElement, { zoomSnapshot: 'zoom-snapshot' });

      const replaced = mol.atoms.get(hydrogen.id);
      assert.equal(replaced?.name, newElement);
      assert.equal(replaced?.visible, true);
      assert.ok(Number.isFinite(replaced?.x) && Number.isFinite(replaced?.y), 'expected replacement atom to have placed 2D coords');
      assert.ok(Math.hypot(replaced.x - parent.x, replaced.y - parent.y) > 1, `expected replacement atom ${newElement} to be moved off the parent atom instead of staying coincident`);
    }
  });

  it('seeds force atom edits from the edited atom position before the first redraw', () => {
    const atom = makeAtom('a1', 'O');
    const mol = {
      atoms: new Map([['a1', atom]]),
      changeAtomElement(atomId, newEl) {
        this.atoms.get(atomId).name = newEl;
      },
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };

    let captured = null;
    const { context } = makeBaseContext({
      simulation: {
        nodes: () => [{ id: 'a1', name: 'O', x: 120, y: 80 }],
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            return mutate({ mol, mode: 'force' });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomElements(['a1'], 'C', { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(captured.kind, 'change-atom-elements');
    assert.equal(atom.name, 'C');
    assert.equal(result.force.options.preservePositions, true);
    assert.equal(result.force.options.preserveView, true);
    assert.deepEqual(result.force.options.initialPatchPos, new Map([['a1', { x: 120, y: 80 }]]));
  });

  it('merges source force positions when atom element edits exit resonance view', () => {
    const atomA = makeAtom('a1', 'O');
    const atomB = makeAtom('a2', 'C');
    const mol = {
      atoms: new Map([
        ['a1', atomA],
        ['a2', atomB]
      ]),
      changeAtomElement(atomId, newEl) {
        this.atoms.get(atomId).name = newEl;
      },
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };

    const { context } = makeBaseContext({
      simulation: {
        nodes: () => [
          { id: 'a1', name: 'O', x: 120, y: 80 },
          { id: 'a2', name: 'C', x: 165, y: 80 },
          { id: '__resonance_product__:a1', name: 'O', x: 360, y: 80 }
        ],
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { atomId: 'a1' }, resonanceReset: true };
            assert.equal(options.preflight(editContext), true);
            return mutate(editContext);
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomElements(['a1'], 'C', { zoomSnapshot: 'zoom-snapshot' });

    const patchPos = result.force.options.initialPatchPos;
    assert.equal(atomA.name, 'C');
    assert.deepEqual(patchPos.get('a1'), { x: 120, y: 80 });
    assert.deepEqual(patchPos.get('a2'), { x: 165, y: 80 });
    assert.equal(patchPos.has('__resonance_product__:a1'), false);
    assert.equal(result.clearPrimitiveHover, true);
    assert.equal(result.suppressPrimitiveHover, true);
    assert.equal(result.restorePrimitiveHover, undefined);
  });

  it('does not restore stale atom hover after changing an atom from reaction preview', () => {
    const atom = makeAtom('a1', 'O');
    const mol = {
      atoms: new Map([['a1', atom]]),
      changeAtomElement(atomId, newEl) {
        this.atoms.get(atomId).name = newEl;
      },
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: '2d', reactionEdit: { atomId: 'a1', restored: true }, resonanceReset: false };
            assert.equal(options.preflight(editContext), true);
            return mutate(editContext);
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomElements(['a1'], 'C', { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(atom.name, 'C');
    assert.equal(result.clearPrimitiveHover, true);
    assert.equal(result.suppressPrimitiveHover, true);
    assert.equal(result.restorePrimitiveHover, undefined);
  });

  it('replaces a force hydrogen with the draw element and patches its position', () => {
    const hydrogen = makeAtom('h1', 'H');
    const carbon = makeAtom('c1', 'C');
    const mol = {
      atoms: new Map([
        ['h1', hydrogen],
        ['c1', carbon]
      ]),
      changeAtomElement(atomId, newEl) {
        this.atoms.get(atomId).name = newEl;
      },
      clearStereoAnnotations(affected) {
        this.clearedStereo = affected;
      },
      repairImplicitHydrogens(affected) {
        this.repairedHydrogens = affected;
      }
    };

    const hydrogenNode = { id: 'h1', name: 'H', x: 10, y: 0 };
    const carbonNode = { id: 'c1', name: 'C', x: 0, y: 0 };
    const productNode = { id: '__resonance_product__:c1', name: 'C', x: 120, y: 0 };
    const simulation = {
      nodes: () => [hydrogenNode, carbonNode, productNode],
      force(name) {
        if (name === 'link') {
          return {
            links: () => [{ source: carbonNode, target: hydrogenNode }]
          };
        }
        return { links: () => [] };
      },
      on() {},
      alpha() {
        return this;
      },
      restart() {
        return this;
      }
    };

    const { context, calls } = makeBaseContext({
      activeMol: mol,
      simulation,
      forceBondLength: 30,
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            const result = mutate({ mol, mode: 'force', reactionEdit: { atomId: 'h1' }, resonanceReset: true });
            const aux = result.force.beforeRender();
            result.force.afterRender({}, aux);
            return { kind, options, result };
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const response = actions.replaceForceHydrogenWithDrawElement('h1', mol);

    assert.equal(response.kind, 'replace-force-hydrogen-with-draw-element');
    assert.equal(response.options.overlayPolicy, ReactionPreviewPolicy.prepareEditTargets);
    assert.equal(response.options.resonancePolicy, ResonancePolicy.normalizeForEdit);
    assert.equal(response.options.snapshotPolicy, SnapshotPolicy.take);
    assert.equal(response.options.viewportPolicy, ViewportPolicy.restoreEdit);
    assert.equal(hydrogen.name, 'N');
    assert.deepEqual(response.result.force.options.initialPatchPos.get('h1'), { x: 10, y: 0 });
    assert.deepEqual(response.result.force.options.initialPatchPos.get('c1'), { x: 0, y: 0 });
    assert.equal(response.result.force.options.initialPatchPos.has('__resonance_product__:c1'), false);
    const patchCall = calls.find(([kind]) => kind === 'patchNodePositions');
    assert.ok(patchCall);
    const patchPos = patchCall[1];
    assert.equal(patchPos.get('h1').x, 30);
    assert.equal(patchPos.get('h1').y, 0);
  });

  it('changes atom charge through the extracted structural-edit action', () => {
    let repairedHydrogens = false;
    const atom = {
      id: 'a1',
      name: 'N',
      properties: { charge: 0 },
      getCharge() {
        return this.properties.charge;
      }
    };
    const mol = {
      atoms: new Map([['a1', atom]]),
      setAtomCharge(atomId, charge) {
        this.atoms.get(atomId).properties.charge = charge;
      },
      repairImplicitHydrogens(affected) {
        repairedHydrogens = affected;
      }
    };

    let captured = null;
    const { context, calls } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            return mutate({ mol, mode: '2d', reactionEdit: { atomId: 'a1' } });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomCharge('a1', {
      chargeTool: 'positive',
      decrement: false,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(captured.kind, 'change-atom-charge');
    assert.equal(captured.options.overlayPolicy, ReactionPreviewPolicy.prepareEditTargets);
    assert.equal(captured.options.resonancePolicy, ResonancePolicy.normalizeForEdit);
    assert.equal(atom.properties.charge, 1);
    assert.equal(repairedHydrogens, false);
    assert.equal(result.clearPrimitiveHover, true);
    assert.equal(result.suppressPrimitiveHover, true);
    assert.deepEqual(
      calls.filter(([kind]) => kind === 'kekulize' || kind === 'refreshAromaticity'),
      [
        ['kekulize', mol],
        ['refreshAromaticity', mol, { preserveKekule: true }]
      ]
    );
  });

  it('merges source force positions when charge edits exit resonance view', () => {
    const atomA = {
      id: 'a1',
      name: 'N',
      properties: { charge: 0 },
      getCharge() {
        return this.properties.charge;
      }
    };
    const atomB = {
      id: 'a2',
      name: 'C',
      properties: { charge: 0 },
      getCharge() {
        return this.properties.charge;
      }
    };
    const mol = {
      atoms: new Map([
        [atomA.id, atomA],
        [atomB.id, atomB]
      ]),
      setAtomCharge(atomId, charge) {
        this.atoms.get(atomId).properties.charge = charge;
      }
    };
    const nodes = [
      { id: 'a1', name: 'N', x: 20, y: 35 },
      { id: 'a2', name: 'C', x: 62, y: 35 },
      { id: '__resonance_product__:a1', name: 'N', x: 260, y: 35 }
    ];

    const { context } = makeBaseContext({
      mode: 'force',
      simulation: {
        nodes: () => nodes,
        force: () => ({ links: () => [] }),
        on() {},
        alpha() {
          return this;
        },
        restart() {
          return this;
        }
      },
      context: {
        controller: {
          performStructuralEdit(_kind, options, mutate) {
            const editContext = { mol, mode: 'force', reactionEdit: { atomId: 'a1' }, resonanceReset: true };
            assert.equal(options.preflight(editContext), true);
            return mutate(editContext);
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomCharge('a1', { chargeTool: 'positive' });

    const patchPos = result.force.options.initialPatchPos;
    assert.equal(atomA.properties.charge, 1);
    assert.deepEqual(patchPos.get('a1'), { x: 20, y: 35 });
    assert.deepEqual(patchPos.get('a2'), { x: 62, y: 35 });
    assert.equal(patchPos.has('__resonance_product__:a1'), false);
    assert.equal(result.clearPrimitiveHover, true);
    assert.equal(result.suppressPrimitiveHover, true);
    assert.equal(result.restorePrimitiveHover, undefined);
  });

  it('paints atom and bond styles through the structural edit action', () => {
    const atom = {
      id: 'a1',
      name: 'C',
      properties: {},
      setStyle(style) {
        this.properties.style = { ...style };
      }
    };
    const bond = {
      id: 'b1',
      atoms: ['a1', 'a2'],
      properties: {},
      setStyle(style) {
        this.properties.style = { ...style };
      }
    };
    const mol = {
      atoms: new Map([['a1', atom]]),
      bonds: new Map([['b1', bond]])
    };

    let captured = null;
    const persisted = [];
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            assert.equal(options.preflight({ mol }), true);
            return mutate({ mol, mode: 'force', reactionEdit: null });
          }
        },
        overlays: {
          paintReactionPreviewReactantSource(payload) {
            persisted.push(payload);
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.paintStyleTargets(['a1'], ['b1'], { color: '#ff6633', opacity: 0.45 }, { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(captured.kind, 'paint-style-targets');
    assert.equal(captured.options.overlayPolicy, ReactionPreviewPolicy.preserve);
    assert.equal(captured.options.resonancePolicy, ResonancePolicy.preserve);
    assert.equal(captured.options.snapshotPolicy, SnapshotPolicy.take);
    assert.deepEqual(captured.options.snapshotOptions, { clearReactionPreview: false });
    assert.equal(captured.options.viewportPolicy, ViewportPolicy.restoreEdit);
    assert.deepEqual(atom.properties.style, { color: '#ff6633', opacity: 0.45 });
    assert.deepEqual(bond.properties.style, { color: '#ff6633', opacity: 0.45 });
    assert.deepEqual(persisted, [
      {
        atomIds: ['a1'],
        bondIds: ['b1'],
        style: { color: '#ff6633', opacity: 0.45 }
      }
    ]);
    assert.equal(result.syncInput, false);
    assert.equal(result.updateAnalysis, false);
    assert.deepEqual(result.restorePrimitiveHover, { atomIds: ['a1'], bondIds: ['b1'] });
    assert.deepEqual(result.force.options, { preservePositions: true, preserveView: true });
  });

  it('can skip extra snapshots for continued paint-stroke style edits', () => {
    const atom = {
      id: 'a1',
      name: 'C',
      properties: {},
      setStyle(style) {
        this.properties.style = { ...style };
      }
    };
    const mol = {
      atoms: new Map([['a1', atom]]),
      bonds: new Map()
    };

    let captured = null;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            assert.equal(options.preflight({ mol }), true);
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.paintStyleTargets(['a1'], [], { color: '#3366ff', opacity: 0.5 }, { skipSnapshot: true });

    assert.equal(captured.kind, 'paint-style-targets');
    assert.equal(captured.options.snapshotPolicy, SnapshotPolicy.skip);
    assert.deepEqual(atom.properties.style, { color: '#3366ff', opacity: 0.5 });
  });

  it('clears atom and bond paint styles through the structural edit action', () => {
    const atom = {
      id: 'a1',
      name: 'C',
      properties: { style: { color: '#ff6633', opacity: 0.45 } },
      clearStyle() {
        delete this.properties.style;
      },
      setStyle(style) {
        if (style) {
          this.properties.style = { ...style };
        } else {
          this.clearStyle();
        }
      }
    };
    const bond = {
      id: 'b1',
      atoms: ['a1', 'a2'],
      properties: { style: { color: '#3366ff', opacity: 0.5 } },
      clearStyle() {
        delete this.properties.style;
      },
      setStyle(style) {
        if (style) {
          this.properties.style = { ...style };
        } else {
          this.clearStyle();
        }
      }
    };
    const mol = {
      atoms: new Map([['a1', atom]]),
      bonds: new Map([['b1', bond]])
    };

    let captured = null;
    const persisted = [];
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            assert.equal(options.preflight({ mol }), true);
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        },
        overlays: {
          paintReactionPreviewReactantSource(payload) {
            persisted.push(payload);
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.paintStyleTargets(['a1'], ['b1'], null, { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(captured.kind, 'paint-style-targets');
    assert.equal(captured.options.snapshotPolicy, SnapshotPolicy.take);
    assert.equal(atom.properties.style, undefined);
    assert.equal(bond.properties.style, undefined);
    assert.deepEqual(persisted, [
      {
        atomIds: ['a1'],
        bondIds: ['b1'],
        style: null
      }
    ]);
    assert.equal(result.syncInput, false);
  });

  it('paints a ring fill through the structural edit action', () => {
    const ringFills = [];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}],
        ['a3', {}],
        ['a4', {}]
      ]),
      bonds: new Map(),
      getRings() {
        return [['a1', 'a2', 'a3', 'a4']];
      },
      getRingFills() {
        return ringFills.map(entry => ({ ...entry, atomIds: [...entry.atomIds] }));
      },
      setRingFill(atomIds, style) {
        ringFills.splice(0, ringFills.length, { ...style, atomIds: [...atomIds] });
      }
    };

    let captured = null;
    const persisted = [];
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            assert.equal(options.preflight({ mol }), true);
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        },
        overlays: {
          paintReactionPreviewReactantSource(payload) {
            persisted.push(payload);
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.paintRingFill(['a1', 'a2', 'a3', 'a4'], { color: '#ffcc00', opacity: 0.35 }, { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(captured.kind, 'paint-ring-fill');
    assert.equal(captured.options.overlayPolicy, ReactionPreviewPolicy.preserve);
    assert.equal(captured.options.resonancePolicy, ResonancePolicy.preserve);
    assert.equal(captured.options.snapshotPolicy, SnapshotPolicy.take);
    assert.deepEqual(captured.options.snapshotOptions, { clearReactionPreview: false });
    assert.equal(captured.options.viewportPolicy, ViewportPolicy.restoreEdit);
    assert.deepEqual(ringFills, [
      {
        id: 'ring-fill:a1\0a2\0a3\0a4',
        atomIds: ['a1', 'a2', 'a3', 'a4'],
        color: '#ffcc00',
        opacity: 0.35
      }
    ]);
    assert.deepEqual(persisted, [
      {
        ringAtomIds: ['a1', 'a2', 'a3', 'a4'],
        ringFillStyle: {
          id: 'ring-fill:a1\0a2\0a3\0a4',
          atomIds: ['a1', 'a2', 'a3', 'a4'],
          color: '#ffcc00',
          opacity: 0.35
        }
      }
    ]);
    assert.equal(result.syncInput, false);
    assert.equal(result.updateAnalysis, false);
    assert.equal(result.clearPrimitiveHover, true);
  });

  it('clears a ring fill through the structural edit action', () => {
    const ringFills = [
      {
        id: 'ring-fill:a1\0a2\0a3',
        atomIds: ['a1', 'a2', 'a3'],
        color: '#ffcc00',
        opacity: 0.35
      }
    ];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}],
        ['a3', {}]
      ]),
      bonds: new Map(),
      getRings() {
        return [['a1', 'a2', 'a3']];
      },
      getRingFills() {
        return ringFills.map(entry => ({ ...entry, atomIds: [...entry.atomIds] }));
      },
      clearRingFill(atomIds) {
        const key = [...atomIds].sort().join('\0');
        const index = ringFills.findIndex(entry => [...entry.atomIds].sort().join('\0') === key);
        if (index >= 0) {
          ringFills.splice(index, 1);
        }
      }
    };

    let captured = null;
    const persisted = [];
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            assert.equal(options.preflight({ mol }), true);
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        },
        overlays: {
          paintReactionPreviewReactantSource(payload) {
            persisted.push(payload);
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.paintRingFill(['a1', 'a2', 'a3'], null, { zoomSnapshot: 'zoom-snapshot' });

    assert.equal(captured.kind, 'paint-ring-fill');
    assert.equal(captured.options.snapshotPolicy, SnapshotPolicy.take);
    assert.deepEqual(ringFills, []);
    assert.deepEqual(persisted, [
      {
        ringAtomIds: ['a1', 'a2', 'a3'],
        ringFillStyle: null
      }
    ]);
    assert.equal(result.clearPrimitiveHover, true);
  });

  it('paints a force-mode ring fill while preserving force positions and view', () => {
    const ringFills = [];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}],
        ['a3', {}]
      ]),
      bonds: new Map(),
      getRings() {
        return [['a1', 'a2', 'a3']];
      },
      getRingFills() {
        return ringFills.map(entry => ({ ...entry, atomIds: [...entry.atomIds] }));
      },
      setRingFill(atomIds, style) {
        ringFills.splice(0, ringFills.length, { ...style, atomIds: [...atomIds] });
      }
    };

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: 'force', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.paintRingFill(['a1', 'a2', 'a3'], { color: '#66ccff', opacity: 0.55 });

    assert.deepEqual(ringFills[0], {
      id: 'ring-fill:a1\0a2\0a3',
      atomIds: ['a1', 'a2', 'a3'],
      color: '#66ccff',
      opacity: 0.55
    });
    assert.deepEqual(result.force.options, { preservePositions: true, preserveView: true });
  });

  it('can skip the undo snapshot when painting a ring fill as part of a bucket stroke', () => {
    const ringFills = [];
    const mol = {
      atoms: new Map([
        ['a1', {}],
        ['a2', {}],
        ['a3', {}]
      ]),
      bonds: new Map(),
      getRings() {
        return [['a1', 'a2', 'a3']];
      },
      getRingFills() {
        return ringFills.map(entry => ({ ...entry, atomIds: [...entry.atomIds] }));
      },
      setRingFill(atomIds, style) {
        ringFills.splice(0, ringFills.length, { ...style, atomIds: [...atomIds] });
      }
    };

    let captured = null;
    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(kind, options, mutate) {
            captured = { kind, options };
            return mutate({ mol, mode: '2d', reactionEdit: null });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.paintRingFill(['a1', 'a2', 'a3'], { color: '#66ccff', opacity: 0.55 }, { skipSnapshot: true });

    assert.equal(captured.kind, 'paint-ring-fill');
    assert.equal(captured.options.snapshotPolicy, SnapshotPolicy.skip);
  });

  it('applies charge-tool edits as signed one-step deltas', () => {
    const atom = {
      id: 'a1',
      name: 'N',
      properties: { charge: -1 },
      getCharge() {
        return this.properties.charge;
      }
    };
    const mol = {
      atoms: new Map([['a1', atom]]),
      setAtomCharge(atomId, charge) {
        this.atoms.get(atomId).properties.charge = charge;
      }
    };

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: { atomId: 'a1' } });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.changeAtomCharge('a1', { chargeTool: 'positive' });
    assert.equal(atom.properties.charge, 0);

    actions.changeAtomCharge('a1', { chargeTool: 'negative' });
    assert.equal(atom.properties.charge, -1);

    actions.changeAtomCharge('a1', { chargeTool: 'negative', decrement: true });
    assert.equal(atom.properties.charge, 0);
  });

  it('rejects resonance product-side atoms before charge-edit preflight mutates resonance', () => {
    const atom = {
      id: '__resonance_product__:a1',
      name: 'C',
      properties: { charge: 0 },
      getCharge() {
        return this.properties.charge;
      }
    };
    const mol = {
      atoms: new Map([[atom.id, atom]]),
      setAtomCharge(atomId, charge) {
        this.atoms.get(atomId).properties.charge = charge;
      }
    };
    let preflightResult = null;

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, options) {
            preflightResult = options.preflight({
              mol,
              mode: 'force',
              reactionEdit: {
                atomId: atom.id,
                restored: false
              }
            });
            return preflightResult ? { unexpected: true } : undefined;
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    const result = actions.changeAtomCharge(atom.id, { chargeTool: 'positive' });

    assert.equal(preflightResult, false);
    assert.equal(result, undefined);
    assert.equal(atom.properties.charge, 0);
  });

  it('repairs implicit hydrogens after a charge edit when that clears a local valence warning', () => {
    const mol = parseSMILES('CO');
    const oxygenId = [...mol.atoms.values()].find(atom => atom.name === 'O')?.id;
    const originalAtomCount = mol.atomCount;
    const originalBondCount = mol.bondCount;

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: { atomId: oxygenId } });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.changeAtomCharge(oxygenId, {
      chargeTool: 'negative',
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(mol.atoms.get(oxygenId)?.getCharge?.() ?? mol.atoms.get(oxygenId)?.properties?.charge, -1);
    assert.equal(
      validateValence(mol).some(warning => warning.atomId === oxygenId),
      false
    );
    assert.equal(mol.atomCount, originalAtomCount - 1);
    assert.equal(mol.bondCount, originalBondCount - 1);
  });

  it('removes one hydrogen after a positive charge edit on methane when that clears the local valence warning', () => {
    const mol = parseSMILES('C');
    const carbonId = [...mol.atoms.values()].find(atom => atom.name === 'C')?.id;
    const originalAtomCount = mol.atomCount;
    const originalBondCount = mol.bondCount;

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: { atomId: carbonId } });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.changeAtomCharge(carbonId, {
      chargeTool: 'positive',
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(mol.atoms.get(carbonId)?.getCharge?.() ?? mol.atoms.get(carbonId)?.properties?.charge, 1);
    assert.equal(
      validateValence(mol).some(warning => warning.atomId === carbonId),
      false
    );
    assert.equal(mol.atomCount, originalAtomCount - 1);
    assert.equal(mol.bondCount, originalBondCount - 1);
  });

  it('restores a displayed stereochemical hydrogen after a charge round trip on a chiral carbon', () => {
    const mol = parseSMILES('C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5, maxPasses: 6 });
    syncDisplayStereo(mol);
    const centerId = 'C5';
    const initialHBond = [...mol.bonds.values()].find(
      bond =>
        bond.properties.display?.centerId === centerId &&
        (bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash') &&
        bond.atoms.some(atomId => mol.atoms.get(atomId)?.name === 'H')
    );

    assert.ok(initialHBond);

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: { atomId: centerId } });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.changeAtomCharge(centerId, {
      chargeTool: 'positive',
      zoomSnapshot: 'zoom-snapshot'
    });
    syncDisplayStereo(mol);

    assert.equal(mol.atoms.get(centerId)?.getCharge?.() ?? mol.atoms.get(centerId)?.properties?.charge, 1);
    assert.equal(
      [...mol.bonds.values()].some(
        bond =>
          bond.properties.display?.centerId === centerId &&
          bond.atoms.some(atomId => mol.atoms.get(atomId)?.name === 'H')
      ),
      false
    );

    actions.changeAtomCharge(centerId, {
      chargeTool: 'negative',
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(mol.atoms.get(centerId)?.getCharge?.() ?? mol.atoms.get(centerId)?.properties?.charge, 0);
    const restoredStereoBonds = [...mol.bonds.values()].filter(
      bond =>
        bond.properties.display?.centerId === centerId &&
        (bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash')
    );
    const restoredHBond = restoredStereoBonds.find(bond => bond.atoms.some(atomId => mol.atoms.get(atomId)?.name === 'H'));
    assert.equal(restoredStereoBonds.length, 1);
    assert.ok(restoredHBond);
    assert.equal(restoredHBond.properties.display.as, 'wedge');
  });

  it('does not auto-add extra hydrogens for implausible multi-positive oxygen charge edits', () => {
    const mol = parseSMILES('CO');
    const oxygenId = [...mol.atoms.values()].find(atom => atom.name === 'O')?.id;
    const originalAtomCount = mol.atomCount;
    const originalBondCount = mol.bondCount;

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: { atomId: oxygenId } });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.changeAtomCharge(oxygenId, {
      nextCharge: 2,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(mol.atoms.get(oxygenId)?.getCharge?.() ?? mol.atoms.get(oxygenId)?.properties?.charge, 2);
    assert.equal(
      validateValence(mol).some(warning => warning.atomId === oxygenId),
      true
    );
    assert.equal(mol.atomCount, originalAtomCount);
    assert.equal(mol.bondCount, originalBondCount);
  });

  it('does not auto-add extra hydrogens for implausible multi-positive nitrogen charge edits', () => {
    const mol = parseSMILES('N');
    const nitrogenId = [...mol.atoms.values()].find(atom => atom.name === 'N')?.id;
    const originalAtomCount = mol.atomCount;
    const originalBondCount = mol.bondCount;

    const { context } = makeBaseContext({
      context: {
        controller: {
          performStructuralEdit(_kind, _options, mutate) {
            return mutate({ mol, mode: '2d', reactionEdit: { atomId: nitrogenId } });
          }
        }
      }
    });
    const actions = createStructuralEditActions(context);

    actions.changeAtomCharge(nitrogenId, {
      nextCharge: 2,
      zoomSnapshot: 'zoom-snapshot'
    });

    assert.equal(mol.atoms.get(nitrogenId)?.getCharge?.() ?? mol.atoms.get(nitrogenId)?.properties?.charge, 2);
    assert.equal(
      validateValence(mol).some(warning => warning.atomId === nitrogenId),
      true
    );
    assert.equal(mol.atomCount, originalAtomCount);
    assert.equal(mol.bondCount, originalBondCount);
  });
});

describe('repairImplicitHydrogensWhenValenceImproves', () => {
  it('repairs implicit hydrogens when that clears a local valence warning', () => {
    const mol = parseSMILES('[CH3]');
    const carbonId = [...mol.atoms.values()].find(atom => atom.name === 'C')?.id;

    assert.equal(
      validateValence(mol).some(warning => warning.atomId === carbonId),
      true
    );

    const repaired = repairImplicitHydrogensWhenValenceImproves(mol, [carbonId]);

    assert.equal(repaired, true);
    assert.equal(
      validateValence(mol).some(warning => warning.atomId === carbonId),
      false
    );
  });

  it('leaves implicit hydrogens unchanged when there is no local valence warning to fix', () => {
    const mol = parseSMILES('C');
    const carbonId = [...mol.atoms.values()].find(atom => atom.name === 'C')?.id;
    const originalAtomCount = mol.atomCount;
    const originalBondCount = mol.bondCount;

    const repaired = repairImplicitHydrogensWhenValenceImproves(mol, [carbonId]);

    assert.equal(repaired, false);
    assert.equal(mol.atomCount, originalAtomCount);
    assert.equal(mol.bondCount, originalBondCount);
  });
});
