/*
  molecules.js

  Description : chemical graph theory library
  Imports     : periodic_table, tokenize, decode
  Exports     : parse, adjacency, distance

*/


/*
  Imports
*/

import { periodic_table } from './reference/elements';
import { tokenize, decode } from './encoding/smiles';


/*
  Function    : parse
  Description : convert SMILES --> tokens OR tokens --> molecule

  Syntax
    output = parse(input)

  Input
    1) 'string' (e.g. 'C2C(=O)C1COCCC1CC2')
    2) 'tokens' returned from output of 'a)'

  Output
    1) 'tokens' from a parsed SMILES string
    2) 'molecule' object from a set of tokens

  Examples
    1) tokens123 = parse('CC(=O)CC')
       tokensABC = parse('c1cccc1')
       butane.tokens = parse('CCCC')

    2) mol123 = parse(tokens123)
       molABC = parse(tokensABC)
       butane.molecule = parse(butane.tokens)
*/

function parse(input, encoding = 'SMILES') {

    switch (encoding.toUpperCase()) {

        case 'SMILES':

            // 1) String -> Tokens
            if (typeof input === 'string') {
                let {tokens} = tokenize(input);

                return tokens;
            }

            // 2) Tokens -> Molecule
            else if (typeof input === 'object') {
                let {atoms, bonds} = decode(input);

                return Molecule(atoms, bonds);
            }

            return null;
    }
}


/*
  Function    : adjacency
  Description : return adjacency matrix of non-hydrogen atoms

  Syntax
    { header, matrix } = adjacency(molecule)

  Input
    molecule : object containing atoms and bonds

  Output
    header : atom identifier
    matrix : adjacency matrix

  Examples
    { header: id, matrix: adj } = adjacency(mol123)
    { header: names, matrix: matrix } = adjacency(molABC)
    { header: header123, matrix: data123 } = adjacency(myMolecule)
*/

function adjacency(molecule, header = [], matrix = []) {

    if (typeof molecule !== 'object') { return null; }

    let keys = Object.keys(molecule.atoms);

    // Extract non-hydrogen atoms
    for (let i = 0; i < keys.length; i++) {

        if (molecule.atoms[keys[i]].name !== 'H') {
            header.push(molecule.atoms[keys[i]].id);
        }
    }

    // Fill adjacency matrix
    matrix = Matrix(header.length);

    for (let i = 0; i < header.length; i++) {
        let source = molecule.atoms[header[i]];

        for (let j = 0; j < source.bonds.atoms.length; j++) {
            let target = molecule.atoms[source.bonds.atoms[j]],
                index = header.indexOf(target.id);

            if (target.name !== 'H' && index > 0) {
                matrix[i][index] = 1;
                matrix[index][i] = 1;
            }
        }
    }

    return { header: header, matrix: matrix };
}


/*
  Function    : distance
  Description : return matrix of shortest paths between non-hydrogen atoms

  Syntax
    { header, matrix } = distance(input)

  Input
    1) 'molecule' object
    2) 'adjacency' matrix

  Output
    header : atom identifier
    matrix : distance matrix

  Examples
    { header: id, matrix: d } = distance(adjacent123)
    { header: names, matrix: matrix } = distance(myMoleculeABC)
    { header: header123, matrix: dist123 } = distance(adj123)
    { header: atomID, matrix: shortestPaths } = distance(mol.butane)

  References
    R. Seidel, 'On the All-Pairs Shortest-Path Problem', ACM, (1992) 745-749.
*/

function distance(input, adjacent = input, header = [], matrix = []) {

    if (typeof input !== 'object') { return null; }

    // Molecule --> Adjacency matrix
    if (input.atoms !== undefined) {
        input = adjacency(input);
    }

    if (input.matrix !== undefined) {
        adjacent = input.matrix;
    }
    if (input.header !== undefined) {
        header = input.header;
    }

    // Validate adjacency matrix
    for (var i = 0; i < adjacent.length; i++) {
        if (adjacent[i].length !== adjacent.length) { return null; }
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

        for (var i = 0; i < X.length; i++) {
            D[i] = [];

            for (var j = 0; j < X[0].length; j++) {

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

    matrix = Seidel(adjacent);

    return { header, matrix };
}


/*
  Function    : Molecule
  Description : return new molecule
*/

function Molecule(atoms = {}, bonds = {}, id = 0, name = 0) {

    return {
        id: id,
        name: name,
        atoms: atoms,
        bonds: bonds,
        properties: {
            mass: Mass(atoms),
            formula: Formula(atoms)
        }
    };
}


/*
  Function    : Formula
  Description : return molecular formula
*/

function Formula(atoms, formula = {}) {

    if (typeof atoms !== 'object') { return null; }

    let keys = Object.keys(atoms);

    for (let i = 0; i < keys.length; i++) {

        if (formula[atoms[keys[i]].name] === undefined) {
            formula[atoms[keys[i]].name] = 1;
        }
        else {
            formula[atoms[keys[i]].name] += 1;
        }
    }

    return formula;
}


/*
  Function    : Mass
  Description : determine molecular weight
*/

function Mass(atoms, mass = 0) {

    if (typeof atoms !== 'object') { return null; }

    let keys = Object.keys(atoms);

    for (let i = 0; i < keys.length; i++) {
        mass += atoms[keys[i]].protons + atoms[keys[i]].neutrons;
    }

    return Math.round(mass * 1000) / 1000;
}


/*
  Function    : Matrix
  Description : various matrix functions
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
  Exports
*/

export { parse, adjacency, distance };
