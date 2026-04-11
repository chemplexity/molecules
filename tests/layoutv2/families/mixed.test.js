import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/index.js';
import { pointInPolygon } from '../../../src/layoutv2/geometry/polygon.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { buildScaffoldPlan } from '../../../src/layoutv2/model/scaffold-plan.js';
import { layoutMixedFamily } from '../../../src/layoutv2/families/mixed.js';
import { angleOf, angularDifference, centroid, sub } from '../../../src/layoutv2/geometry/vec2.js';
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
    const heavyChildren = atom.getNeighbors(layoutGraph.sourceMolecule)
      .filter(neighbor => neighbor && neighbor.name !== 'H' && !ringAtomSet.has(neighbor.id))
      .map(neighbor => neighbor.id);
    if (heavyChildren.length !== 1) {
      continue;
    }
    const childId = heavyChildren[0];
    const childPosition = coords.get(childId);
    const insideIncidentRing = (layoutGraph.atomToRings.get(atomId) ?? []).some(ring => pointInPolygon(
      childPosition,
      ring.atomIds.map(ringAtomId => coords.get(ringAtomId))
    ));
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
    separations.push(rawGap > 0 ? rawGap : rawGap + (Math.PI * 2));
  }

  return separations.sort((firstSeparation, secondSeparation) => firstSeparation - secondSeparation);
}

describe('layoutv2/families/mixed', () => {
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
      return atom.getNeighbors(graph.sourceMolecule).some(neighborAtom => neighborAtom
        && neighborAtom.name !== 'H'
        && !benzeneAtomIdSet.has(neighborAtom.id));
    });
    const anchorPosition = anchorAtomId ? result.coords.get(anchorAtomId) : null;
    const childAtomId = anchorAtomId
      ? graph.sourceMolecule.atoms.get(anchorAtomId)?.getNeighbors(graph.sourceMolecule).find(neighborAtom => neighborAtom
        && neighborAtom.name !== 'H'
        && !benzeneAtomIdSet.has(neighborAtom.id))?.id
      : null;
    const childPosition = childAtomId ? result.coords.get(childAtomId) : null;
    const outgoingAngle = anchorPosition && childPosition ? angleOf(sub(childPosition, anchorPosition)) : null;
    const horizontalDeviation = outgoingAngle == null
      ? Number.POSITIVE_INFINITY
      : Math.min(angularDifference(outgoingAngle, 0), angularDifference(outgoingAngle, Math.PI));

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
      const heavyChildren = atom.getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !ringAtomSet.has(neighborAtom.id))
        .map(neighborAtom => neighborAtom.id);
      const hydrogenChildren = atom.getNeighbors(graph.sourceMolecule)
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
    const hydrogenDeviations = hydrogenChildIds.map(hydrogenAtomId => angularDifference(
      angleOf(sub(result.coords.get(hydrogenAtomId), result.coords.get(anchorAtomId))),
      outwardAngle
    ));

    assert.ok(heavyDeviation < 0.4, `expected heavy substituent to stay near the ring outward axis, got ${heavyDeviation.toFixed(3)} rad`);
    assert.ok(hydrogenDeviations.every(deviation => deviation > heavyDeviation), 'expected explicit hydrogens to yield to the heavier substituent');
  });

  it('keeps explicit-hydrogen-bearing substituents on the steroid nucleus aligned to their local ring outward directions', () => {
    const graph = createLayoutGraph(
      parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)OC'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAtomSet = new Set(graph.ringSystems[0].atomIds);
    const checkedAnchors = [];

    for (const atomId of graph.ringSystems[0].atomIds) {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      const heavyChildren = atom.getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !ringAtomSet.has(neighborAtom.id))
        .map(neighborAtom => neighborAtom.id);
      const hydrogenChildren = atom.getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom?.name === 'H')
        .map(neighborAtom => neighborAtom.id);
      if (heavyChildren.length !== 1 || hydrogenChildren.length === 0) {
        continue;
      }
      const heavyAngle = angleOf(sub(result.coords.get(heavyChildren[0]), result.coords.get(atomId)));
      const bestLocalDeviation = Math.min(...graph.rings
        .filter(ring => ring.atomIds.includes(atomId))
        .map(ring => angularDifference(
          heavyAngle,
          angleOf(sub(result.coords.get(atomId), centroid(ring.atomIds.map(ringAtomId => result.coords.get(ringAtomId)))))
        )));
      checkedAnchors.push({ atomId, bestLocalDeviation });
      assert.ok(
        bestLocalDeviation < 0.4,
        `expected ${atomId} substituent to follow a local outward ring direction, got ${bestLocalDeviation.toFixed(3)} rad`
      );
    }

    assert.ok(checkedAnchors.length >= 3, 'expected multiple explicit-hydrogen-bearing ring substituents to be checked');
  });

  it('keeps the reported fused-ring bug-case substituents outside incident ring faces', () => {
    const firstGraph = createLayoutGraph(
      parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O'),
      { suppressH: true }
    );
    const secondGraph = createLayoutGraph(
      parseSMILES('C1CCC2C3CCC4=CC(=O)CCC4(C3CCC12C)C'),
      { suppressH: true }
    );
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
    const graph = createLayoutGraph(
      parseSMILES('C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(
      graph,
      component,
      adjacency,
      buildScaffoldPlan(graph, component),
      graph.options.bondLength
    );
    const phenylAttachment = result.coords.get('C4');
    const cyclopropylAttachment = result.coords.get('C8');
    const separation = Math.hypot(
      cyclopropylAttachment.x - phenylAttachment.x,
      cyclopropylAttachment.y - phenylAttachment.y
    );

    assert.equal(result.supported, true);
    assert.ok(Math.abs(separation - graph.options.bondLength) < 0.05, `expected C4/C8 separation to stay near one bond length, got ${separation.toFixed(3)}`);
  });

  it('defers explicit hydrogens until attached ring blocks can finish an exocyclic alkene trigonal center', () => {
    const graph = createLayoutGraph(
      parseSMILES('CC(C)CCCC(C)C1CCC2C1(CCCC2=CC=C3CC(CCC3=C)O)C'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(
      graph,
      component,
      adjacency,
      buildScaffoldPlan(graph, component),
      graph.options.bondLength
    );
    const separations = sortedNeighborSeparations(adjacency, result.coords, 'C19');

    assert.equal(result.supported, true);
    assert.equal(separations.length, 3);
    for (const separation of separations) {
      assert.ok(
        Math.abs(separation - ((2 * Math.PI) / 3)) < 0.05,
        `expected C19 trigonal separations near 120 degrees, got ${(separation * 180 / Math.PI).toFixed(2)}`
      );
    }
  });

  it('chooses the mirrored attached-ring orientation when it gives an exocyclic alkene a cleaner trigonal geometry', () => {
    const graph = createLayoutGraph(
      parseSMILES('CC(C)CCCC(C)C1CCC2C1(CCCC2=CC=C3CC(CCC3=C)O)C'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(
      graph,
      component,
      adjacency,
      buildScaffoldPlan(graph, component),
      graph.options.bondLength
    );
    const separations = sortedNeighborSeparations(adjacency, result.coords, 'C25');

    assert.equal(result.supported, true);
    assert.equal(separations.length, 3);
    for (const separation of separations) {
      assert.ok(
        Math.abs(separation - ((2 * Math.PI) / 3)) < 0.05,
        `expected C25 trigonal separations near 120 degrees, got ${(separation * 180 / Math.PI).toFixed(2)}`
      );
    }
  });

  it('lays out directly attached ring systems in deterministic sequence', () => {
    const graph = createLayoutGraph(makeBiphenyl());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 12);
    assert.ok(result.coords.has('a0'));
    assert.ok(result.coords.has('b0'));
  });

  it('lays out a chain-linked second ring system after the connector becomes reachable', () => {
    const graph = createLayoutGraph(makeBibenzyl());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 14);
    assert.ok(result.coords.has('c0'));
    assert.ok(result.coords.has('c1'));
    assert.ok(result.coords.has('b0'));
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
