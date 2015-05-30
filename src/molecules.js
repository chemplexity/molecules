/*
  molecules.js

    description : chemical graph theory library
    imports     : periodic_table, tokenize, decode
    exports     : parse, adjacency

*/


/*
  Imports
*/

import { periodic_table } from './reference/elements';
import { tokenize, decode } from './encoding/smiles';


/*
  Method : parse
  Description : convert string to tokens OR tokens to molecule

  Syntax
    output = parse(input)
    output = parse(input, encoding)

  Input (Required)
    1) chemical notation string (e.g. 'C2C(=O)C1COCCC1CC2')
    2) 'tokens' returned from output of 'a)'

  Input (Optional)
    encoding : encoding type of input (default = 'SMILES')

  Output
    1) 'tokens' from a parsed chemical notation string
    2) 'molecule' object with atoms and bonds from a set of tokens

  Examples
    1) String -> Tokens
        tokens123 = parse('CC(=O)CC')
        tokensABC = parse('c1cccc1', 'SMILES')
        myTokens['42'] = parse('CC(O)CC')
        butane.tokens = parse('CCCC', 'smiles')

    2) Tokens -> Molecule
        mol123 = parse(tokens123)
        molABC = parse(tokensABC)
        mol['42'] = parse(myTokens['42'].tokens)
        butane.molecule = parse(butane.tokens)
*/

function parse(input, encoding = 'SMILES') {

    switch (encoding) {

        case 'SMILES':
        case 'smiles':

            // 1) String -> Tokens
            if (typeof input === 'string') {
                let {tokens} = tokenize(input);

                return tokens;
            }

            // 2) Tokens -> Molecule
            else if (typeof input === 'object') {
                let {atoms, bonds} = decode(input);

                return getMolecule(atoms, bonds);
            }

            return null;
    }
}


/*
  Method : adjacency
  Description : return adjacency matrix for non-hydrogen atoms in molecule

  Syntax
    {header, matrix} = adjacency(molecule)

  Input
    molecule : object containing atoms and bonds

  Output
    header   : atom identifier
    matrix   : adjacency matrix

  Examples
    {id, adj} = adjacency(mol123)
    {names, matrix} = adjacency(molABC)
*/
function adjacency(molecule){

    if (typeof molecule !== 'object') { return null; }

    let atoms = Object.keys(molecule.atoms),
        header = [],
        matrix = [];

    // Extract non-hydrogen atoms
    for (let i = 0; i < atoms.length; i++) {

        let atom = molecule.atoms[atoms[i]];

        if (atom.name !== 'H') {
            header.push(atom.id);
        }
    }

    // Initialize adjacency matrix
    for (let i = 0; i < header.length; i++) {
        matrix[i] = [];

        for (let j = 0; j < header.length; j++) {
            matrix[i][j] = 0;
        }
    }

    // Fill adjacency matrix
    for (let i = 0; i < header.length; i++) {
        let source = molecule.atoms[header[i]];

        for (let j = 0; j < source.bonds.atoms.length; j++) {
            let target = molecule.atoms[source.bonds.atoms[j]];

            if (target.name !== 'H') {

                let index = header.indexOf(target.id);

                if (index >= 0) {
                    matrix[i][index] = 1;
                    matrix[index][i] = 1;
                }
            }
        }
    }

    return {header, matrix};
}


/*
  Utility: getMolecule
  --return new molecule object
*/

function getMolecule(atoms = {}, bonds = {}, id = 0, name = '') {

    return {
        id: id,
        name: name,
        atoms: atoms,
        bonds: bonds,
        properties: {
            mass: molecularWeight(atoms),
            formula: molecularFormula(atoms)
        }
    };
}


/*
  Utility: molecularFormula
  --determine molecular formula
*/

function molecularFormula(atoms) {

    if (typeof atoms !== 'object') { return null; }

    let formula = {},
        keys = Object.keys(atoms);

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
  Utility: molecularWeight
  --calculate molecular weight
*/

function molecularWeight(atoms) {

    if (typeof atoms !== 'object') { return null; }

    let mass = 0,
        keys = Object.keys(atoms);

    for (let i = 0; i < keys.length; i++) {
        mass += atoms[keys[i]].protons + atoms[keys[i]].neutrons;
    }

    return Math.round(mass * 1000) / 1000;
}


/*
  Exports
*/

export { parse, adjacency };
