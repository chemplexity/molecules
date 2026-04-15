import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { pointInPolygon } from '../../../../src/layout/engine/geometry/polygon.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { buildScaffoldPlan } from '../../../../src/layout/engine/model/scaffold-plan.js';
import { layoutMixedFamily } from '../../../../src/layout/engine/families/mixed.js';
import { angleOf, angularDifference, centroid, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import {
  makeBibenzyl,
  makeBiphenyl,
  makeButylbenzene,
  makeEthylbenzene,
  makeMacrocycleWithSubstituent,
  makeMethylnaphthalene,
  makeMethylbenzene,
  makePhenylacetylene
} from '../support/molecules.js';

function buildAdjacency(layoutGraph, atomIds) {
  const adjacency = new Map([...atomIds].map(atomId => [atomId, []]));
  for (const bond of layoutGraph.bonds.values()) {
    if (!atomIds.has(bond.a) || !atomIds.has(bond.b)) {
      continue;
    }
    adjacency.get(bond.a).push(bond.b);
    adjacency.get(bond.b).push(bond.a);
  }
  return adjacency;
}

/**
 * Returns heavy ring substituents whose placed endpoint falls inside an incident ring face.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {Array<{atomId: string, childId: string}>} Invalid inward substituents.
 */
function inwardRingSubstituents(layoutGraph, coords) {
  const ringAtomSet = new Set(layoutGraph.ringSystems[0]?.atomIds ?? []);
  const invalid = [];

  for (const atomId of layoutGraph.ringSystems[0]?.atomIds ?? []) {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const heavyChildren = atom
      .getNeighbors(layoutGraph.sourceMolecule)
      .filter(neighbor => neighbor && neighbor.name !== 'H' && !ringAtomSet.has(neighbor.id))
      .map(neighbor => neighbor.id);
    if (heavyChildren.length !== 1) {
      continue;
    }
    const childId = heavyChildren[0];
    const childPosition = coords.get(childId);
    const insideIncidentRing = (layoutGraph.atomToRings.get(atomId) ?? []).some(ring =>
      pointInPolygon(
        childPosition,
        ring.atomIds.map(ringAtomId => coords.get(ringAtomId))
      )
    );
    if (insideIncidentRing) {
      invalid.push({ atomId, childId });
    }
  }

  return invalid;
}

/**
 * Returns the sorted pairwise bond-angle separations around a placed atom.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Atom ID to inspect.
 * @returns {number[]} Sorted angular separations in radians.
 */
function sortedNeighborSeparations(adjacency, coords, atomId) {
  const atomPosition = coords.get(atomId);
  const neighborAngles = (adjacency.get(atomId) ?? [])
    .filter(neighborAtomId => coords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), atomPosition)))
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = [];

  for (let index = 0; index < neighborAngles.length; index++) {
    const currentAngle = neighborAngles[index];
    const nextAngle = neighborAngles[(index + 1) % neighborAngles.length];
    const rawGap = nextAngle - currentAngle;
    separations.push(rawGap > 0 ? rawGap : rawGap + Math.PI * 2);
  }

  return separations.sort((firstSeparation, secondSeparation) => firstSeparation - secondSeparation);
}

/**
 * Returns the smaller bond angle at a center atom between two neighbors.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} firstNeighborAtomId - First neighbor atom ID.
 * @param {string} secondNeighborAtomId - Second neighbor atom ID.
 * @returns {number} Smaller bond angle in radians.
 */
function bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const centerPosition = coords.get(centerAtomId);
  const firstAngle = angleOf(sub(coords.get(firstNeighborAtomId), centerPosition));
  const secondAngle = angleOf(sub(coords.get(secondNeighborAtomId), centerPosition));
  return angularDifference(firstAngle, secondAngle);
}

describe('layout/engine/families/mixed', () => {
  it('lays out a ring scaffold plus acyclic substituent through the mixed orchestrator', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 7);
    assert.ok(result.coords.has('a6'));
  });

  it('lays out an alkyl substituent off a ring without keeping the chain flat', () => {
    const graph = createLayoutGraph(makeEthylbenzene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const firstBond = sub(result.coords.get('a6'), result.coords.get('a0'));
    const secondBond = sub(result.coords.get('a7'), result.coords.get('a6'));
    const cross = firstBond.x * secondBond.y - firstBond.y * secondBond.x;

    assert.equal(result.supported, true);
    assert.ok(result.coords.has('a6'));
    assert.ok(result.coords.has('a7'));
    assert.ok(Math.abs(cross) > 0.2);
  });

  it('points a longer alkyl substituent outward from the ring and keeps the chain zigzagged', () => {
    const graph = createLayoutGraph(makeButylbenzene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAnchor = result.coords.get('a0');
    const ringNeighborCenter = centroid([result.coords.get('a1'), result.coords.get('a5')]);
    const outward = sub(ringAnchor, ringNeighborCenter);
    const firstBond = sub(result.coords.get('a6'), ringAnchor);
    const secondBond = sub(result.coords.get('a7'), result.coords.get('a6'));
    const thirdBond = sub(result.coords.get('a8'), result.coords.get('a7'));
    const outwardDot = outward.x * firstBond.x + outward.y * firstBond.y;
    const chainCross = secondBond.x * thirdBond.y - secondBond.y * thirdBond.x;

    assert.equal(result.supported, true);
    assert.ok(outwardDot > 0.5);
    assert.ok(Math.abs(chainCross) > 0.2);
  });

  it('lays out fused mixed scaffolds with long perfluoroalkyl tails without stalling branch placement', () => {
    const graph = createLayoutGraph(parseSMILES('FC(F)(F)c1cc(nc2N=CN(Cc3cn(CCC(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F)nn3)C(=O)c12)c4ccccc4'), {
      suppressH: true
    });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const start = Date.now();
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const elapsed = Date.now() - start;

    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, component.atomIds.length);
    assert.ok(elapsed < 10000, `expected the mixed layout to finish comfortably under 10s, got ${elapsed}ms`);
  });

  it('lays out nucleotide-like fused mixed scaffolds without timing out in branch placement', () => {
    const graph = createLayoutGraph(
      parseSMILES('C[C@](O)(CC(O)=O)CC(=O)SCCNC(=O)CCNC(=O)[C@H](O)C(C)(C)COP(O)(=O)OP(O)(=O)OC[C@H]1O[C@H]([C@H](O)[C@@H]1OP(O)(O)=O)N1C=NC2=C(N)N=CN=C12'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const start = Date.now();
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const elapsed = Date.now() - start;

    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, result.atomIds.length);
    assert.ok(elapsed < 3000, `expected the mixed nucleotide layout to stay comfortably below the stress-test budget, got ${elapsed}ms`);
  });

  it('lays out peptide-like isolated-ring mixed scaffolds without stalling local branch scoring', () => {
    const graph = createLayoutGraph(
      parseSMILES('CC(C)C[C@H](NC(=O)[C@@H](NC(=O)[C@H](Cc1ccccc1)NC(=O)C)[C@@H](C)O)C(=O)N[C@@H](CC(=O)O)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(=O)O)C(=O)N[C@@H](Cc2ccccc2)C(=O)O'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const start = Date.now();
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const elapsed = Date.now() - start;

    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, result.atomIds.length);
    assert.ok(elapsed < 4500, `expected the mixed peptide layout to stay below the exploratory branch-search budget, got ${elapsed}ms`);
  });

  it('lays out the stress-test peptide outlier without stalling sibling permutation scoring', () => {
    const graph = createLayoutGraph(
      parseSMILES('CNCC(=O)N[C@@H](CCCN=C(N)N)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](Cc1ccc(S)cc1)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](Cc2c[nH]cn2)C(=O)N3CCC[C@@H]3C(=O)N[C@@H](Cc4ccccc4)C(=O)O'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const start = Date.now();
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const elapsed = Date.now() - start;

    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, result.atomIds.length);
    assert.ok(elapsed < 3500, `expected the mixed peptide outlier to stay below the local branch-search budget, got ${elapsed}ms`);
  });

  it('keeps an ethynyl substituent pointing outward and linear from the ring', () => {
    const graph = createLayoutGraph(makePhenylacetylene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAnchor = result.coords.get('a0');
    const ringNeighborCenter = centroid([result.coords.get('a1'), result.coords.get('a5')]);
    const outward = sub(ringAnchor, ringNeighborCenter);
    const firstBond = sub(result.coords.get('a6'), ringAnchor);
    const secondBond = sub(result.coords.get('a7'), result.coords.get('a6'));
    const outwardDot = outward.x * firstBond.x + outward.y * firstBond.y;
    const chainCross = firstBond.x * secondBond.y - firstBond.y * secondBond.x;
    const chainDot = firstBond.x * secondBond.x + firstBond.y * secondBond.y;

    assert.equal(result.supported, true);
    assert.ok(outwardDot > 0.5);
    assert.ok(Math.abs(chainCross) < 1e-6);
    assert.ok(chainDot > 0);
  });

  it('keeps a single-attached benzene root oriented so the outgoing heavy substituent reads horizontally', () => {
    const graph = createLayoutGraph(parseSMILES('C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const benzene = graph.rings.find(ring => ring.aromatic && ring.atomIds.length === 6);
    const benzeneAtomIdSet = new Set(benzene?.atomIds ?? []);
    const anchorAtomId = benzene?.atomIds.find(atomId => {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      if (!atom) {
        return false;
      }
      return atom.getNeighbors(graph.sourceMolecule).some(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !benzeneAtomIdSet.has(neighborAtom.id));
    });
    const anchorPosition = anchorAtomId ? result.coords.get(anchorAtomId) : null;
    const childAtomId = anchorAtomId
      ? graph.sourceMolecule.atoms
          .get(anchorAtomId)
          ?.getNeighbors(graph.sourceMolecule)
          .find(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !benzeneAtomIdSet.has(neighborAtom.id))?.id
      : null;
    const childPosition = childAtomId ? result.coords.get(childAtomId) : null;
    const outgoingAngle = anchorPosition && childPosition ? angleOf(sub(childPosition, anchorPosition)) : null;
    const horizontalDeviation = outgoingAngle == null ? Number.POSITIVE_INFINITY : Math.min(angularDifference(outgoingAngle, 0), angularDifference(outgoingAngle, Math.PI));

    assert.equal(result.supported, true);
    assert.ok(anchorAtomId, 'expected a monosubstituted benzene anchor');
    assert.ok(childAtomId, 'expected a heavy substituent attached to the benzene anchor');
    assert.ok(horizontalDeviation < 0.2, `expected the benzene substituent bond to read nearly horizontal, got ${horizontalDeviation.toFixed(3)} rad`);
  });

  it('keeps a fused-ring methyl substituent outside the ring system', () => {
    const graph = createLayoutGraph(makeMethylnaphthalene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringCenter = centroid(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'].map(atomId => result.coords.get(atomId)));
    const outward = sub(result.coords.get('a0'), ringCenter);
    const methylBond = sub(result.coords.get('a10'), result.coords.get('a0'));
    const outwardDot = outward.x * methylBond.x + outward.y * methylBond.y;

    assert.equal(result.supported, true);
    assert.ok(outwardDot > 0.5);
  });

  it('keeps a heavy ring substituent on the outward axis even when the anchor also carries an explicit hydrogen', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CCCCC1'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ring = graph.rings[0];
    const ringAtomSet = new Set(ring.atomIds);
    const ringCenter = centroid(ring.atomIds.map(atomId => result.coords.get(atomId)));
    let anchorAtomId = null;
    let heavyChildAtomId = null;
    let hydrogenChildIds = [];

    for (const atomId of ring.atomIds) {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      const heavyChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !ringAtomSet.has(neighborAtom.id))
        .map(neighborAtom => neighborAtom.id);
      const hydrogenChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom?.name === 'H')
        .map(neighborAtom => neighborAtom.id);
      if (heavyChildren.length === 1 && hydrogenChildren.length > 0) {
        anchorAtomId = atomId;
        heavyChildAtomId = heavyChildren[0];
        hydrogenChildIds = hydrogenChildren;
        break;
      }
    }

    assert.equal(result.supported, true);
    assert.ok(anchorAtomId, 'expected a ring anchor with one heavy substituent and at least one explicit hydrogen');
    const outwardAngle = angleOf(sub(result.coords.get(anchorAtomId), ringCenter));
    const heavyAngle = angleOf(sub(result.coords.get(heavyChildAtomId), result.coords.get(anchorAtomId)));
    const heavyDeviation = angularDifference(heavyAngle, outwardAngle);
    const hydrogenDeviations = hydrogenChildIds.map(hydrogenAtomId =>
      angularDifference(angleOf(sub(result.coords.get(hydrogenAtomId), result.coords.get(anchorAtomId))), outwardAngle)
    );

    assert.ok(heavyDeviation < 0.4, `expected heavy substituent to stay near the ring outward axis, got ${heavyDeviation.toFixed(3)} rad`);
    assert.ok(
      hydrogenDeviations.every(deviation => deviation > heavyDeviation),
      'expected explicit hydrogens to yield to the heavier substituent'
    );
  });

  it('keeps explicit-hydrogen-bearing substituents on the steroid nucleus aligned to their local ring outward directions', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)OC'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAtomSet = new Set(graph.ringSystems[0].atomIds);
    const checkedAnchors = [];

    for (const atomId of graph.ringSystems[0].atomIds) {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      const heavyChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !ringAtomSet.has(neighborAtom.id))
        .map(neighborAtom => neighborAtom.id);
      const hydrogenChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom?.name === 'H')
        .map(neighborAtom => neighborAtom.id);
      if (heavyChildren.length !== 1 || hydrogenChildren.length === 0) {
        continue;
      }
      const heavyAngle = angleOf(sub(result.coords.get(heavyChildren[0]), result.coords.get(atomId)));
      const bestLocalDeviation = Math.min(
        ...graph.rings
          .filter(ring => ring.atomIds.includes(atomId))
          .map(ring => angularDifference(heavyAngle, angleOf(sub(result.coords.get(atomId), centroid(ring.atomIds.map(ringAtomId => result.coords.get(ringAtomId)))))))
      );
      checkedAnchors.push({ atomId, bestLocalDeviation });
      assert.ok(bestLocalDeviation < 0.4, `expected ${atomId} substituent to follow a local outward ring direction, got ${bestLocalDeviation.toFixed(3)} rad`);
    }

    assert.ok(checkedAnchors.length >= 3, 'expected multiple explicit-hydrogen-bearing ring substituents to be checked');
  });

  it('places the terminal steroid alcohol on the exact local ring-outward angle when that direction is already safe', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)N'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAtomSet = new Set(graph.ringSystems[0].atomIds);
    let bestLocalDeviation = null;

    for (const atomId of graph.ringSystems[0].atomIds) {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      const oxygenChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom && neighborAtom.name === 'O' && !ringAtomSet.has(neighborAtom.id))
        .map(neighborAtom => neighborAtom.id);
      if (oxygenChildren.length !== 1) {
        continue;
      }
      const oxygenAngle = angleOf(sub(result.coords.get(oxygenChildren[0]), result.coords.get(atomId)));
      bestLocalDeviation = Math.min(
        ...graph.rings
          .filter(ring => ring.atomIds.includes(atomId))
          .map(ring => angularDifference(oxygenAngle, angleOf(sub(result.coords.get(atomId), centroid(ring.atomIds.map(ringAtomId => result.coords.get(ringAtomId)))))))
      );
      break;
    }

    assert.notEqual(bestLocalDeviation, null);
    assert.ok(bestLocalDeviation < 1e-6, `expected terminal alcohol to follow the exact local outward angle, got ${bestLocalDeviation?.toFixed(6)} rad`);
  });

  it('keeps the reported fused-ring bug-case substituents outside incident ring faces', () => {
    const firstGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O'), { suppressH: true });
    const secondGraph = createLayoutGraph(parseSMILES('C1CCC2C3CCC4=CC(=O)CCC4(C3CCC12C)C'), { suppressH: true });
    const firstComponent = firstGraph.components[0];
    const secondComponent = secondGraph.components[0];
    const firstResult = layoutMixedFamily(
      firstGraph,
      firstComponent,
      buildAdjacency(firstGraph, new Set(firstComponent.atomIds)),
      buildScaffoldPlan(firstGraph, firstComponent),
      firstGraph.options.bondLength
    );
    const secondResult = layoutMixedFamily(
      secondGraph,
      secondComponent,
      buildAdjacency(secondGraph, new Set(secondComponent.atomIds)),
      buildScaffoldPlan(secondGraph, secondComponent),
      secondGraph.options.bondLength
    );

    assert.deepEqual(inwardRingSubstituents(firstGraph, firstResult.coords), []);
    assert.deepEqual(inwardRingSubstituents(secondGraph, secondResult.coords), []);
  });

  it('avoids stacking a pending ring attachment onto an occupied preferred angle at a crowded quaternary center', () => {
    const graph = createLayoutGraph(parseSMILES('C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const phenylAttachment = result.coords.get('C4');
    const cyclopropylAttachment = result.coords.get('C8');
    const separation = Math.hypot(cyclopropylAttachment.x - phenylAttachment.x, cyclopropylAttachment.y - phenylAttachment.y);

    assert.equal(result.supported, true);
    assert.ok(Math.abs(separation - graph.options.bondLength) < 0.05, `expected C4/C8 separation to stay near one bond length, got ${separation.toFixed(3)}`);
  });

  it('defers explicit hydrogens until attached ring blocks can finish an exocyclic alkene trigonal center', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C1(CCCC2=CC=C3CC(CCC3=C)O)C'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const separations = sortedNeighborSeparations(adjacency, result.coords, 'C19');

    assert.equal(result.supported, true);
    assert.equal(separations.length, 3);
    for (const separation of separations) {
      assert.ok(Math.abs(separation - (2 * Math.PI) / 3) < 0.05, `expected C19 trigonal separations near 120 degrees, got ${((separation * 180) / Math.PI).toFixed(2)}`);
    }
  });

  it('chooses the mirrored attached-ring orientation when it gives an exocyclic alkene a cleaner trigonal geometry', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C1(CCCC2=CC=C3CC(CCC3=C)O)C'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const separations = sortedNeighborSeparations(adjacency, result.coords, 'C25');

    assert.equal(result.supported, true);
    assert.equal(separations.length, 3);
    for (const separation of separations) {
      assert.ok(Math.abs(separation - (2 * Math.PI) / 3) < 0.05, `expected C25 trigonal separations near 120 degrees, got ${((separation * 180) / Math.PI).toFixed(2)}`);
    }
  });

  it('lays out directly attached ring systems in deterministic sequence', () => {
    const graph = createLayoutGraph(makeBiphenyl());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const firstRingCenter = centroid(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'].map(atomId => result.coords.get(atomId)));
    const secondRingCenter = centroid(['b0', 'b1', 'b2', 'b3', 'b4', 'b5'].map(atomId => result.coords.get(atomId)));
    const linkerAxis = angleOf(sub(result.coords.get('b0'), result.coords.get('a0')));
    const centerAxis = angleOf(sub(secondRingCenter, firstRingCenter));
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 12);
    assert.ok(result.coords.has('a0'));
    assert.ok(result.coords.has('b0'));
    assert.ok(angularDifference(linkerAxis, centerAxis) < 0.15, 'expected directly linked phenyl rings to share a straight centroid axis');
  });

  it('lays out a chain-linked second ring system after the connector becomes reachable', () => {
    const graph = createLayoutGraph(makeBibenzyl());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const firstAngle = bondAngleAtAtom(result.coords, 'c0', 'a0', 'c1');
    const secondAngle = bondAngleAtAtom(result.coords, 'c1', 'c0', 'b0');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 14);
    assert.ok(result.coords.has('c0'));
    assert.ok(result.coords.has('c1'));
    assert.ok(result.coords.has('b0'));
    assert.ok(Math.abs(firstAngle - (2 * Math.PI) / 3) < 0.2, `expected first bibenzyl linker angle near 120 degrees, got ${((firstAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(secondAngle - (2 * Math.PI) / 3) < 0.2, `expected second bibenzyl linker angle near 120 degrees, got ${((secondAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('lays out a methylene-linked second ring with a standard 120-degree linker angle', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccccc1Cc1ccccc1'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const linkerAtomId = 'C7';
    const firstRingAttachmentAtomId = 'C6';
    const secondRingAttachmentAtomId = 'C8';
    const linkerAngle = bondAngleAtAtom(result.coords, linkerAtomId, firstRingAttachmentAtomId, secondRingAttachmentAtomId);

    assert.equal(result.supported, true);
    assert.ok(Math.abs(linkerAngle - (2 * Math.PI) / 3) < 0.2, `expected diphenylmethane linker angle near 120 degrees, got ${((linkerAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('lays out a macrocycle root scaffold plus substituent through the mixed orchestrator', () => {
    const graph = createLayoutGraph(makeMacrocycleWithSubstituent());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 13);
    assert.ok(result.coords.has('a0'));
    assert.ok(result.coords.has('a12'));
  });
});
