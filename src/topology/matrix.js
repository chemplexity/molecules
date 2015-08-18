/*
  File        : matrix.js
  Description : chemical graph matrices

  Imports     : math
  Exports     : adjacency, distance, reciprocal
*/


/*
  Imports
*/

import matrix from './../utilities/math';


/*
  Method      : adjacency
  Description : returns the adjacency matrix of a molecule for non-hydrogen atoms

  Syntax      : output = adjacency(input)

  Examples    : adjMatrix123 = adjacency(myMolecule123)
*/

var adjacency = function (input, header = [], output = []) {

    if (input.atoms === undefined) { return null; }

    let atoms = input.atoms,
        keys = Object.keys(atoms);

    // Get non-hydrogen atoms
    for (let i = 0; i < keys.length; i++) {

        if (atoms[keys[i]].name !== 'H') {
            header.push(atoms[keys[i]].id);
        }
    }

    // Calculate adjacency matrix
    output = matrix.initialize(header.length, header.length);

    for (let i = 0; i < header.length; i++) {

        let source = atoms[header[i]];

        for (let j = 0; j < source.bonds.atoms.length; j++) {

            let target = atoms[source.bonds.atoms[j]],
                index = header.indexOf(target.id);

            // Update matrix
            if (target.name !== 'H' && index > 0) {
                output[i][index] = 1;
                output[index][i] = 1;
            }
        }
    }

    return { id: 'adjacency', header: header, matrix: output };
};


/*
  Method      : distance
  Description : returns the distance matrix of shortest paths between non-hydrogen atoms

  Syntax      : output = distance(input)

  Examples    : distanceMatrix123 = distance(myMolecule123)

  Reference   : R. Seidel, 'On the All-Pairs Shortest-Path Problem', ACM, (1992) 745-749.
*/

var distance = function (input, header = [], output = []) {

    let { matrix: a } = adjacency(input);

    output = Seidel(a);

    // R. Seidel, ACM, (1992) 745-749.
    function Seidel(A, B = [], D = []) {

        let Z = matrix.multiply(A, A);

        for (let i = 0; i < A.length; i++) {
            B[i] = [];

            for (let j = 0; j < A[0].length; j++) {

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
            return matrix.subtract(matrix.multiply(B, 2), A);
        }

        let T = Seidel(B),
            X = matrix.multiply(T, A);

        let degree = [];

        for (let i = 0; i < A.length; i++) {
            degree[i] = A[i].reduce(function(a, b) { return a + b; });
        }

        for (let i = 0; i < X.length; i++) {
            D[i] = [];

            for (let j = 0; j < X[0].length; j++) {

                if (X[i][j] >= T[i][j] * degree[j]) {
                    D[i][j] = 2 * T[i][j];
                }
                else if (X[i][j] < T[i][j] * degree[j]) {
                    D[i][j] = 2 * T[i][j] - 1;
                }
            }
        }

        return D;
    }

    return { id: 'distance', header: header, matrix: output };
};


/*
  Method      : reciprocal
  Description : returns the reciprocal of the distance matrix

  Syntax      : output = reciprocal(input)

  Examples    : reciprocalMatrix123 = reciprocal(myMolecule123)
*/

var reciprocal = function (input, header = [], output = []) {

    let { matrix: d } = distance(input);

    for (let i = 0; i < d.length; i++) {
        output[i] = [];

        for (let j = 0; j < d[i].length; j++) {

            if (i === j) {
                output[i][j] = 0;
            }
            else {
                output[i][j] = Math.round((1 / d[i][j]) * 100000) / 100000;
            }
        }
    }

    return { id: 'reciprocal', header: header, matrix: output };
};


/*
  Exports
*/

export { adjacency, distance, reciprocal };