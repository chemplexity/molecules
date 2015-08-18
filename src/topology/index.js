/*
  File        : index.js
  Description : molecular topological indices

  Imports     : N/A
  Exports     : wiener, hyperwiener, harary
*/


/*
  Method      : wiener
  Description : returns the wiener index

  Syntax      : output = wiener(input)

  Examples    : w1 = wiener(distance123)
*/

var wiener = function (input, output = 0) {

    if (input.id !== 'distance') { return null; }

    let matrix = input.matrix;

    for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < matrix[0].length; j++) {

            output += matrix[i][j];
        }
    }

    return output / 2;
};


/*
  Method      : hyperwiener
  Description : returns the hyper-wiener index

  Syntax      : output = hyperwiener(input)

  Examples    : hw1 = hyperwiener(dist123)
*/

var hyperwiener = function (input, output = 0) {

    if (input.id !== 'distance') { return null; }

    let matrix = input.matrix;

    for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < matrix[i].length; j++) {

            if (i !== j && i < j) {
                output += matrix[i][j] + Math.pow(matrix[i][j], 2);
            }
        }
    }

    return output / 2;
};


/*
  Method      : harary
  Description : returns the harary index

  Syntax      : output = harary(input)

  Examples    : h1 = harary(recip123)
*/

var harary = function (input, output = 0) {

    if (input.id !== 'reciprocal') { return null; }

    let matrix = input.matrix;

    for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < matrix[i].length; j++) {

            if (i !== j) {
                output += matrix[i][j];
            }
        }
    }

    return Math.round((output / 2) * 1000) / 1000;
};


/*
  Exports
*/

export { wiener, hyperwiener, harary };