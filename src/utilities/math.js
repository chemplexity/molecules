/*
  File        : math.js
  Description : assorted math utilities

  Imports     : N/A
  Exports     : matrix
*/


/*
  Method      : matrix
  Description : assorted functions for matrices

  Options     : initialize, add, subtract, multiply, inverse
*/

var matrix = {

    /*
      Method      : initialize
      Description : Returns a new matrix (zero-filled)

      Syntax      : output = matrix.initialize(rows, columns)

      Examples    : myMatrix = matrix.initialize(4, 10)
                    matrix123 = matrix.initialize(6)
    */

    initialize : function (rows = 1, columns = 1, output = []) {

        // Rows
        for (let i = 0; i < rows ; i++) {
            output[i] = [];

            // Columns
            for (let j = 0; j < columns; j++) {
                output[i][j] = 0;
            }
        }

        return output;
    },


    /*
      Method      : add
      Description : Returns the sum of: a) matrix + matrix; or b) matrix + value

      Syntax      : output = matrix.add(a, b)

      Examples    : myMatrix = matrix.add(matrixA, matrixB)
                    matrix123 = matrix.add(matrixA, 230)
    */

    add : function (a, b = 0, output = []) {

        switch (typeof b) {

            // Case: matrix + matrix
            case 'object':

                for (let i = 0; i < a.length; i++) {
                    output[i] = [];

                    for (let j = 0; j < a[0].length; j++) {
                        output[i][j] = a[i][j] + b[i][j];
                    }
                }

                return output;

            // Case: matrix + value
            case 'number':

                for (let i = 0; i < a.length; i++) {
                    output[i] = [];

                    for (let j = 0; j < a[0].length; j++) {
                        output[i][j] = a[i][j] + b;
                    }
                }

                return output;
        }
    },


    /*
      Method      : subtract
      Description : Returns the difference between: a) matrix - matrix; or b) matrix - value

      Syntax      : output = matrix.subtract(a, b)

      Examples    : myMatrix = matrix.subtract(matrixA, matrixB)
                    matrix123 = matrix.subtract(matrixA, 42)
    */

    subtract : function (a, b = 0, output = []) {

        switch (typeof b) {

            // Case: matrix - matrix
            case 'object':

                for (let i = 0; i < a.length; i++) {
                    output[i] = [];

                    for (let j = 0; j < a[0].length; j++) {
                        output[i][j] = a[i][j] - b[i][j];
                    }
                }

                return output;

            // Case: matrix - value
            case 'number':

                for (let i = 0; i < a.length; i++) {
                    output[i] = [];

                    for (let j = 0; j < a[0].length; j++) {
                        output[i][j] = a[i][j] - b;
                    }
                }

                return output;
        }
    },


    /*
      Method      : multiply
      Description : Returns the product of: a) matrix * matrix; or b) matrix * value

      Syntax      : output = matrix.multiply(a, b)

      Examples    : myMatrix = matrix.multiply(matrixA, matrixB)
                    matrix123 = matrix.multiply(matrixA, 110)
    */

    multiply : function (a, b = 0, output = []) {

        switch (typeof b) {

            // Case: matrix * matrix
            case 'object':

                for (let i = 0; i < a.length; i++) {
                    output[i] = [];

                    for (let j = 0; j < b[0].length; j++) {
                        output[i][j] = 0;

                        for (let k = 0; k < a[0].length; k++) {
                            output[i][j] += a[i][k] * b[k][j];
                        }
                    }
                }

                return output;

            // Case: matrix * value
            case 'number':

                for (let i = 0; i < a.length; i++) {
                    output[i] = [];

                    for (let j = 0; j < a[0].length; j++) {
                        output[i][j] = a[i][j] * b;
                    }
                }

                return output;
        }
    },


    /*
      Method      : inverse
      Description : Returns the inverse of a matrix

      Syntax      : output = matrix.inverse(a)

      Examples    : myMatrix = matrix.inverse(matrixA)
    */

    inverse : function (a, identity = [], inverse = []) {

        for (let i = 0; i < a.length; i++) {

            identity[i] = [];
            inverse[i] = [];

            for (let j = 0; j < a.length; j++) {

                if (i === j) {
                    inverse[i][j] = 1;
                }
                else {
                    inverse[i][j] = 0;
                }

                identity[i][j] = a[i][j];
            }
        }

        for (let i = 0; i < identity.length; i++) {

            let x = identity[i][i];

            if (x === 0) {

                for (let j = i+1; j < identity.length; j++) {

                    if (identity[j][i] !== 0) {

                        for (let k = 0; k < identity.length; k++) {

                            x = identity[i][k];
                            identity[i][k] = identity[j][k];
                            identity[j][k] = x;

                            x = inverse[i][k];
                            inverse[i][k] = inverse[j][k];
                            inverse[j][k] = x;
                        }

                        break;
                    }
                }

                x = identity[i][i];

                if (x === 0) { return; }
            }

            for (let j = 0; j < identity.length; j++) {

                identity[i][j] = identity[i][j] / x;
                inverse[i][j] = inverse[i][j] / x;
            }

            for (let j = 0; j < identity.length; j++) {

                if (i === j) { continue; }

                x = identity[j][i];

                for (let k = 0; k < identity.length; k++) {

                    identity[j][k] -= x * identity[i][k];
                    inverse[j][k] -= x * inverse[i][k];
                }
            }
        }

        for (let i = 0; i < inverse.length; i++) {

            for (let j = 0; j < inverse.length; j++) {

                inverse[i][j] = Math.round(inverse[i][j] * 100000) / 100000;
            }
        }

        return inverse;
    }
};


/*
  Exports
*/

export default matrix;
