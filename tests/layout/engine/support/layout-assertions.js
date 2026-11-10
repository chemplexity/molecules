import assert from 'node:assert/strict';

/**
 * Requires finite coordinates for every heavy atom represented by a layout.
 * @param {object} result - Generated or refined layout result.
 * @returns {void}
 */
export function assertFiniteHeavyCoordinates(result) {
  for (const [atomId, atom] of result.layoutGraph.atoms) {
    if (atom.element === 'H') {
      continue;
    }
    const position = result.coords.get(atomId);
    assert.ok(position, `expected coordinates for heavy atom ${atomId}`);
    assert.equal(Number.isFinite(position.x), true);
    assert.equal(Number.isFinite(position.y), true);
  }
}
