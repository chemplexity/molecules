/*
  topology.js

  Description : chemical graph matrices and molecular topological indexes
  Exports     : adjacencyMatrix, distanceMatrix, wienerIndex, hyperwienerIndex

*/


/*
  Method      : adjacencyMatrix
  Description : return adjacency matrix of non-hydrogen atoms

  Syntax
    { header, adjacency } = adjacencyMatrix(molecule)

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
    for (let i = 0, ii = keys.length; i < ii; i++) {

        if (molecule.atoms[keys[i]].name !== 'H') {
            header.push(molecule.atoms[keys[i]].id);
        }
    }

    // Fill adjacency matrix
    adjacency = Matrix(header.length);

    for (let i = 0, ii = header.length; i < ii; i++) {
        let source = molecule.atoms[header[i]];

        for (let j = 0, jj = source.bonds.atoms.length; j < jj; j++) {
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
  Method      : distanceMatrix
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
    for (let i = 0, ii = adjacency.length; i < ii; i++) {
        if (adjacency[i].length !== adjacency.length) {
            console.log('Error: Adjacency matrix must be symmetric');
            return null;
        }
    }

    // Seidel's Algorithm (all-pairs shortest-paths)
    function Seidel(A, B = [], D = []) {

        let Z = Multiply(A, A);

        for (let i = 0, ii = A.length; i < ii; i++) {
            B[i] = [];

            for (let j = 0, jj = A[0].length; j < jj; j++) {

                if (i !== j && (A[i][j] === 1 || Z[i][j] > 0)) {
                    B[i][j] = 1;
                }
                else {
                    B[i][j] = 0;
                }
            }
        }

        let count = 0;

        for (let i = 0, ii = B.length; i < ii; i++) {
            for (let j = 0, jj = B[0].length; j < jj; j++) {

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

        for (let i = 0, ii = A.length; i < ii; i++) {
            degree[i] = A[i].reduce(function(a, b) { return a + b; });
        }

        for (let i = 0, ii = X.length; i < ii; i++) {
            D[i] = [];

            for (let j = 0, jj = X[0].length; j < jj; j++) {

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
  Method      : reciprocalMatrix
  Description : return reciprocal of distance matrix

  Syntax
    { header, reciprocal } = reciprocalMatrix(distance)

  Input
    distance : distance matrix

  Output
    header     : atom identifier
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
    for (let i = 0, ii = distance.length; i < ii; i++) {
        if (distance[i].length !== distance.length) {
            console.log('Error: Distance matrix must be symmetric');
            return null;
        }
    }

    for (let i = 0, ii = distance.length; i < ii; i++) {
        reciprocal[i] = [];

        for (let j = 0, jj = distance[i].length; j < jj; j++) {
            if (i === j) {
                reciprocal[i][j] = 0;
            }
            else {
                reciprocal[i][j] = Math.round((1 / distance[i][j]) * 1000000) / 1000000;
            }
        }
    }

    if (reciprocal === undefined) { reciprocal = []; }

    return { header: header, reciprocal: reciprocal };
}


/*
  Method      : wienerIndex
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
    for (let i = 0, ii = distance.length; i < ii; i++) {
        if (distance[i].length !== distance.length) {
            console.log('Error: Distance matrix must be symmetric');
            return null;
        }
    }

    // Calculate Wiener index
    for (let i = 0, ii = distance.length; i < ii; i++) {
        for (let j = 0, jj = distance[i].length; j < jj; j++) {
            index += distance[i][j];
        }
    }

    return index / 2;
}


/*
  Method      : hyperwienerIndex
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
    for (let i = 0, ii = distance.length; i < ii; i++) {
        if (distance[i].length !== distance.length) {
            console.log('Error: Distance matrix must be symmetric');
            return null;
        }
    }

    // Calculate Hyper-Wiener index
    for (let i = 0, ii = distance.length; i < ii; i++) {
        for (let j = 0, jj = distance[i].length; j < jj; j++) {
            if (i !== j && i < j) {
                index += distance[i][j] + Math.pow(distance[i][j], 2);
            }
        }
    }

    return index / 2;
}


/*
  Method      : hararyIndex
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
    for (let i = 0, ii = reciprocal.length; i < ii; i++) {
        if (reciprocal[i].length !== reciprocal.length) {
            console.log('Error: Distance matrix must be symmetric');
            return null;
        }
    }

    // Calculate Harary index
    for (let i = 0, ii = reciprocal.length; i < ii; i++) {
        for (let j = 0, jj = reciprocal[i].length; j < jj; j++) {
            if (i !== j) {
                index += reciprocal[i][j];
            }
        }
    }

    return Math.round((index / 2) * 1000) / 1000;
}


/*
  Method      : Matrix
  Description : return zeros matrix
*/

function Matrix(rows, columns = rows, matrix = []) {

    if (typeof rows !== 'number' || typeof columns !== 'number') { return null; }

    // Rows
    for (let i = 0, ii = rows; i < ii ; i++) {
        matrix[i] = [];

        // Columns
        for (let j = 0, jj = columns; j < jj; j++) {
            matrix[i][j] = 0;
        }
    }

    return matrix;
}


/*
  Method      : Multiply
  Description : matrix multiplication
*/

function Multiply(a, b, output = []) {

    switch (typeof b) {

        case 'object':

            for (let i = 0, ii = a.length; i < ii; i++) {
                output[i] = [];

                for (let j = 0, jj = b[0].length; j < jj; j++) {
                    output[i][j] = 0;

                    for (let k = 0, kk = a[0].length; k < kk; k++) {
                        output[i][j] += a[i][k] * b[k][j];
                    }
                }
            }

            return output;

        case 'number':

            for (let i = 0, ii = a.length; i < ii; i++) {
                output[i] = [];

                for (let j = 0, jj = a[0].length; j < jj; j++) {
                    output[i][j] = a[i][j] * b;
                }
            }

            return output;
    }
}


/*
  Method      : Subtract
  Description : matrix subtraction
*/

function Subtract(a, b, output = []) {

    switch (typeof b) {

        case 'object':

            for (let i = 0, ii = a.length; i < ii; i++) {
                output[i] = [];

                for (let j = 0, jj = a[0].length; j < jj; j++) {
                    output[i][j] = a[i][j] - b[i][j];
                }
            }

            return output;

        case 'value':

            for (let i = 0, ii = a.length; i < ii; i++) {
                output[i] = [];

                for (let j = 0, jj = a[0].length; j < jj; j++) {
                    output[i][j] = a[i][j] - b;
                }
            }

            return output;
    }
}


/*
  Method      : Inverse
  Description : matrix inversion
*/

function Inverse(a, identity = [], inverse = []) {

    for (let i = 0, ii = a.length; i < ii; i++) {
        identity[i] = [];
        inverse[i] = [];

        for (let j = 0, jj = a.length; j < jj; j++) {

            if (i === j) {
                inverse[i][j] = 1;
            }
            else {
                inverse[i][j] = 0;
            }

            identity[i][j] = a[i][j];
        }
    }

    for (let i = 0, ii = identity.length; i < ii; i++) {
        let x = identity[i][i];

        if (x === 0) {

            for (let j = i+1, jj = identity.length; j < jj; j++) {
                if (identity[j][i] !== 0) {

                    for (let k = 0, kk = identity.length; k < kk; k++) {

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

        for (let j = 0, jj = identity.length; j < jj; j++) {

            identity[i][j] = identity[i][j] / x;
            inverse[i][j] = inverse[i][j] / x;
        }

        for (let j = 0, jj = identity.length; j < jj; j++) {
            if (i === j) { continue; }

            x = identity[j][i];

            for (let k = 0, kk = identity.length; k < kk; k++) {

                identity[j][k] -= x * identity[i][k];
                inverse[j][k] -= x * inverse[i][k];
            }
        }
    }

    for (let i = 0, ii = inverse.length; i < ii; i++) {
        for (let j = 0, jj = inverse.length; j < jj; j++) {
            inverse[i][j] = Math.round(inverse[i][j] * 100000) / 100000;
        }
    }

    return inverse;
}


/*
  Exports
*/

export { adjacencyMatrix, distanceMatrix, reciprocalMatrix, wienerIndex, hyperwienerIndex, hararyIndex};