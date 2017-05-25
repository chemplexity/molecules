/**
 * File        : topology.js
 * Description : chemical graph matrices and topological indices
 *
 * Options     : topology.matrix, topology.index
 */

import math from './../utilities/math';

var topology = {

    /**
     * Method      : topology.matrix
     * Description : compute chemical graph matrices
     *
     * Options     : adjacency, degree, distance, laplacian, randic, reciprocal
     */

    matrix: {

        /**
         * Returns adjacency matrix
         * @param {Object} G - molecule object
         * @return {Array} A - adjacency matrix
         */

        adjacency: function (G) {

            let V = Object.keys(G.atoms).filter((x) => G.atoms[x].name !== 'H');
            let E = Object.keys(G.bonds).filter((x) => G.bonds[x].name !== 'H');

            let A = [];

            for (let i = 0; i < V.length; i++) {
                A[i] = [];

                for (let j = 0; j < V.length; j++) {
                    A[i][j] = 0;
                }
            }

            for (let i = 0; i < E.length; i++) {

                let ii = V.indexOf(G.bonds[E[i]].atoms[0]);
                let jj = V.indexOf(G.bonds[E[i]].atoms[1]);

                A[ii][jj] = 1;
                A[jj][ii] = 1;
            }

            return A;
        },

        /**
         * Returns degree matrix
         * @param {Array} A - adjacency matrix
         * @return {Array} DEG - degree matrix
         */

        degree: function (A) {

            let DEG = [];

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
         * Returns distance matrix (R. Seidel, ACM, (1992) 745-749)
         * @param {Array} A - adjacency matrix
         * @return {Array} D - distance matrix
         */

        distance: function (A) {

            let B = [];
            let D = [];

            let Z = math.matrix.multiply(A, A);

            for (let i = 0; i < A.length; i++) {
                B[i] = [];

                for (let j = 0; j < A[i].length; j++) {

                    if (i !== j && (A[i][j] === 1 || Z[i][j] > 0)) {
                        B[i][j] = 1;
                    }
                    else {
                        B[i][j] = 0;
                    }
                }
            }

            let count = 0;

            for (let i = 0; i < B.length; i++) {
                for (let j = 0; j < B[0].length; j++) {

                    if (i !== j && B[i][j] === 1) {
                        count += 1;
                    }
                }
            }

            if (count === (B.length * B.length) - B.length) {

                for (let i = 0; i < B.length; i++) {
                    D[i] = [];

                    for (let j = 0; j < B[i].length; j++) {
                        D[i][j] = B[i][j] * 2 - A[i][j];
                    }
                }

                return D;
            }

            let T = this.distance(B);
            let X = math.matrix.multiply(T, A);

            let DEG = [];

            for (let i = 0; i < A.length; i++) {
                DEG[i] = 0;

                for (let j = 0; j < A[0].length; j++) {
                    DEG[i] += A[i][j];
                }
            }

            for (let i = 0; i < X.length; i++) {
                D[i] = [];

                for (let j = 0; j < X[0].length; j++) {

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
         * Returns Laplacian matrix
         * @param {Array} A - adjacency matrix
         * @param {Array} DEG - degree matrix
         * @return {Array} L - Laplacian matrix
         */

        laplacian: function(A, DEG) {

            let L = [];

            for (let i = 0; i < A.length; i++) {
                L[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    L[i][j] = DEG[i][j] - A[i][j];
                }
            }

            return L;
        },

        /**
         * Returns Randic matrix
         * @param {Array} A - adjacency matrix
         * @param {Array} DEG - degree matrix
         * @return {Array} R - Randic matrix
         */

        randic: function (A, DEG) {

            let R = [];

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
         * Returns reciprocal matrix
         * @param {Array} D - distance matrix
         * @return {Array} RD - reciprocal matrix
         */

        reciprocal: function (D) {

            let RD = [];

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
         * Returns Balaban index
         * @param {Array} D - distance matrix
         * @return {Number} J - Balaban index
         */

        balaban: function (D) {

            let J = 0;
            let B = 0;
            let S = [];

            for (let i = 0; i < D.length; i++) {
                S[i] = D[i].reduce((a,b) => a+b, 0);
            }

            for (let i = 0; i < D.length-1; i++) {

                for (let j = i+1; j < D[i].length; j++) {

                    if (D[i][j] === 1) {
                        J += 1 / Math.sqrt(S[i] * S[j]);
                        B += 1;
                    }
                }
            }

            return (B / (B - D.length + 2)) * J;
        },

        /**
         * Returns Harary index
         * @param {Array} RD - reciprocal matrix
         * @return {Number} H - Harary index
         */

        harary: function (RD) {

            let H = 0;

            for (let i = 0; i < RD.length; i++) {
                for (let j = 0; j < RD[i].length; j++) {
                    H += RD[i][j];
                }
            }

            return H / 2;
        },

        /**
         * Returns Hyper-Wiener index
         * @param {Array} D - distance matrix
         * @return {Number} WW - Hyper-Wiener index
         */

        hyperwiener: function (D) {

            let WW = 0;

            for (let i = 0; i < D.length; i++) {
                for (let j = 0; j < i; j++) {
                    WW += D[i][j] + Math.pow(D[i][j], 2);
                }
            }

            return WW / 2;
        },

        /**
         * Returns Randic index
         * @param {Array} R - Randic matrix
         * @return {Number} RI - Randic index
         */

        randic: function (R) {

            let RI = 0;

            for (let i = 0; i < R.length; i++) {
                RI += R[i].reduce((a,b) => a+b, 0);
            }

            return RI / 2;
        },

        /**
         * Returns Wiener index
         * @param {Array} D - distance matrix
         * @return {Number} W - Wiener index
         */

        wiener: function (D) {

            let W = 0;

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