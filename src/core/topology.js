/**
 * File        : topology.js
 * Description : chemical graph matrices and topological indices
 *
 * Options     : matrix, index
 */

import math from './../utilities/math';

var topology = {

    /**
     * Method      : topology.matrix
     * Description : chemical graph matrices
     *
     * Options     : adjacency, degree, distance, lapacian, randic, reciprocal
     */

    matrix: {

        /**
         * Method      : topology.matrix.adjacency(G)
         * Description : returns adjacency matrix (A)
         */

        adjacency: function (G, A = []) {

            let V = Object.keys(G.atoms).filter((x) => G.atoms[x].name !== 'H'),
                E = Object.keys(G.bonds).filter((x) => G.bonds[x].name !== 'H');

            for (let i = 0; i < V.length; i++) {
                A[i] = [];

                for (let j = 0; j < V.length; j++) {
                    A[i][j] = 0;
                }
            }

            for (let i = 0; i < E.length; i++) {

                let ii = V.indexOf(G.bonds[E[i]].atoms[0]),
                    jj = V.indexOf(G.bonds[E[i]].atoms[1]);

                A[ii][jj] = 1;
                A[jj][ii] = 1;
            }

            return A;
        },

        /**
         * Method      : topology.matrix.degree(A)
         * Description : returns degree matrix (DEG)
         */

        degree: function (A, DEG = []) {

            for (let i = 0; i < A.length; i++) {
                DEG[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    DEG[i][j] = 0;

                    if (i === j) {

                        for (let k = 0; k < A[i].length; k++) {
                            DEG[i][j] += A[i][k];
                        }
                    }
                }
            }

            return DEG;
        },

        /**
         * Method      : topology.matrix.distance(A)
         * Description : returns distance matrix (D)
         *
         * Reference   : R. Seidel, ACM, (1992) 745-749.
         */

        distance: function (A, B = [], D = []) {

            let Z = math.matrix.multiply(A, A);

            for (let i = 0; i < A.length; i++) {
                B[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    B[i][j] = 0;

                    if (i !== j && (A[i][j] === 1 || Z[i][j] > 0)) {
                        B[i][j] = 1;
                    }
                }
            }

            let count = 0;

            for (let i = 0; i < B.length; i++) {
                for (let j = 0; j < B[i].length; j++) {

                    if (i !== j && B[i][j] === 1) {
                        count += 1;
                    }
                }
            }

            if (count === (B.length * B.length) - B.length) {

                for (let i = 0; i < B.length; i++) {
                    for (let j = 0; j < B[i].length; j++) {
                        B[i][j] = B[[i][j] * 2 - A[i][j]];
                    }
                }

                return B;
            }

            let T = topology.matrix.distance(B),
                X = math.matrix.multiply(T, A);

            let DEG = [];

            for (let i = 0; i < A.length; i++) {
                DEG[i] = 0;

                for (let j = 0; j < A[i].length; j++) {
                    DEG[i] += A[i][j];
                }
            }

            for (let i = 0; i < X.length; i++) {
                D[i] = [];

                for (let j = 0; j < X[i].length; j++) {

                    if (X[i][j] >= T[i][j] * DEG[j]) {
                        D[i][j] = T[i][j] * 2;
                    }
                    else if (X[i][j] < T[i][j] * DEG[j]) {
                        D[i][j] = T[i][j] * 2 - 1;
                    }
                }
            }

            return D;
        },

        /**
         * Method      : topology.matrix.lapacian(A, DEG)
         * Description : returns lapacian matrix (L)
         */

        lapacian: function(A, DEG, L = []) {

            for (let i = 0; i < A.length; i++) {
                L[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    L[i][j] = DEG[i][j] - A[i][j];
                }
            }

            return L;
        },

        /**
         * Method      : topology.matrix.randic(A, DEG)
         * Description : returns randic matrix (R)
         */

        randic: function (A, DEG, R = []) {

            for (let i = 0; i < A.length; i++) {
                R[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    R[i][j] = 0;

                    if (A[i][j] === 1) {
                        R[i][j] = 1 / Math.sqrt(Math.max(...DEG[i]) * Math.max(...DEG[j]));
                    }
                }
            }

            return R;
        },

        /**
         * Method      : topology.matrix.reciprocal(D)
         * Description : returns reciprocal matrix (RD)
         */

        reciprocal: function (D, RD = []) {

            for (let i = 0; i < D.length; i++) {
                RD[i] = [];

                for (let j = 0; j < D[i].length; j++) {
                    RD[i][j] = 0;

                    if (i !== j && D[i][j] > 0) {
                        RD[i][j] = 1 / D[i][j];
                    }
                }
            }

            return RD;
        }
    },

    /**
     * Method      : topology.index
     * Description : molecular topological indices
     *
     * Options     : balaban, harary, hyperwiener, randic, wiener
     */

    index: {

        /**
         * Method      : topology.index.balaban(D)
         * Description : returns the Balaban index (J)
         */

        balaban: function (D, J = 0) {

            for (let i = 1; i < D.length; i++) {
                let S0 = 0,
                    S1 = 0;

                for (let j = 0; j < D[i].length; j++) {
                    S0 += D[i-1][j];
                    S1 += D[i][j];
                }

                J += 1 / Math.sqrt(S0 * S1);
            }

            return J;
        },

        /**
         * Method      : topology.index.harary(RD)
         * Description : returns the Harary index (H)
         */

        harary: function (RD, H = 0) {

            for (let i = 0; i < RD.length; i++) {
                for (let j = 0; j < RD[i].length; j++) {
                    H += RD[i][j];
                }
            }

            return H / 2;
        },

        /**
         * Method      : topology.index.hyperwiener(D)
         * Description : returns the Hyper-Wiener index (WW)
         */

        hyperwiener: function (D, WW = 0) {

            for (let i = 0; i < D.length; i++) {
                for (let j = 0; j < i; j++) {
                    WW += D[i][j] + Math.pow(D[i][j], 2);
                }
            }

            return WW / 2;
        },

        /**
         * Method      : topology.index.randic(A, DEG)
         * Description : returns the Randic index (R)
         */

        randic: function (A, DEG, R = 0) {

            for (let i = 0; i < A.length; i++) {
                for (let j = 0; j < A[i].length; j++) {
                    R += 1 / Math.sqrt(Math.max(...DEG[i]) * Math.max(...DEG[j]));
                }
            }

            return R / 2;
        },

        /**
         * Method      : topology.index.wiener(D)
         * Description : returns the Wiener index (W)
         */

        wiener: function (D, W = 0) {

            for (let i = 0; i < D.length; i++) {
                for (let j = 0; j < D[i].length; j++) {
                    W += D[i][j];
                }
            }

            return W / 2;
        }
    }
};

/**
 * Exports
 */

export default topology;