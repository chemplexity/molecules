/*
  molecules.js

  Description : chemical graph theory library
  Imports     : periodic_table, tokenize, decode
  Exports     : parse, connectivity, topology

*/


/*
  Imports
*/

import { periodic_table } from './reference/elements';
import { tokenize, decode } from './encoding/smiles';
import { adjacencyMatrix, distanceMatrix, reciprocalMatrix, wienerIndex, hyperwienerIndex, hararyIndex } from './extensions/topology';


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
  Function    : connectivity
  Description : return adjacency matrix and distance matrix of non-hydrogen atoms

  Syntax
    { header, adjacency, distance } = connectivity(molecule)

  Input
    molecule : object containing atoms and bonds

  Output
    header     : atom identifier
    adjacency  : adjacency matrix
    distance   : distance matrix
    reciprocal : reciprocal of distance matrix

  Examples
    { header: id, adjacency: adj, distance: dist, reciprocal: recip } = connectivity(mol123)
    { header: header123, adjacency: adj123, distance: dist123, recip123 } = connectivity(myMolecule)
    matricesABC = connectivity(molABC)
*/

function connectivity(molecule) {

    if (typeof molecule !== 'object') { return null; }

    let { header: header, adjacency: adjacency } =  adjacencyMatrix(molecule);
    let { distance: distance } = distanceMatrix(adjacency);
    let { reciprocal: reciprocal } = reciprocalMatrix(distance);

    return { header: header, adjacency: adjacency, distance: distance, reciprocal: reciprocal };
}


/*
  Function    : topology
  Description : return various molecular topological indexes

  Syntax
    { harary, hyper_wiener, wiener } = topology(molecule)

  Input
    molecule : object containing atoms and bonds

  Output
    harary       : Harary index
    hyper_wiener : Hyper-Wiener index
    wiener       : Wiener index

  Examples
    { harary: har1, hyper_wiener: hw1, wiener: w1 } = topology(mol123)
    { harary: harABC, hyper_wiener: hwABC, wiener: wABC } = topology(myMolecule)
    topologyABC = topology(molABC)
*/

function topology(molecule) {

    if (typeof molecule !== 'object') { return null; }

    return {
        harary: hararyIndex(molecule),
        hyper_wiener: hyperwienerIndex(molecule),
        wiener: wienerIndex(molecule)
    };
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

    return Math.round(mass * 10000) / 10000;
}


/*
  Exports
*/

export { parse, connectivity, topology };
