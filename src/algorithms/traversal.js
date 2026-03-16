/** @module algorithms/traversal */

/**
 * Performs a breadth-first search starting from the given atom.
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {string} startId - ID of the starting atom.
 * @returns {{ visited: string[], parent: Map<string, string|null>, depth: Map<string, number> }}
 */
export function bfs(molecule, startId) {
  const visited = [];
  const parent = new Map();
  const depth = new Map();
  const queue = [startId];

  parent.set(startId, null);
  depth.set(startId, 0);

  while (queue.length > 0) {
    const current = queue.shift();
    visited.push(current);

    for (const neighbor of molecule.getNeighbors(current)) {
      if (!parent.has(neighbor)) {
        parent.set(neighbor, current);
        depth.set(neighbor, depth.get(current) + 1);
        queue.push(neighbor);
      }
    }
  }

  return { visited, parent, depth };
}

/**
 * Performs a depth-first search starting from the given atom.
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {string} startId - ID of the starting atom.
 * @returns {{ visited: string[], parent: Map<string, string|null>, finishOrder: string[] }}
 */
export function dfs(molecule, startId) {
  const visited = new Set();
  const parent = new Map();
  const finishOrder = [];

  parent.set(startId, null);

  /**
   * @param {string} id
   */
  function visit(id) {
    visited.add(id);
    for (const neighbor of molecule.getNeighbors(id)) {
      if (!visited.has(neighbor)) {
        parent.set(neighbor, id);
        visit(neighbor);
      }
    }
    finishOrder.push(id);
  }

  visit(startId);

  return { visited: [...visited], parent, finishOrder };
}
