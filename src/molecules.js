/*
  molecules.js

    description : dynamic 2D molecules
    imports     : periodic_table, tokenize, decode
    exports     : getTokens, readTokens, molecularFormula, molecularWeight


    Examples

      getTokens - tokenize SMILES input string

        tokensABC = getTokens('CC(=O)C(Cl)CC(C(C)C)C=C');
        tokens123 = getTokens('CC1C(CC(CC1C)CCO)=O');
        tokens['A'] = getTokens('C2C(=O)C1COCCC1CC2');


      readTokens - determine structure/connectivity from tokens

        molecule1 = readTokens(tokensABC);
        moleculeA = readTokens(tokens123);
        molecule['abc'] = readTokens(tokens['A']);

*/


/*
  Imports
*/

import periodic_table from './reference/elements';
import { tokenize, decode } from './encoding/smiles';


// Experimental
function parse(input, encoding = 'SMILES') {

    switch (encoding) {

        case 'SMILES':
        case 'smiles':

            // Parse string
            if (typeof input === 'string') {
                return tokenize(input);
            }

            // Parse tokens
            else if (typeof input === 'object') {
                return decode(input);
            }

            return null;
    }
}


/*
  Method: getTokens
  --parse input string for valid SMILES definitions

  Syntax
    {tokens} = getTokens(input)

  Arguments
    input : any SMILES encoded string

  Output
    {tokens} : array of token objects

  Examples
    {tokens123} = getTokens('CC(=O)CC')
    {tokensABC} = getTokens('c1cccc1')

*/

function getTokens(input, encoding = 'SMILES') {

    if (typeof input === 'string') {

        // Tokenize input (smiles.js)
        return tokenize(input);
    }

    return null;
}


/*
  Method: readTokens
  --convert SMILES tokens into atoms (nodes) and bonds (edges)

  Syntax
    molecule = readTokens(tokens)

  Arguments
    tokens : array of tokens obtained from 'getTokens'

  Output
    molecule : collection of atoms and bonds

  Examples
    moleculeABC = readTokens(mytokensABC)
    molecule['C'] = readTokens(tokens123)

*/

function readTokens(tokens) {

    if (tokens.length > 1) {

        // Decode tokens (smiles.js)
        let {atoms, bonds} = decode(tokens);

        let molecule = getMolecule(atoms, bonds, 0, '0');

        molecule.properties.mass = molecularWeight(molecule.atoms);
        molecule.properties.formula = molecularFormula(molecule.atoms);

        return molecule;
    }

    return null;
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
            mass: null,
            formula: null
        }
    };
}


/*
  Utility: molecularFormula
  --determine molecular formula
*/

function molecularFormula(atoms) {

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

export { getTokens, readTokens, molecularFormula, molecularWeight };
