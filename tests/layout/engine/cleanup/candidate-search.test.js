import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { visitPresentationDescriptorCandidates } from '../../../../src/layout/engine/cleanup/candidate-search.js';

describe('layout/engine/cleanup/candidate-search', () => {
  it('dedupes equivalent sparse overrides while tracking visited and accepted candidates', () => {
    const coords = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 1, y: 0 }]
    ]);
    const acceptedSeeds = [];

    const search = visitPresentationDescriptorCandidates(null, coords, { id: 'descriptor' }, {
      generateSeeds: () => [
        { id: 'duplicate-1', x: 2 },
        { id: 'duplicate-2', x: 2 },
        { id: 'best', x: 3 }
      ],
      materializeOverrides(_coords, _descriptor, seed) {
        return new Map([['B', { x: seed.x, y: 0 }]]);
      },
      scoreSeed(_descriptor, candidateCoords, seed) {
        return {
          seedId: seed.id,
          x: candidateCoords.get('B').x
        };
      },
      isBetterScore(candidate, incumbent) {
        return candidate.x > incumbent.x;
      },
      onAcceptedCandidate(candidate) {
        acceptedSeeds.push(candidate.seed.id);
      }
    });

    assert.equal(search.visitedCount, 2);
    assert.equal(search.acceptedCount, 2);
    assert.deepEqual(acceptedSeeds, ['duplicate-1', 'best']);
    assert.equal(search.bestSeedCandidate?.seed.id, 'best');
    assert.equal(search.bestFinalCandidate?.score.x, 3);
  });

  it('runs bounded post-accept followups only for the selected best raw seed', () => {
    const coords = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 1, y: 0 }]
    ]);
    const followupSeeds = [];

    const search = visitPresentationDescriptorCandidates(null, coords, { id: 'descriptor' }, {
      generateSeeds: () => [
        { id: 'weaker', rawScore: 1 },
        { id: 'stronger', rawScore: 4 }
      ],
      materializeOverrides(_coords, _descriptor, seed) {
        return new Map([['B', { x: seed.rawScore, y: 0 }]]);
      },
      scoreSeed(_descriptor, _candidateCoords, seed) {
        return { value: seed.rawScore };
      },
      postAcceptFollowups: [
        {
          name: 'refine',
          maxRuns: 2,
          run(_layoutGraph, candidateCoords, _descriptor, seed, _context, _state, runIndex) {
            followupSeeds.push(seed.id);
            return {
              coords: new Map([
                ...candidateCoords.entries(),
                ['B', { x: candidateCoords.get('B').x + runIndex + 1, y: 0 }]
              ]),
              changed: runIndex === 0,
              score: { value: seed.rawScore + 10 + runIndex }
            };
          }
        }
      ],
      scoreRefined(_descriptor, _candidateCoords, _seed, _context, state) {
        return state.followupResults.at(-1)?.score ?? null;
      },
      isBetterScore(candidate, incumbent) {
        return candidate.value > incumbent.value;
      }
    });

    assert.equal(search.bestSeedCandidate?.seed.id, 'stronger');
    assert.equal(search.bestFinalCandidate?.score.value, 15);
    assert.deepEqual(followupSeeds, ['stronger', 'stronger']);
    assert.equal(search.bestFinalCandidate?.followupResults.length, 2);
  });
});
