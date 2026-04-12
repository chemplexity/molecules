/** @module geometry/atom-grid */

function cellKey(xIndex, yIndex) {
  return `${xIndex},${yIndex}`;
}

/**
 * Uniform spatial grid for fast atom proximity queries.
 * @param {number} cellSize - Grid cell side length.
 * @returns {number} Normalized positive cell size.
 */
function normalizeCellSize(cellSize) {
  return Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;
}

/**
 * Uniform spatial grid for fast proximity queries on placed atom coordinates.
 */
export class AtomGrid {
  /**
   * Creates a new atom grid.
   * @param {number} cellSize - Grid cell side length.
   */
  constructor(cellSize) {
    this.cellSize = normalizeCellSize(cellSize);
    this.cells = new Map();
  }

  /**
   * Returns the integer cell indices for a coordinate.
   * @param {{x: number, y: number}} position - Query position.
   * @returns {{xIndex: number, yIndex: number}} Cell indices.
   */
  cellIndices(position) {
    return {
      xIndex: Math.floor(position.x / this.cellSize),
      yIndex: Math.floor(position.y / this.cellSize)
    };
  }

  /**
   * Inserts an atom ID at the given position.
   * @param {string} atomId - Atom identifier.
   * @param {{x: number, y: number}} position - Atom position.
   * @returns {void}
   */
  insert(atomId, position) {
    const { xIndex, yIndex } = this.cellIndices(position);
    const key = cellKey(xIndex, yIndex);
    if (!this.cells.has(key)) {
      this.cells.set(key, new Set());
    }
    this.cells.get(key).add(atomId);
  }

  /**
   * Removes an atom ID from the grid at the given position.
   * @param {string} atomId - Atom identifier.
   * @param {{x: number, y: number}} position - Atom position.
   * @returns {void}
   */
  remove(atomId, position) {
    const { xIndex, yIndex } = this.cellIndices(position);
    const key = cellKey(xIndex, yIndex);
    const cell = this.cells.get(key);
    if (!cell) {
      return;
    }
    cell.delete(atomId);
    if (cell.size === 0) {
      this.cells.delete(key);
    }
  }

  /**
   * Returns atom IDs within the queried radius neighborhood.
   * @param {{x: number, y: number}} position - Query position.
   * @param {number} radius - Query radius.
   * @returns {string[]} Candidate atom IDs near the position.
   */
  queryRadius(position, radius) {
    const { xIndex, yIndex } = this.cellIndices(position);
    const cellRadius = Math.max(0, Math.ceil(radius / this.cellSize));
    const atomIds = new Set();
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const cell = this.cells.get(cellKey(xIndex + dx, yIndex + dy));
        if (!cell) {
          continue;
        }
        for (const atomId of cell) {
          atomIds.add(atomId);
        }
      }
    }
    return [...atomIds];
  }

  /**
   * Returns a deep copy of the grid.
   * @returns {AtomGrid} Cloned grid.
   */
  clone() {
    const clone = new AtomGrid(this.cellSize);
    for (const [key, atomIds] of this.cells) {
      clone.cells.set(key, new Set(atomIds));
    }
    return clone;
  }
}
