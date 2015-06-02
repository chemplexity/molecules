/*
  topology.js

  Description : graph matrices and molecular topological indexes
  Imports     : N/A
  Exports     : adjacencyMatrix, distanceMatrix, wienerIndex, hyperwienerIndex

*/


/*
  Function    : adjacencyMatrix
  Description : return adjacency matrix of non-hydrogen atoms

  Syntax
    { header, adjacency } = adjacencyMatrix(molecule)

  Input
    molecule : object containing atoms and bonds

  Output
    header : atom identifier
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
    adjacency = Matrix(header.length);

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

    return { header: header, adjacency: adjacency };
}


/*
  Function    : distanceMatrix
  Description : return matrix of shortest paths between non-hydrogen atoms

  Syntax
    { header, distance } = distanceMatrix(adjacency)

  Input
    adjacency : adjacency matrix

  Output
    header   : atom identifier
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

        let Z = Multiply(A, A);

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
            return Subtract(Multiply(B, 2), A);
        }

        let T = Seidel(B),
            X = Multiply(T, A);

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

    return { header: header, distance: distance };
}


/*
  Function    : reciprocalMatrix
  Description : return reciprocal of distance matrix

  Syntax
    { header, reciprocal } = reciprocalMatrix(adjacency)

  Input
    distance : distance matrix

  Output
    header    : atom identifier
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
                let r = 1 / distance[i][j];
                reciprocal[i][j] = Math.round(r * 1000000) / 1000000;
            }
        }
    }

    if (reciprocal === undefined) { reciprocal = []; }

    return { header: header, reciprocal: reciprocal };
}


/*
  Function    : wienerIndex
  Description : return Wiener topology index

  Syntax
    index = wienerIndex(distance)

  Input
    distance : distance matrix

  Output
    index : Wiener index

  Examples
    wiener = wienerIndex(dist123)
    w123 = wienerIndex(distanceABC)
*/

function wienerIndex(distance, index = 0) {

    if (typeof distance !== 'object') {
        console.log('Error: Tokens must be of type "object"');
        return null;
    }

    // Check input for molecule
    if (distance.atoms !== undefined && distance.bonds !== undefined) {
        distance = distanceMatrix(adjacencyMatrix(distance));
    }

    // Check for header
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

    // Calculate Wiener index
    for (let i = 0; i < distance.length; i++) {
        for (let j = 0; j < distance[i].length; j++) {
            index += distance[i][j];
        }
    }

    return index / 2;
}


/*
  Function    : hyperwienerIndex
  Description : return Hyper-Wiener topology index

  Syntax
    index = hyperwienerIndex(distance)

  Input
    distance : distance matrix

  Output
    index : Hyper-Wiener index

  Examples
    hyperwiener = hyperwienerIndex(dist123)
    hw123 = hyperwienerIndex(distanceABC)
*/

function hyperwienerIndex(distance, index = 0) {

    if (typeof distance !== 'object') {
        console.log('Error: Tokens must be of type "object"');
        return null;
    }

    // Check input for molecule
    if (distance.atoms !== undefined && distance.bonds !== undefined) {
        distance = distanceMatrix(adjacencyMatrix(distance));
    }

    // Check for header
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

    // Calculate Hyper-Wiener index
    for (let i = 0; i < distance.length; i++) {
        for (let j = 0; j < distance[i].length; j++) {
            if (i !== j && i < j) {
                index += distance[i][j] + Math.pow(distance[i][j], 2);
            }
        }
    }

    return index / 2;
}


/*
  Function    : hararyIndex
  Description : return Harary topology index

  Syntax
    index = hararyIndex(reciprocal)

  Input
    reciprocal : reciprocal of distance matrix

  Output
    index : Harary index

  Examples
    harary = hararyIndex(recip123)
    h123 = hararyIndex(reciprocalABC)
*/

function hararyIndex(reciprocal, index = 0) {

    if (typeof reciprocal !== 'object') {
        console.log('Error: Tokens must be of type "object"');
        return null;
    }

    // Check input for molecule
    if (reciprocal.atoms !== undefined && reciprocal.bonds !== undefined) {
        reciprocal = reciprocalMatrix(distanceMatrix(adjacencyMatrix(reciprocal)));
    }

    // Check for header
    if (reciprocal.reciprocal !== undefined) {
        reciprocal = reciprocal.reciprocal;
    }

    // Check symmetry of reciprocal matrix
    for (let i = 0; i < reciprocal.length; i++) {
        if (reciprocal[i].length !== reciprocal.length) {
            console.log('Error: Distance matrix must be symmetric');
            return null;
        }
    }

    // Calculate Harary index
    for (let i = 0; i < reciprocal.length; i++) {
        for (let j = 0; j < reciprocal[i].length; j++) {
            if (i !== j) {
                index += reciprocal[i][j];
            }
        }
    }

    return Math.round((index / 2) * 1000) / 1000;
}


/*
  Function    : Matrix
  Description : return zeros matrix
*/

function Matrix(rows, columns = rows, matrix = []) {

    if (typeof rows !== 'number' || typeof columns !== 'number') { return null; }

    // Rows
    for (let i = 0; i < rows ; i++) {
        matrix[i] = [];

        // Columns
        for (let j = 0; j < columns; j++) {
            matrix[i][j] = 0;
        }
    }

    return matrix;
}


/*
  Function    : Multiply
  Description : matrix multiplication
*/

function Multiply(a, b, output = []) {

    switch (typeof b) {

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

        case 'number':

            for (let i = 0; i < a.length; i++) {
                output[i] = [];

                for (let j = 0; j < a[0].length; j++) {
                    output[i][j] = a[i][j] * b;
                }
            }

            return output;
    }
}


/*
  Function    : Subtract
  Description : matrix subtraction
*/

function Subtract(a, b, output = []) {

    switch (typeof b) {

        case 'object':

            for (let i = 0; i < a.length; i++) {
                output[i] = [];

                for (let j = 0; j < a[0].length; j++) {
                    output[i][j] = a[i][j] - b[i][j];
                }
            }

            return output;

        case 'value':

            for (let i = 0; i < a.length; i++) {
                output[i] = [];

                for (let j = 0; j < a[0].length; j++) {
                    output[i][j] = a[i][j] - b;
                }
            }

            return output;
    }
}


/*
  Function    : Inverse
  Description : matrix inversion
*/

function Inverse(a, identity = [], inverse = []) {

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


/*
  Exports
*/

export { adjacencyMatrix, distanceMatrix, reciprocalMatrix, wienerIndex, hyperwienerIndex, hararyIndex};