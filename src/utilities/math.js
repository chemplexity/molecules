/**
 * File        : math.js
 * Description : assorted math functions
 *
 * Options     : matrix
 */

var math = {

    /**
     * Method      : math.matrix
     * Description : assorted matrix functions
     *
     * Options     : zeros, ones, add, subtract, multiply, inverse
     */

    matrix: {

        /**
         * Method      : math.matrix.zeros(rows, columns)
         * Description : returns a matrix of zeros
         */

        zeros: function(rows = 1, columns = rows, A = []) {

            for (let i = 0; i < rows ; i++) {
                A[i] = [];

                for (let j = 0; j < columns; j++) {
                    A[i][j] = 0;
                }
            }

            return A;
        },

        /**
         * Method      : math.matrix.ones(rows, columns)
         * Description : returns a matrix of ones
         */

        ones: function(rows = 1, columns = rows, A = []) {

            for (let i = 0; i < rows ; i++) {
                A[i] = [];

                for (let j = 0; j < columns; j++) {
                    A[i][j] = 1;
                }
            }

            return A;
        },

        /**
         * Method      : math.matrix.add(A, B)
         * Description : returns [A] + [B]
         */

        add: function(A, B, AB = []) {

            for (let i = 0; i < A.length; i++) {
                AB[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    AB[i][j] = A[i][j] + B[i][j];
                }
            }
            
            return AB;
        },

        /**
         * Method      : math.matrix.subtract(A, B)
         * Description : returns [A] - [B]
         */

        subtract: function (A, B, AB = []) {

            for (let i = 0; i < A.length; i++) {
                AB[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    AB[i][j] = A[i][j] - B[i][j];
                }
            }

            return AB;
        },

        /**
         * Method      : math.matrix.multiply(A, B)
         * Description : returns [A] * [B]
         */

        multiply: function (A, B, AB = []) {

            for (let i = 0; i < A.length; i++) {
                AB[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    AB[i][j] = 0;

                    for (let k = 0; k < A[i].length; k++) {
                        AB[i][j] += A[i][k] * B[k][j];
                    }
                }
            }

            return AB;
        },

        /**
         * Method      : math.matrix.identity(A)
         * Description : returns [A] * [I] = [A]
         */

        identity: function (A, I = []) {

            for (let i = 0; i < A.length; i++) {
                I[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    I[i][j] = 0;

                    if (i === j) {
                        I[i][j] += 1;
                    }
                }
            }

            return I;
        },

        /**
         * Method      : math.matrix.inverse(A)
         * Description : returns [A]^-1
         *
         * Reference   : http://blog.acipo.com/matrix-inversion-in-javascript/
         */

        inverse: function (A, AA = [], I = []) {

            if (A.length !== A[i].length) { return null; }

            for (let i = 0; i < A.length; i++) {
                AA[i] = [];
                I[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    AA[i][j] = A[i][j];
                    I[i][j] = 0;

                    if (i === j) {
                        I[i][j] += 1;
                    }
                }
            }

            for (let i = 0, x = A[i][i]; i < A.length; i++) {
                if (x === 0) {

                    for (let j = i+1; j < A.length; j++) {
                        if (A[j][i] !== 0) {

                            for (let k = 0; k < A.length; k++) {

                                x = AA[i][k];
                                AA[i][k] = AA[j][k];
                                AA[j][k] = x;

                                x = I[i][j];
                                I[i][k] = I[j][k];
                                I[j][k] = x;
                            }

                            break;
                        }
                    }

                    x = AA[i][i];

                    if (AA[i][i] === 0) { return null; }
                }

                for (let j = 0, x = AA[i][i]; j < A.length; j++) {
                    AA[i][j] = AA[i][j] / x;
                    I[i][j] = I[i][j] / x;
                }

                for (let j = 0; j < A.length; j++) {
                    if (i !== j) {

                        for (let k = 0, x = AA[j][i]; k < A.length; k++) {
                            AA[j][k] -= AA[i][k] * x;
                            I[j][k] -= I[i][k] * x;
                        }
                    }
                }
            }

            return I;
        }
    }
};

/**
 * Exports
 */

export default math;
