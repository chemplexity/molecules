/** @module descriptors/topological */

// ---------------------------------------------------------------------------
// Internal guards
// ---------------------------------------------------------------------------

function assertSquareMatrix(M, name) {
  if (!Array.isArray(M) || M.length === 0 || !Array.isArray(M[0])) {
    throw new TypeError(`${name} must be a non-empty 2D array.`);
  }
  const n = M.length;
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(M[i]) || M[i].length !== n) {
      throw new TypeError(`${name} must be a square (n×n) matrix — row ${i} has length ${M[i]?.length ?? 'undefined'}, expected ${n}.`);
    }
  }
}

function assertSameSize(M1, name1, M2, name2) {
  if (M1.length !== M2.length) {
    throw new TypeError(`${name1} and ${name2} must have the same dimensions — ${name1} is ${M1.length}×${M1.length} but ${name2} is ${M2.length}×${M2.length}.`);
  }
}

function assertDiagonalMatrix(M, name) {
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M.length; j++) {
      if (i !== j && M[i][j] !== 0) {
        throw new TypeError(`${name} must be a diagonal matrix — found non-zero value ${M[i][j]} at [${i}][${j}]. Pass the degree matrix from degreeMatrix().`);
      }
    }
  }
}

function assertFiniteDistanceMatrix(D, name) {
  for (let i = 0; i < D.length; i++) {
    for (let j = 0; j < D.length; j++) {
      if (!Number.isFinite(D[i][j])) {
        throw new TypeError(`${name} must represent a connected graph with finite distances — found ${D[i][j]} at [${i}][${j}].`);
      }
    }
  }
}

function assertMolecule(mol, name) {
  if (!mol || !(mol.atoms instanceof Map) || !(mol.bonds instanceof Map)) {
    throw new TypeError(`${name} must be a Molecule instance with .atoms and .bonds Maps.`);
  }
}

// ---------------------------------------------------------------------------

/**
 * Computes the Wiener index W = Σ D[i][j] for i < j.
 *
 * @param {number[][]} D - All-pairs shortest-path distance matrix.
 * @returns {number}
 */
export function wienerIndex(D) {
  assertSquareMatrix(D, 'D');
  assertFiniteDistanceMatrix(D, 'D');
  let sum = 0;
  for (let i = 0; i < D.length; i++) {
    for (let j = i + 1; j < D.length; j++) {
      sum += D[i][j];
    }
  }
  return sum;
}

/**
 * Computes the Hyper-Wiener index WW = (1/2) * Σ (D[i][j] + D[i][j]²) for i < j.
 *
 * @param {number[][]} D - All-pairs shortest-path distance matrix.
 * @returns {number}
 */
export function hyperWienerIndex(D) {
  assertSquareMatrix(D, 'D');
  assertFiniteDistanceMatrix(D, 'D');
  let sum = 0;
  for (let i = 0; i < D.length; i++) {
    for (let j = i + 1; j < D.length; j++) {
      sum += D[i][j] + D[i][j] ** 2;
    }
  }
  return sum / 2;
}

/**
 * Computes the Balaban J index.
 *
 * J = (m / (m - n + 2)) * Σ (s_i * s_j)^(-1/2) for each edge (i,j),
 * where s_i is the row sum of D for atom i, n = atom count, m = bond count.
 *
 * @param {number[][]} D - All-pairs shortest-path distance matrix.
 * @param {number[][]} A - Adjacency matrix.
 * @returns {number}
 */
export function balabanIndex(D, A) {
  assertSquareMatrix(D, 'D');
  assertSquareMatrix(A, 'A');
  assertSameSize(D, 'D', A, 'A');
  assertFiniteDistanceMatrix(D, 'D');
  const n = D.length;
  const rowSums = D.map(row => row.reduce((a, b) => a + b, 0));

  let edgeSum = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (A[i][j] === 1) {
        m++;
        edgeSum += 1 / Math.sqrt(rowSums[i] * rowSums[j]);
      }
    }
  }

  const cyclomatic = m - n + 2;
  return cyclomatic > 0 ? (m / cyclomatic) * edgeSum : 0;
}

/**
 * Computes the Randić connectivity index χ = Σ (deg(i) * deg(j))^(-1/2) for each edge.
 *
 * @param {number[][]} A - Adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function randicIndex(A, DEG) {
  assertSquareMatrix(A, 'A');
  assertSquareMatrix(DEG, 'DEG');
  assertSameSize(A, 'A', DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (A[i][j] === 1) {
        const di = DEG[i][i];
        const dj = DEG[j][j];
        if (di > 0 && dj > 0) {
          sum += 1 / Math.sqrt(di * dj);
        }
      }
    }
  }
  return sum;
}

/**
 * Computes the first Zagreb index M1 = Σ deg(i)².
 *
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function zagreb1(DEG) {
  assertSquareMatrix(DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  return DEG.reduce((sum, row, i) => sum + DEG[i][i] ** 2, 0);
}

/**
 * Computes the second Zagreb index M2 = Σ deg(i) * deg(j) for each edge (i,j).
 *
 * @param {number[][]} A - Adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function zagreb2(A, DEG) {
  assertSquareMatrix(A, 'A');
  assertSquareMatrix(DEG, 'DEG');
  assertSameSize(A, 'A', DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (A[i][j] === 1) {
        sum += DEG[i][i] * DEG[j][j];
      }
    }
  }
  return sum;
}

/**
 * Computes the Harary index H = (1/2) * Σ RD[i][j].
 *
 * @param {number[][]} RD - Reciprocal distance matrix.
 * @returns {number}
 */
export function hararyIndex(RD) {
  assertSquareMatrix(RD, 'RD');
  let sum = 0;
  for (let i = 0; i < RD.length; i++) {
    for (let j = i + 1; j < RD.length; j++) {
      sum += RD[i][j];
    }
  }
  return sum;
}

/**
 * Computes the Platt index F = Σ (deg(i) + deg(j) − 2) for each edge (i,j).
 *
 * Equivalently, F = M1 − 2m where M1 is the first Zagreb index and m is the
 * number of edges.
 *
 * @param {number[][]} A   - Adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function plattIndex(A, DEG) {
  assertSquareMatrix(A, 'A');
  assertSquareMatrix(DEG, 'DEG');
  assertSameSize(A, 'A', DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (A[i][j] === 1) {
        sum += DEG[i][i] + DEG[j][j] - 2;
      }
    }
  }
  return sum;
}

/**
 * Computes the Szeged index Sz = Σ n_u(e) × n_v(e) over all edges e = (u,v),
 * where n_u(e) is the number of vertices strictly closer to u than to v, and
 * n_v(e) is the number strictly closer to v. Vertices equidistant to both
 * are excluded from both counts.
 *
 * For acyclic graphs (trees) Sz equals the Wiener index.
 *
 * @param {number[][]} D - All-pairs shortest-path distance matrix.
 * @param {number[][]} A - Adjacency matrix.
 * @returns {number}
 */
export function szegedIndex(D, A) {
  assertSquareMatrix(D, 'D');
  assertSquareMatrix(A, 'A');
  assertSameSize(D, 'D', A, 'A');
  assertFiniteDistanceMatrix(D, 'D');
  const n = D.length;
  let sz = 0;
  for (let u = 0; u < n; u++) {
    for (let v = u + 1; v < n; v++) {
      if (A[u][v] !== 1) {
        continue;
      }
      let nu = 0;
      let nv = 0;
      for (let w = 0; w < n; w++) {
        if (D[w][u] < D[w][v]) {
          nu++;
        } else if (D[w][v] < D[w][u]) {
          nv++;
        }
      }
      sz += nu * nv;
    }
  }
  return sz;
}

/**
 * Computes the Atom-Bond Connectivity (ABC) index.
 *
 * ABC = Σ √((deg(i) + deg(j) − 2) / (deg(i) · deg(j))) for each edge (i,j).
 *
 * @param {number[][]} A   - Adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function abcIndex(A, DEG) {
  assertSquareMatrix(A, 'A');
  assertSquareMatrix(DEG, 'DEG');
  assertSameSize(A, 'A', DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (A[i][j] === 1) {
        const di = DEG[i][i];
        const dj = DEG[j][j];
        if (di > 0 && dj > 0) {
          sum += Math.sqrt((di + dj - 2) / (di * dj));
        }
      }
    }
  }
  return sum;
}

/**
 * Computes the Geometric-Arithmetic (GA) index.
 *
 * GA = Σ 2√(deg(i) · deg(j)) / (deg(i) + deg(j)) for each edge (i,j).
 *
 * @param {number[][]} A   - Adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function gaIndex(A, DEG) {
  assertSquareMatrix(A, 'A');
  assertSquareMatrix(DEG, 'DEG');
  assertSameSize(A, 'A', DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (A[i][j] === 1) {
        const di = DEG[i][i];
        const dj = DEG[j][j];
        if (di + dj > 0) {
          sum += (2 * Math.sqrt(di * dj)) / (di + dj);
        }
      }
    }
  }
  return sum;
}

/**
 * Computes the Harmonic index.
 *
 * H = Σ 2 / (deg(i) + deg(j)) for each edge (i,j).
 *
 * @param {number[][]} A   - Adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function harmonicIndex(A, DEG) {
  assertSquareMatrix(A, 'A');
  assertSquareMatrix(DEG, 'DEG');
  assertSameSize(A, 'A', DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (A[i][j] === 1) {
        const di = DEG[i][i];
        const dj = DEG[j][j];
        if (di + dj > 0) {
          sum += 2 / (di + dj);
        }
      }
    }
  }
  return sum;
}

/**
 * Computes the Sum-Connectivity index.
 *
 * χ_s = Σ 1 / √(deg(i) + deg(j)) for each edge (i,j).
 *
 * @param {number[][]} A   - Adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function sumConnectivityIndex(A, DEG) {
  assertSquareMatrix(A, 'A');
  assertSquareMatrix(DEG, 'DEG');
  assertSameSize(A, 'A', DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (A[i][j] === 1) {
        const di = DEG[i][i];
        const dj = DEG[j][j];
        if (di + dj > 0) {
          sum += 1 / Math.sqrt(di + dj);
        }
      }
    }
  }
  return sum;
}

/**
 * Computes the Eccentric Connectivity index.
 *
 * ξ = Σ deg(i) · ecc(i), where ecc(i) = max_j D[i][j] (eccentricity of vertex i).
 *
 * @param {number[][]} A   - Adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @param {number[][]} D   - All-pairs shortest-path distance matrix.
 * @returns {number}
 */
export function eccentricConnectivityIndex(A, DEG, D) {
  assertSquareMatrix(A, 'A');
  assertSquareMatrix(DEG, 'DEG');
  assertSquareMatrix(D, 'D');
  assertSameSize(A, 'A', DEG, 'DEG');
  assertSameSize(A, 'A', D, 'D');
  assertDiagonalMatrix(DEG, 'DEG');
  assertFiniteDistanceMatrix(D, 'D');
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const ecc = Math.max(...D[i].filter(v => isFinite(v)));
    sum += DEG[i][i] * ecc;
  }
  return sum;
}

/**
 * Computes the Wiener Polarity index.
 *
 * Wₚ = number of pairs of vertices (i,j) with D[i][j] = 3.
 *
 * @param {number[][]} D - All-pairs shortest-path distance matrix.
 * @returns {number}
 */
export function wienerPolarityIndex(D) {
  assertSquareMatrix(D, 'D');
  assertFiniteDistanceMatrix(D, 'D');
  let count = 0;
  for (let i = 0; i < D.length; i++) {
    for (let j = i + 1; j < D.length; j++) {
      if (D[i][j] === 3) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Computes the Schultz index (Molecular Topological Index, MTI).
 *
 * MTI = Σ_{i<j} (deg(i) + deg(j)) · D[i][j].
 *
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @param {number[][]} D   - All-pairs shortest-path distance matrix.
 * @returns {number}
 */
export function schultzIndex(DEG, D) {
  assertSquareMatrix(DEG, 'DEG');
  assertSquareMatrix(D, 'D');
  assertSameSize(DEG, 'DEG', D, 'D');
  assertDiagonalMatrix(DEG, 'DEG');
  assertFiniteDistanceMatrix(D, 'D');
  const n = D.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += (DEG[i][i] + DEG[j][j]) * D[i][j];
    }
  }
  return sum;
}

/**
 * Computes the Gutman index.
 *
 * Gut = Σ_{i<j} deg(i) · deg(j) · D[i][j].
 *
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @param {number[][]} D   - All-pairs shortest-path distance matrix.
 * @returns {number}
 */
export function gutmanIndex(DEG, D) {
  assertSquareMatrix(DEG, 'DEG');
  assertSquareMatrix(D, 'D');
  assertSameSize(DEG, 'DEG', D, 'D');
  assertDiagonalMatrix(DEG, 'DEG');
  assertFiniteDistanceMatrix(D, 'D');
  const n = D.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += DEG[i][i] * DEG[j][j] * D[i][j];
    }
  }
  return sum;
}

/**
 * Computes the Forgotten index (F-index / third Zagreb index).
 *
 * F = Σ deg(i)³.
 *
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function forgottenIndex(DEG) {
  assertSquareMatrix(DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  return DEG.reduce((sum, _, i) => sum + DEG[i][i] ** 3, 0);
}

/**
 * Computes the Narumi-Katayama index.
 *
 * NK = ∏ deg(i) (product of all vertex degrees).
 *
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number}
 */
export function narumiKatayamaIndex(DEG) {
  assertSquareMatrix(DEG, 'DEG');
  assertDiagonalMatrix(DEG, 'DEG');
  return DEG.reduce((prod, _, i) => prod * DEG[i][i], 1);
}

/**
 * Computes the Hosoya Z index (total number of matchings in the graph),
 * including the empty matching.
 *
 * Uses a branching recursion: for the first remaining vertex v, either
 * exclude it from the matching or pair it with one of its available neighbours.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number}
 */
export function hosoyaIndex(molecule) {
  assertMolecule(molecule, 'molecule');

  const atomIds = [...molecule.atoms.keys()].filter(id => molecule.atoms.get(id)?.name !== 'H');

  /**
   * @param {string[]} remaining - Atom IDs not yet assigned.
   * @returns {number}
   */
  function count(remaining) {
    if (remaining.length === 0) {
      return 1;
    }
    const [v, ...rest] = remaining;

    // Branch 1: v is unmatched
    let total = count(rest);

    // Branch 2: v is matched with each available neighbour still in `remaining`
    const available = molecule.getNeighbors(v).filter(u => molecule.atoms.get(u)?.name !== 'H' && rest.includes(u));
    for (const u of available) {
      total += count(rest.filter(x => x !== u));
    }

    return total;
  }

  return count(atomIds);
}
