/*
  File        : connectivity.js
  Description : chemical graph matrices

  Imports     : matrix
  Exports     : adjacencyMatrix, distanceMatrix, reciprocalMatrix

*/


/*
  Imports
*/

import matrix from './../utilities/math';


/*
  Method      : adjacencyMatrix
  Description : return adjacency matrix of non-hydrogen atoms

  Syntax
    output = adjacencyMatrix(molecule)

  Input
    molecule : object containing atoms and bonds

  Output
    header    : atom identifier
    adjacency : adjacency matrix

  Examples
    { header: id, adjacency: adj } = adjacencyMatrix(mol123)
    { header: names, adjacency: matrix } = adjacencyMatrix(molABC)
    { header: header123, adjacency: data123 } = adjacencyMatrix(myMolecule)
*/

function adjacencyMatrix(molecule, header = [], adjacency = []) {

    if (typeof molecule !== 'object' || molecule.atoms === undefined) { return null; }

    let keys = Object.keys(molecule.atoms);

    // Extract non-hydrogen atoms
    for (let i = 0; i < keys.length; i++) {

        if (molecule.atoms[keys[i]].name !== 'H') {
            header.push(molecule.atoms[keys[i]].id);
        }
    }

    // Fill adjacency matrix
    adjacency = matrix.initialize(header.length, header.length);

    for (let i = 0; i < header.length; i++) {

        let source = molecule.atoms[header[i]];

        for (let j = 0; j < source.bonds.atoms.length; j++) {

            let target = molecule.atoms[source.bonds.atoms[j]],
                index = header.indexOf(target.id);

            if (target.name !== 'H' && index > 0) {
                adjacency[i][index] = 1;
                adjacency[index][i] = 1;
            }
        }
    }

    return { id: 'adjacency', header: header, adjacency: adjacency };
}


/*
  Method      : distanceMatrix
  Description : return matrix of shortest paths between non-hydrogen atoms

  Syntax
    output = distanceMatrix(adjacency)

  Input
    adjacency : adjacency matrix

  Output
    header   : atom id
    distance : distance matrix

  Examples
    { header: id123, distance: d123 } = distanceMatrix(adjacent123)
    { header: atomID, distance: myMatrix } = distanceMatrix(A1)
    { header: atomsABC, distance: distABC } = distanceMatrix(adj123)

  References
    R. Seidel, 'On the All-Pairs Shortest-Path Problem', ACM, (1992) 745-749.
*/

function distanceMatrix(adjacency, header = [], distance = []) {

    if (typeof adjacency !== 'object') {
        console.log('Error: Tokens must be of type "object"');
        return null;
    }

    // Check input for molecule
    if (adjacency.atoms !== undefined && adjacency.bonds !== undefined) {
        adjacency = adjacencyMatrix(adjacency);
    }

    // Check for header
    if (adjacency.header !== undefined) {
        header = adjacency.header;
        adjacency = adjacency.adjacency;
    }

    // Check symmetry of adjacency matrix
    for (let i = 0; i < adjacency.length; i++) {

        if (adjacency[i].length !== adjacency.length) {
            console.log('Error: Adjacency matrix must be symmetric');
            return null;
        }
    }

    // Seidel's Algorithm (all-pairs shortest-paths)
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

    if (adjacency.length !== 0) {
        distance = Seidel(adjacency);
    }

    return { id: 'distance', header: header, distance: distance };
}


/*
  Method      : reciprocalMatrix
  Description : return reciprocal of distance matrix

  Syntax
    output = reciprocalMatrix(distance)

  Input
    distance : distance matrix

  Output
    header     : atom id
    reciprocal : reciprocal matrix

  Examples
    { header: id123, reciprocal: r123 } = distanceMatrix(dist123)
    { header: atomID, reciprocal: R1 } = distanceMatrix(D1)
    { header: atomsABC, reciprocal: recipABC } = distanceMatrix(distABC)

*/

function reciprocalMatrix(distance, header = [], reciprocal = []) {

    if (typeof distance !== 'object') {
        console.log('Error: Tokens must be of type "object"');
        return null;
    }

    // Check input for molecule
    if (distance.atoms !== undefined && distance.bonds !== undefined) {
        distance = distanceMatrix(adjacencyMatrix(distance));
    }

    // Check for header
    if (distance.header !== undefined) {
        header = distance.header;
    }

    if (distance.distance !== undefined) {
        distance = distance.distance;
    }

    // Check symmetry of distance matrix
    for (let i = 0; i < distance.length; i++) {

        if (distance[i].length !== distance.length) {
            console.log('Error: Distance matrix must be symmetric');
            return null;
        }
    }

    for (let i = 0; i < distance.length; i++) {

        reciprocal[i] = [];

        for (let j = 0; j < distance[i].length; j++) {

            if (i === j) {
                reciprocal[i][j] = 0;
            }
            else {
                reciprocal[i][j] = Math.round((1 / distance[i][j]) * 1000000) / 1000000;
            }
        }
    }

    if (reciprocal === undefined) { reciprocal = []; }

    return { id: 'reciprocal', header: header, reciprocal: reciprocal };
}


/*
  Exports
*/

export { adjacencyMatrix, distanceMatrix, reciprocalMatrix };