import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MetabolicNetwork } from '../../src/network/MetabolicNetwork.js';
import { parseSMILES, toCanonicalSMILES } from '../../src/io/index.js';

describe('MetabolicNetwork', () => {
  it('addSeed registers a generation-0 seed node', () => {
    const network = new MetabolicNetwork();
    const anisole = parseSMILES('COc1ccccc1');
    network.addSeed(anisole);

    assert.equal(network.getGeneration(anisole), 0);
    assert.equal(network.isSeed(anisole), true);
    assert.equal(network.reactionNetwork.moleculeNodes.size, 1);
  });

  it('generate() cascades the default rule set across generations and tracks generation distance', () => {
    const network = new MetabolicNetwork({ maxGenerations: 2 });
    const anisole = parseSMILES('COc1ccccc1');
    network.addSeed(anisole);

    const summary = network.generate();
    assert.equal(summary.truncated, false);
    assert.equal(summary.generationsRun, 2);

    const phenol = parseSMILES('Oc1ccccc1');
    const formaldehyde = parseSMILES('C=O');
    const phenylSulfate = parseSMILES('OS(=O)(=O)Oc1ccccc1');

    assert.equal(network.getGeneration(phenol), 1, 'phenol arises from one O-demethylation of the seed');
    assert.equal(network.getGeneration(formaldehyde), 1, 'formaldehyde is the O-demethylation co-product');
    assert.equal(network.isSeed(phenol), false);
    assert.equal(network.getGeneration(phenylSulfate), 2, 'phenyl sulfate requires a second-generation sulfation of phenol');
  });

  it('generate() is idempotent — a second call retries no already-attempted molecule/template pair', () => {
    const network = new MetabolicNetwork({ maxGenerations: 2 });
    network.addSeed(parseSMILES('COc1ccccc1'));
    network.generate();

    const moleculeCountBefore = network.reactionNetwork.moleculeNodes.size;
    const reactionCountBefore = network.reactionNetwork.reactionNodes.size;

    const secondSummary = network.generate();

    assert.equal(network.reactionNetwork.moleculeNodes.size, moleculeCountBefore);
    assert.equal(network.reactionNetwork.reactionNodes.size, reactionCountBefore);
    assert.equal(secondSummary.moleculeCount, moleculeCountBefore);
  });

  it('maxNodes truncates expansion and reports truncated: true', () => {
    // maxNodes is a soft breaker: the size check runs before each template call, but a single
    // call can add several products at once (e.g. aromaticHydroxylation matching multiple ring
    // sites), so the final count can overshoot maxNodes by a small, bounded amount.
    const network = new MetabolicNetwork({ maxGenerations: 3, maxNodes: 3 });
    network.addSeed(parseSMILES('Nc1ccccc1'));

    const summary = network.generate();

    assert.equal(summary.truncated, true);
    assert.ok(network.reactionNetwork.moleculeNodes.size <= 10, 'overshoot beyond maxNodes should stay small');
  });

  it('getMetabolitesByPhase and getMetabolitesByEnzymeFamily filter by reaction metadata', () => {
    const network = new MetabolicNetwork({ maxGenerations: 2 });
    network.addSeed(parseSMILES('COc1ccccc1'));
    network.generate();

    const phaseOneNodes = network.getMetabolitesByPhase('I');
    const phaseTwoNodes = network.getMetabolitesByPhase('II');
    const ugtNodes = network.getMetabolitesByEnzymeFamily('UGT');

    assert.ok(phaseOneNodes.length > 0);
    assert.ok(phaseTwoNodes.length > 0);
    assert.ok(ugtNodes.length > 0);
    assert.ok(
      phaseOneNodes.some(node => toCanonicalSMILES(node.molecule) === toCanonicalSMILES(parseSMILES('Oc1ccccc1'))),
      'phenol is attributed to a Phase I reaction'
    );
  });

  it('getTerminalMetabolites returns nodes with no outgoing reaction', () => {
    const network = new MetabolicNetwork({ maxGenerations: 2 });
    network.addSeed(parseSMILES('COc1ccccc1'));
    network.generate();

    const terminal = network.getTerminalMetabolites();
    const terminalSmiles = new Set(terminal.map(node => toCanonicalSMILES(node.molecule)));
    assert.ok(terminalSmiles.has(toCanonicalSMILES(parseSMILES('C=O'))), 'formaldehyde has no further matching template');
  });

  it('exportDirectedGraph annotates molecule nodes with generation and isSeed', () => {
    const network = new MetabolicNetwork({ maxGenerations: 1 });
    const anisole = parseSMILES('COc1ccccc1');
    network.addSeed(anisole);
    network.generate();

    const graph = network.exportDirectedGraph({ flatten: true });
    const anisoleNode = graph.nodes.find(node => node.type === 'molecule' && node.smiles === toCanonicalSMILES(anisole));
    const phenolNode = graph.nodes.find(node => node.type === 'molecule' && node.smiles === toCanonicalSMILES(parseSMILES('Oc1ccccc1')));

    assert.equal(anisoleNode.generation, 0);
    assert.equal(anisoleNode.isSeed, true);
    assert.equal(phenolNode.generation, 1);
    assert.equal(phenolNode.isSeed, false);
  });

  it('generate() accepts a templateIds subset to restrict the applied rule set', () => {
    const network = new MetabolicNetwork({ maxGenerations: 1 });
    network.addSeed(parseSMILES('COc1ccccc1'));

    const summary = network.generate({ templateIds: ['oDemethylation'] });

    assert.equal(summary.moleculeCount, 3); // anisole seed + phenol + formaldehyde
    assert.equal(network.getMetabolitesByEnzymeFamily('UGT').length, 0, 'glucuronidation was excluded from this run');
  });
});
