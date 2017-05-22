/**
 * File        : math.js
 * Description : assorted math functions
 *
 * Options     : math.matrix
 */

var math = {

    /**
     * Method      : math.matrix
     * Description : assorted matrix functions
     *
     * Options     : zeros, ones, add, subtract, multiply, identity, inverse
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

            switch (typeof B) {

                case 'object':

                    for (let i = 0; i < A.length; i++) {
                        AB[i] = [];

                        for (let j = 0; j < A[0].length; j++) {
                            AB[i][j] = 0;

                            for (let k = 0; k < A[0].length; k++) {
                                AB[i][j] += A[i][k] * B[k][j];
                            }

                        }
                    }

                    return AB;

                case 'number':

                    for (let i = 0; i < A.length; i++) {
                        AB[i] = [];

                        for (let j = 0; j < A[0].length; j++) {
                            AB[i][j] = A[i][j] * B;
                        }
                    }

                    return AB;

            }

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
                        I[i][j] = 1;
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

        inverse: function(A, AA = [], I = []) {

            if (A.length !== A[i].length) { return null; }

            for (let i = 0; i < A.length; i++) {
                AA[i] = [];
                I[i] = [];

                for (let j = 0; j < A[i].length; j++) {
                    AA[i][j] = A[i][j];
                    I[i][j] = 0;

                    if (i === j) {
                        I[i][j] = 1;
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
        },


        /**
         * Method      : math.matrix.check(A, B)
         * Description : check matrix input for errors
         */

        check: function(A, B = []) {

            if (!Array.isArray(A)) {
                throw 'Error: input \'A\' must be an array';
            }

            if (!Array.isArray(B)) {
                throw 'Error: input \'B\' must be an array';
            }

            if (A.length === 0) {
                throw 'Error: input cannot be empty';
            }

            if (B.length !== 0 && A.length !== B.length) {
                throw 'Error: matrix dimensions must agree';
            }

            if (A.filter(x => Array.isArray(x)).length === A.length) {

                if (A.map(x => x.length).reduce((a, b) => a + b) !== A.length * A.length) {
                    throw 'Error: matrix dimensions must agree';
                }

                if (B.length !== 0) {

                    if (B.filter(x => Array.isArray(x)).length !== A.length) {
                        throw 'Error: matrix dimensions must agree';
                    }

                    if (B.map(x => x.length).reduce((a, b) => a + b) !== A.length * A.length) {
                        throw 'Error: matrix dimensions must agree';
                    }
                }
            }

            else if (A.filter(x => typeof(x) === 'number').length === A.length) {

                if (B.length !== 0) {

                    if (B.filter(x => typeof(x) === 'number').length !== A.length) {
                        throw 'Error: matrix dimensions must agree';
                    }
                }
            }

            else {
                throw 'Error: input must be uniform';
            }

            return 1;
        }
    }
};

/**
 * Exports
 */

export default math;
