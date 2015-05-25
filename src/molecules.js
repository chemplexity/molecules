/*
  molecules.js

    description : chemical graph theory library
    imports     : periodic_table, tokenize, decode
    exports     : parse

*/


/*
  Imports
*/

import { periodic_table } from './reference/elements';
import { tokenize, decode } from './encoding/smiles';


/*
  Method: parse
  --parse input string or set of tokens

  Syntax
    output = parse(input)
    output = parse(input, encoding)

  Arguments
    input  : a) chemical notation string (e.g. 'C2C(=O)C1COCCC1CC2')
             b) tokens returned from output of 'a)' (e.g. '{tokens: tokens}')

    encoding (Optional) : encoding type of input (default = 'SMILES')

  Output
    output : a) 'tokens' from a parsed chemical notation string
             b) 'molecule' object with atoms and bonds from a set of tokens

  Examples
    a) String -> Tokens
        tokens123 = parse('CC(=O)CC')
        tokensABC = parse('c1cccc1', 'SMILES')
        myTokens['42'] = parse('CC(O)CC')
        tokens.butane = parse('CCCC')
        butane.tokens = parse('CCCC', 'smiles')
        tokensA[3] = parse('CC1C(CC(CC1C)CCO)=O')

    b) Tokens -> Molecule
        mol123 = parse(tokens123)
        molABC = parse(tokensABC.tokens)
        molABC = parse(tokensABC)
        mol['42'] = parse(myTokens['42'].tokens)
        m.butane = parse(tokens.butane)
        butane.molecule = parse(butane.tokens)
*/

function parse(input, encoding = 'SMILES') {

    switch (encoding) {

        case 'SMILES':
        case 'smiles':

            // String -> Tokens
            if (typeof input === 'string') {
                let {tokens} = tokenize(input);

                return tokens;
            }

            // Tokens -> Molecule
            else if (typeof input === 'object') {
                let {atoms, bonds} = decode(input);

                return [atoms, bonds];
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

export { parse, getTokens, readTokens, molecularFormula, molecularWeight };
