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
        butane.tokens = parse('CCCC', 'smiles')

    b) Tokens -> Molecule
        mol123 = parse(tokens123)
        molABC = parse(tokensABC.tokens)
        molABC = parse(tokensABC)
        mol['42'] = parse(myTokens['42'].tokens)
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

                return getMolecule(atoms, bonds);
            }

            return null;
    }
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

export { parse };
