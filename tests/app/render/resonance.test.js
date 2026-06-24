import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/index.js';
import { generateResonanceStructures } from '../../../src/algorithms/index.js';
import { generateAndRefine2dCoords } from '../../../src/layout/index.js';
import { computeChargeBadgePlacement, secondaryDir } from '../../../src/layout/mol2d-helpers.js';
import { atomRadius, renderBondOrder } from '../../../src/app/render/helpers.js';
import {
  captureResonanceViewSnapshot,
  clearResonancePanelState,
  initResonancePanel,
  prepareResonanceStateForStructuralEdit,
  prepareResonanceUndoSnapshot,
  restoreResonanceViewSnapshot,
  shouldPreserveResonanceForClickTarget,
  updateResonancePanel
} from '../../../src/app/render/resonance.js';
import { buildResonanceElectronFlow, computeResonanceArrowPath, resonanceArrowOccupiedAnglesForAtom, RESONANCE_ELECTRON_FLOW_PROPERTY, setMoleculeResonanceElectronFlow } from '../../../src/app/render/resonance-arrows.js';

function makeMockElement(tagName = 'div') {
  let _textContent = '';
  let _innerHTML = '';
  const classes = new Set();
  const listeners = new Map();
  return {
    tagName,
    children: [],
    className: '',
    style: {},
    get textContent() {
      return _textContent;
    },
    set textContent(value) {
      _textContent = String(value);
    },
    get innerHTML() {
      return _innerHTML;
    },
    set innerHTML(value) {
      _innerHTML = String(value);
      this.children = [];
      _textContent = '';
    },
    classList: {
      add(...tokens) {
        for (const token of tokens) {
          classes.add(token);
        }
      },
      contains(token) {
        return classes.has(token);
      }
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) ?? [];
      for (const handler of handlers) {
        handler(event);
      }
    }
  };
}

function collectText(node) {
  let text = node?.textContent ?? '';
  for (const child of node?.children ?? []) {
    text += collectText(child);
  }
  return text;
}

function mockTarget(matches = new Set()) {
  return {
    closest(selector) {
      return selector
        .split(',')
        .map(part => part.trim())
        .some(part => matches.has(part))
        ? {}
        : null;
    }
  };
}

function mockEvent(type) {
  return {
    type,
    preventDefault() {},
    stopPropagation() {}
  };
}

const TEST_RENDER_SCALE = 60;

function toRenderPoint(atom) {
  return { x: atom.x * TEST_RENDER_SCALE, y: -atom.y * TEST_RENDER_SCALE };
}

function scaledRenderPoint(scale) {
  return atom => ({ x: atom.x * scale, y: -atom.y * scale });
}

function lineModeArrowOptions(mol) {
  return {
    atomStartPad: (_endpoint, atom) => (atom?.visible !== false && atom?.name !== 'C' ? 11 : 20),
    atomEndPad: 24,
    bondStartPad: 8,
    bondEndPad: 8,
    bondTargetOffsetSign: (_endpoint, bond, a1, a2) => {
      const order = renderBondOrder(bond);
      return order >= 1.5 ? -secondaryDir(a1, a2, mol, toRenderPoint) : null;
    },
    atomToBondSourceOffset: 15,
    atomToBondTargetOffset: 6,
    atomTargetOutside: true,
    curveScale: 0.29,
    minCurve: 17,
    maxCurve: 38
  };
}

function forceModeArrowOptions() {
  return {
    atomEndPad: 0,
    atomToBondSourceOffset: ({ atom }) => atomRadius(atom?.properties?.protons, 'force') + 3,
    atomTargetCenterTangent: true,
    atomTargetCircleRadius: (_endpoint, atom) => atomRadius(atom?.properties?.protons, 'force'),
    atomTargetCircleAngle: Math.PI / 4,
    atomTargetCircleClearance: 3,
    atomTargetMinBend: 20,
    minArrowLength: 8
  };
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return 0;
  }
  return Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / len;
}

function angularDistance(firstAngle, secondAngle) {
  const diff = Math.abs(firstAngle - secondAngle) % (Math.PI * 2);
  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function resonanceBondOrder(bond, state) {
  return bond.properties?.resonance?.states?.[state]?.order ?? bond.properties?.localizedOrder ?? bond.properties?.order ?? 1;
}

function sharedBondEndpointCount(firstBond, secondBond) {
  const firstAtomIds = new Set(firstBond?.atoms ?? []);
  return (secondBond?.atoms ?? []).filter(atomId => firstAtomIds.has(atomId)).length;
}

function atomEndpointHalfwayUpRatio(path, atomCenter) {
  const dx = atomCenter.x - path.start.x;
  const dy = atomCenter.y - path.start.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return 0;
  }
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const radial = Math.abs((path.end.x - atomCenter.x) * -ux + (path.end.y - atomCenter.y) * -uy);
  const side = Math.abs((path.end.x - atomCenter.x) * px + (path.end.y - atomCenter.y) * py);
  return radial > 1e-6 ? side / radial : Number.POSITIVE_INFINITY;
}

function signedBondDistance(point, bond, mol) {
  const [a1, a2] = bond.getAtomObjects(mol);
  const p1 = toRenderPoint(a1);
  const p2 = toRenderPoint(a2);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  return (point.x - mid.x) * nx + (point.y - mid.y) * ny;
}

function rotateMolecule(mol, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const atom of mol.atoms.values()) {
    const x = atom.x;
    const y = atom.y;
    atom.x = x * cos - y * sin;
    atom.y = x * sin + y * cos;
  }
}

function rotatedPointForAtom(angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return atom => {
    const point = toRenderPoint(atom);
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos
    };
  };
}

describe('shouldPreserveResonanceForClickTarget', () => {
  it('preserves resonance view for toolbar mode controls like pan/select/erase', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#clean-controls']))), true);
  });

  it('preserves resonance view for plot interactions like selecting atoms or regions', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#plot']))), true);
  });

  it('preserves resonance view for draw tools and atom palette clicks', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#draw-tools']))), true);
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#atom-selector']))), true);
  });

  it('preserves resonance view for clicks inside the resonance table itself', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#resonance-table']))), true);
  });

  it('allows ordinary outside clicks to reset the active resonance view', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget()), false);
  });
});

describe('prepareResonanceStateForStructuralEdit', () => {
  it('clears stale resonance tables before a structural edit starts', () => {
    const mol = parseSMILES('CC=O');
    generateResonanceStructures(mol);
    mol.setResonanceState(2);

    const result = prepareResonanceStateForStructuralEdit(mol);

    assert.equal(result.resonanceCleared, true);
    assert.equal(!!mol.properties.resonance, false);

    const carbonyl = [...mol.bonds.values()].find(bond => {
      const [a1, a2] = bond.getAtomObjects(mol);
      return (a1.name === 'C' && a2.name === 'O') || (a1.name === 'O' && a2.name === 'C');
    });
    assert.ok(carbonyl);
    assert.equal(carbonyl.properties.order, 2);
  });
});

describe('resonance undo snapshots', () => {
  it('infers base-to-target electron flow from contributor 1 to the selected contributor', () => {
    const mol = parseSMILES('CC(=O)[O-]');
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 2);

    assert.equal(flow.referenceState, 1);
    assert.equal(flow.state, 2);
    assert.equal(flow.arrows.length, 2);
    assert.ok(flow.arrows.some(arrow => arrow.from.kind === 'atom' && arrow.to.kind === 'bond'), 'expected lone-pair donation into the single C-O bond');
    assert.ok(flow.arrows.some(arrow => arrow.from.kind === 'bond' && arrow.to.kind === 'atom'), 'expected carbonyl pi electrons to move onto oxygen');
  });

  it('does not draw direct atom-to-atom arrows for allylic charge relocation', () => {
    const mol = parseSMILES('C=C[CH2+]');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 2);

    assert.equal(flow.arrows.length, 1);
    assert.deepEqual(flow.arrows.map(arrow => [arrow.from.kind, arrow.to.kind]), [['bond', 'bond']]);
    assert.equal(Number.isFinite(flow.arrows[0].from.sideSign), true);
    assert.equal(Number.isFinite(flow.arrows[0].to.sideSign), true);
  });

  it('uses the terminal alkene pi bond as the source for the third contributor of the substituted enone example', () => {
    const mol = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 3);

    assert.equal(flow.arrows.length, 1);
    assert.equal(flow.arrows[0].from.kind, 'bond');
    assert.equal(flow.arrows[0].to.kind, 'atom');
    assert.equal(Number.isFinite(flow.arrows[0].from.sideSign), true);
  });

  it('stores a stable target side for atom-to-bond arrows where the source atom is on the target bond', () => {
    const mol = parseSMILES('CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 3);
    const atomToBond = flow.arrows.find(arrow => arrow.from.kind === 'atom' && arrow.to.kind === 'bond');
    assert.ok(atomToBond);
    assert.equal(atomToBond.from.atomId, 'N3');
    assert.equal(atomToBond.to.bondId, '1');
    assert.equal(Number.isFinite(atomToBond.to.sideSign), true);
  });

  it('draws atom-to-bond arrows as one simple curve on one side of the target bond plane', () => {
    const mol = parseSMILES('CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 3);
    const atomToBond = flow.arrows.find(arrow => arrow.from.kind === 'atom' && arrow.to.kind === 'bond');
    const path = computeResonanceArrowPath(atomToBond, 0, mol, toRenderPoint, lineModeArrowOptions(mol));
    assert.ok(path);
    assert.match(path.d, /^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);

    const targetBond = mol.bonds.get(atomToBond.to.bondId);
    const distances = [path.start, path.control, path.end].map(point => signedBondDistance(point, targetBond, mol));
    const signs = distances.map(Math.sign);
    assert.ok(distances.every(distance => Math.abs(distance) > 0.1), `expected all arrow points off the target bond plane, got ${distances.join(', ')}`);
    assert.ok(signs.every(sign => sign === signs[0]), `expected all arrow points on one side of the target bond, got ${distances.join(', ')}`);
  });

  it('keeps atom-to-bond arrow start placement stable through molecule rotation', () => {
    const mol = parseSMILES('CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 3);
    const atomToBond = flow.arrows.find(arrow => arrow.from.kind === 'atom' && arrow.to.kind === 'bond');
    const sourceAtom = mol.atoms.get(atomToBond.from.atomId);
    const before = computeResonanceArrowPath(atomToBond, 0, mol, toRenderPoint, lineModeArrowOptions(mol));
    const beforeOffset = Math.hypot(before.start.x - toRenderPoint(sourceAtom).x, before.start.y - toRenderPoint(sourceAtom).y);
    const beforeSide = Math.sign(signedBondDistance(before.start, mol.bonds.get(atomToBond.to.bondId), mol));

    rotateMolecule(mol, Math.PI / 3);
    const after = computeResonanceArrowPath(atomToBond, 0, mol, toRenderPoint, lineModeArrowOptions(mol));
    const afterOffset = Math.hypot(after.start.x - toRenderPoint(sourceAtom).x, after.start.y - toRenderPoint(sourceAtom).y);
    const afterSide = Math.sign(signedBondDistance(after.start, mol.bonds.get(atomToBond.to.bondId), mol));

    assert.ok(Math.abs(beforeOffset - 15) < 1e-6);
    assert.ok(Math.abs(afterOffset - 15) < 1e-6);
    assert.equal(afterSide, beforeSide);
    assert.match(after.d, /^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
  });

  it('points force-mode atom-target arrowhead tangents toward atom centers', () => {
    const mol = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 3);
    const bondToAtom = flow.arrows.find(arrow => arrow.from.kind === 'bond' && arrow.to.kind === 'atom');
    const path = computeResonanceArrowPath(bondToAtom, 0, mol, toRenderPoint, forceModeArrowOptions());
    const atomCenter = toRenderPoint(mol.atoms.get(bondToAtom.to.atomId));
    const tangent = { x: path.end.x - path.control.x, y: path.end.y - path.control.y };
    const toCenter = { x: atomCenter.x - path.end.x, y: atomCenter.y - path.end.y };
    const cross = tangent.x * toCenter.y - tangent.y * toCenter.x;
    const dot = tangent.x * toCenter.x + tangent.y * toCenter.y;
    const bend = pointLineDistance(path.control, path.start, path.end);
    const endDistance = Math.hypot(toCenter.x, toCenter.y);
    const targetRadius = atomRadius(mol.atoms.get(bondToAtom.to.atomId).properties?.protons, 'force');

    assert.ok(path);
    assert.match(path.d, /^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
    assert.ok(dot > 0, 'expected final tangent to point toward the target atom center');
    assert.ok(Math.abs(cross) < 1e-6, `expected final tangent to be collinear with target atom center, got cross ${cross}`);
    assert.ok(bend >= 19.9, `expected force atom-target arrow to keep wider visible curvature, got bend ${bend}`);
    assert.ok(endDistance > targetRadius + 2, `expected force atom-target arrow to end just outside atom circle, got ${endDistance} vs radius ${targetRadius}`);
    assert.ok(Math.abs(atomEndpointHalfwayUpRatio(path, atomCenter) - 1) < 0.08, 'expected force atom-target arrow tip halfway around the atom circle');
  });

  it('keeps force-mode atom-target arrows simple and center-aimed after rotation', () => {
    const mol = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 3);
    const bondToAtom = flow.arrows.find(arrow => arrow.from.kind === 'bond' && arrow.to.kind === 'atom');
    const rotatedPoint = rotatedPointForAtom(Math.PI / 2.7);
    const path = computeResonanceArrowPath(bondToAtom, 0, mol, rotatedPoint, forceModeArrowOptions());
    const targetAtom = mol.atoms.get(bondToAtom.to.atomId);
    const atomCenter = rotatedPoint(targetAtom);
    const tangent = { x: path.end.x - path.control.x, y: path.end.y - path.control.y };
    const toCenter = { x: atomCenter.x - path.end.x, y: atomCenter.y - path.end.y };
    const cross = tangent.x * toCenter.y - tangent.y * toCenter.x;
    const endDistance = Math.hypot(toCenter.x, toCenter.y);
    const bend = pointLineDistance(path.control, path.start, path.end);
    const targetRadius = atomRadius(targetAtom.properties?.protons, 'force');

    assert.ok(path);
    assert.match(path.d, /^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
    assert.ok(Math.abs(cross) < 1e-6, `expected rotated final tangent to aim at atom center, got cross ${cross}`);
    assert.ok(bend >= 19.9, `expected rotated force atom-target arrow to keep wider visible curvature, got bend ${bend}`);
    assert.ok(endDistance > targetRadius + 2, `expected rotated force atom-target arrow to end just outside atom circle, got ${endDistance} vs radius ${targetRadius}`);
    assert.ok(Math.abs(atomEndpointHalfwayUpRatio(path, atomCenter) - 1) < 0.08, 'expected rotated force atom-target arrow tip halfway around the atom circle');
  });

  it('starts force-mode atom-to-bond arrows outside the source atom radius', () => {
    const mol = parseSMILES('CC(=O)[O-]');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 2);
    const atomToBond = flow.arrows.find(arrow => arrow.from.kind === 'atom' && arrow.to.kind === 'bond');
    const path = computeResonanceArrowPath(atomToBond, 0, mol, toRenderPoint, forceModeArrowOptions());
    const sourceAtom = mol.atoms.get(atomToBond.from.atomId);
    const sourceCenter = toRenderPoint(sourceAtom);
    const sourceRadius = atomRadius(sourceAtom.properties?.protons, 'force');
    const startDistance = Math.hypot(path.start.x - sourceCenter.x, path.start.y - sourceCenter.y);

    assert.ok(path);
    assert.ok(startDistance > sourceRadius + 2, `expected atom-to-bond tail outside force atom radius, got ${startDistance} vs radius ${sourceRadius}`);
  });

  it('renders compact force-mode atom-target arrows that are shorter than the line-mode cutoff', () => {
    const mol = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    const flow = buildResonanceElectronFlow(mol, 2);
    const bondToAtom = flow.arrows.find(arrow => arrow.from.kind === 'bond' && arrow.to.kind === 'atom');
    const compactPoint = scaledRenderPoint(20);
    const forcePath = computeResonanceArrowPath(bondToAtom, 0, mol, compactPoint, forceModeArrowOptions());
    const strictPath = computeResonanceArrowPath(bondToAtom, 0, mol, compactPoint, { ...forceModeArrowOptions(), minArrowLength: 14 });

    assert.ok(forcePath);
    assert.match(forcePath.d, /^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
    assert.equal(strictPath, null);
  });

  it('pairs PAH resonance arrows from base double bonds to active double bonds', () => {
    const mol = parseSMILES('C1=CC2=CC3=CC=CC=C3C=C2C=C1');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    for (let state = 2; state <= mol.resonanceCount; state++) {
      mol.setResonanceState(state);
      const flow = setMoleculeResonanceElectronFlow(mol, state);
      const bondSources = flow.arrows.filter(arrow => arrow.from.kind === 'bond');

      assert.ok(bondSources.length > 0, `expected bond-source arrows for resonance state ${state}`);
      for (const arrow of bondSources) {
        const sourceBond = mol.bonds.get(arrow.from.bondId);
        assert.ok(resonanceBondOrder(sourceBond, 1) >= 2, `expected state ${state} arrow source bond ${arrow.from.bondId} to be double in the base contributor`);
        if (arrow.to.kind === 'bond') {
          const targetBond = mol.bonds.get(arrow.to.bondId);
          assert.ok(resonanceBondOrder(targetBond, state) >= 2, `expected state ${state} arrow target bond ${arrow.to.bondId} to be double in the active contributor`);
        }
      }
    }
  });

  it('keeps coronene resonance bond arrows on adjacent bonds', () => {
    const mol = parseSMILES('C1=CC2=C3C4=C1C=CC5=C4C6=C(C=C5)C=CC7=C6C3=C(C=C2)C=C7');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);

    assert.ok(mol.resonanceCount > 1, 'expected coronene to produce resonance contributors');
    for (let state = 2; state <= mol.resonanceCount; state++) {
      const flow = buildResonanceElectronFlow(mol, state);
      const bondToBondArrows = flow.arrows.filter(arrow => arrow.from.kind === 'bond' && arrow.to.kind === 'bond');
      const changedBonds = [...mol.bonds.values()].filter(bond => resonanceBondOrder(bond, state) !== resonanceBondOrder(bond, 1));
      const expectedBondMoves = changedBonds.length / 2;

      assert.equal(bondToBondArrows.length, expectedBondMoves, `expected every coronene bond move to render for resonance state ${state}`);
      for (const arrow of bondToBondArrows) {
        const sourceBond = mol.bonds.get(arrow.from.bondId);
        const targetBond = mol.bonds.get(arrow.to.bondId);
        assert.equal(
          sharedBondEndpointCount(sourceBond, targetBond),
          1,
          `expected coronene state ${state} arrow ${arrow.from.bondId}->${arrow.to.bondId} to move to an adjacent bond`
        );
      }
    }
  });

  it('reports resonance arrow sectors that charge badges should avoid', () => {
    const mol = parseSMILES('CC(=O)[O-]');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);
    mol.setResonanceState(2);
    const flow = setMoleculeResonanceElectronFlow(mol, 2);
    const atomToBond = flow.arrows.find(arrow => arrow.from.kind === 'atom' && arrow.to.kind === 'bond');
    const sourceAtom = mol.atoms.get(atomToBond.from.atomId);
    const path = computeResonanceArrowPath(atomToBond, 0, mol, toRenderPoint, lineModeArrowOptions(mol));
    const center = toRenderPoint(sourceAtom);
    const expectedAngle = Math.atan2(path.start.y - center.y, path.start.x - center.x);

    const sectors = resonanceArrowOccupiedAnglesForAtom(mol, sourceAtom, toRenderPoint, lineModeArrowOptions(mol));

    assert.ok(sectors.some(sector => angularDistance(sector.angle, expectedAngle) < 0.08 && sector.spread > 0.5), 'expected atom-to-bond resonance arrow to block the charged atom badge direction');
  });

  it('moves charge badge placement away from an occupied resonance arrow sector', () => {
    const mol = parseSMILES('CC(=O)[O-]');
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
    generateResonanceStructures(mol);
    mol.setResonanceState(2);
    const flow = setMoleculeResonanceElectronFlow(mol, 2);
    const atomToBond = flow.arrows.find(arrow => arrow.from.kind === 'atom' && arrow.to.kind === 'bond');
    const sourceAtom = mol.atoms.get(atomToBond.from.atomId);
    const path = computeResonanceArrowPath(atomToBond, 0, mol, toRenderPoint, lineModeArrowOptions(mol));
    const center = toRenderPoint(sourceAtom);
    const arrowAngle = Math.atan2(path.start.y - center.y, path.start.x - center.x);

    const unblocked = computeChargeBadgePlacement(sourceAtom, mol, {
      pointForAtom: toRenderPoint,
      fontSize: 14,
      chargeLabel: '−',
      preferredAngle: arrowAngle
    });
    const blocked = computeChargeBadgePlacement(sourceAtom, mol, {
      pointForAtom: toRenderPoint,
      fontSize: 14,
      chargeLabel: '−',
      preferredAngle: arrowAngle,
      extraOccupiedAngles: [{ angle: arrowAngle, spread: 0.72 }]
    });

    assert.ok(unblocked);
    assert.ok(blocked);
    assert.ok(angularDistance(blocked.angle, arrowAngle) > angularDistance(unblocked.angle, arrowAngle) + 0.2, 'expected charge badge to move away from resonance arrow sector');
  });

  it('stores electron-flow arrows only while a non-base contributor is active', () => {
    const mol = parseSMILES('CC(=O)[O-]');
    generateResonanceStructures(mol);

    restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });
    assert.ok(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY]?.arrows.length > 0);

    restoreResonanceViewSnapshot(mol, null);
    assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY], undefined);
  });

  it('stores canonical contributor data while preserving the active contributor view separately', () => {
    const mol = parseSMILES('CC=O');
    generateResonanceStructures(mol);
    restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });

    const viewSnapshot = captureResonanceViewSnapshot(mol);
    const prepared = prepareResonanceUndoSnapshot(mol);
    const carbonyl = [...prepared.mol.bonds.values()].find(bond => {
      const [a1, a2] = bond.getAtomObjects(prepared.mol);
      return (a1.name === 'C' && a2.name === 'O') || (a1.name === 'O' && a2.name === 'C');
    });

    assert.deepEqual(viewSnapshot, { locked: true, activeState: 2 });
    assert.deepEqual(prepared.resonanceView, { locked: true, activeState: 2 });
    assert.equal(carbonyl.properties.order, 2);
  });

  it('rerenders the resonance row label when a locked contributor view is restored', () => {
    const previousDocument = globalThis.document;
    const resonanceBody = makeMockElement('tbody');
    globalThis.document = {
      getElementById(id) {
        return id === 'resonance-body' ? resonanceBody : null;
      },
      createElement(tagName) {
        return makeMockElement(tagName);
      }
    };

    try {
      const mol = parseSMILES('CC=O');
      generateResonanceStructures(mol);

      const restored = restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });

      assert.equal(restored, true);
      assert.equal(resonanceBody.children.length, 1);
      assert.match(collectText(resonanceBody.children[0]), /2\/2/);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it('uses the displayed resonance contributor as the electron-flow source while navigating', () => {
    const previousDocument = globalThis.document;
    const resonanceBody = makeMockElement('tbody');
    globalThis.document = {
      getElementById(id) {
        return id === 'resonance-body' ? resonanceBody : null;
      },
      createElement(tagName) {
        return makeMockElement(tagName);
      }
    };
    clearResonancePanelState();

    try {
      const mol = parseSMILES('C1=CC2=C3C4=C1C=CC5=C4C6=C(C=C5)C=CC7=C6C3=C(C=C2)C=C7');
      generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5 });
      generateResonanceStructures(mol);
      initResonancePanel({
        mode: '2d',
        _mol2d: mol,
        currentMol: null,
        draw2d() {},
        updateForce() {}
      });
      updateResonancePanel(mol, { recompute: false });

      resonanceBody.children[0].dispatchEvent(mockEvent('click'));
      assert.equal(mol.properties.resonance.currentState, 1);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY], undefined);

      let row = resonanceBody.children[0];
      let nav = row.children[0].children.find(child => child.className === 'reaction-nav');
      nav.children[2].dispatchEvent(mockEvent('mousedown'));
      assert.equal(mol.properties.resonance.currentState, 2);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY].referenceState, 1);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY].targetState, 2);

      row = resonanceBody.children[0];
      nav = row.children[0].children.find(child => child.className === 'reaction-nav');
      nav.children[2].dispatchEvent(mockEvent('mousedown'));
      assert.equal(mol.properties.resonance.currentState, 3);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY].referenceState, 2);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY].targetState, 3);

      row = resonanceBody.children[0];
      nav = row.children[0].children.find(child => child.className === 'reaction-nav');
      nav.children[0].dispatchEvent(mockEvent('mousedown'));
      assert.equal(mol.properties.resonance.currentState, 2);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY].referenceState, 3);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY].targetState, 2);

      row = resonanceBody.children[0];
      nav = row.children[0].children.find(child => child.className === 'reaction-nav');
      nav.children[0].dispatchEvent(mockEvent('mousedown'));
      assert.equal(mol.properties.resonance.currentState, 1);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY].referenceState, 2);
      assert.equal(mol.properties[RESONANCE_ELECTRON_FLOW_PROPERTY].targetState, 1);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it('rerenders the resonance row as unlocked when no locked contributor view is restored', () => {
    const previousDocument = globalThis.document;
    const resonanceBody = makeMockElement('tbody');
    globalThis.document = {
      getElementById(id) {
        return id === 'resonance-body' ? resonanceBody : null;
      },
      createElement(tagName) {
        return makeMockElement(tagName);
      }
    };

    try {
      const mol = parseSMILES('CC=O');
      generateResonanceStructures(mol);
      restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });

      const restored = restoreResonanceViewSnapshot(mol, null);
      const row = resonanceBody.children[0];

      assert.equal(restored, false);
      assert.equal(resonanceBody.children.length, 1);
      assert.equal(row.classList.contains('resonance-active'), false);
      assert.doesNotMatch(collectText(row), /2\/2/);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it('does not collapse reaction preview while capturing an undo snapshot', () => {
    const mol = parseSMILES('CC=O');
    generateResonanceStructures(mol);
    restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });

    let restoreCalls = 0;
    initResonancePanel({
      mode: '2d',
      _mol2d: mol,
      currentMol: null,
      draw2d() {},
      updateForce() {},
      hasReactionPreview: () => true,
      restoreReactionPreviewSource: () => {
        restoreCalls += 1;
        return true;
      }
    });

    const prepared = prepareResonanceUndoSnapshot(mol);

    assert.equal(restoreCalls, 0);
    assert.equal(prepared.mol, mol);
    assert.equal(prepared.resonanceView, null);
  });
});
