/** @module geometry/atom-grid */

/**
 * Uniform spatial grid for fast proximity queries on placed atom coordinates.
 *
 * Cells are indexed by integer (xIndex, yIndex) pairs stored in a two-level
 * Map<number, Map<number, Set<string>>> to avoid string key allocations.
 */
export class AtomGrid {
  /**
   * Creates a new atom grid.
   * @param {number} cellSize - Grid cell side length.
   */
  constructor(cellSize) {
    this.cellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;
    this.cells = new Map(); // Map<xIndex: number, Map<yIndex: number, Set<atomId: string>>>
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
    const xIndex = Math.floor(position.x / this.cellSize);
    const yIndex = Math.floor(position.y / this.cellSize);
    let col = this.cells.get(xIndex);
    if (!col) {
      col = new Map();
      this.cells.set(xIndex, col);
    }
    let cell = col.get(yIndex);
    if (!cell) {
      cell = new Set();
      col.set(yIndex, cell);
    }
    cell.add(atomId);
  }

  /**
   * Removes an atom ID from the grid at the given position.
   * @param {string} atomId - Atom identifier.
   * @param {{x: number, y: number}} position - Atom position.
   * @returns {void}
   */
  remove(atomId, position) {
    const xIndex = Math.floor(position.x / this.cellSize);
    const yIndex = Math.floor(position.y / this.cellSize);
    const col = this.cells.get(xIndex);
    if (!col) {
      return;
    }
    const cell = col.get(yIndex);
    if (!cell) {
      return;
    }
    cell.delete(atomId);
    if (cell.size === 0) {
      col.delete(yIndex);
      if (col.size === 0) {
        this.cells.delete(xIndex);
      }
    }
  }

  /**
   * Returns atom IDs within the queried radius neighborhood as a Set.
   * @param {{x: number, y: number}} position - Query position.
   * @param {number} radius - Query radius.
   * @returns {Set<string>} Candidate atom IDs near the position.
   */
  queryRadius(position, radius) {
    const xIndex = Math.floor(position.x / this.cellSize);
    const yIndex = Math.floor(position.y / this.cellSize);
    const cellRadius = Math.max(0, Math.ceil(radius / this.cellSize));
    const atomIds = new Set();
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      const col = this.cells.get(xIndex + dx);
      if (!col) {
        continue;
      }
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const cell = col.get(yIndex + dy);
        if (!cell) {
          continue;
        }
        for (const atomId of cell) {
          atomIds.add(atomId);
        }
      }
    }
    return atomIds;
  }

  /**
   * Returns a deep copy of the grid.
   * @returns {AtomGrid} Cloned grid.
   */
  clone() {
    const clone = new AtomGrid(this.cellSize);
    for (const [xIndex, col] of this.cells) {
      const newCol = new Map();
      for (const [yIndex, cell] of col) {
        newCol.set(yIndex, new Set(cell));
      }
      clone.cells.set(xIndex, newCol);
    }
    return clone;
  }
}
