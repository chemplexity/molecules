'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
/*
  molecules.js

    description : dynamic 2D molecules
    imports     : elements, smiles
    exports     : getTokens, readTokens


    Examples

      getTokens ('tokenize SMILES input string')

        tokensABC = getTokens('CC(=O)C(Cl)CC(C(C)C)C=C');
        tokens123 = getTokens('CC1C(CC(CC1C)CCO)=O');
        tokens['A'] = getTokens('C2C(=O)C1COCCC1CC2');


      readTokens ('determine structure/connectivity from tokens')

        molecule1 = readTokens(tokensABC);
        moleculeA = readTokens(tokens123);
        molecule['abc'] = readTokens(tokens['A']);
*/

/*
  Imports
*/

var _periodic_table = require('./elements');

var _tokenize$decode = require('./smiles');

/*
  Method: getTokens
  --parse input string for valid SMILES definitions

  Syntax
    tokens = getTokens(input)

  Arguments
    input : any SMILES encoded string

  Output
    tokens : array of token objects

  Examples
    tokens123 = getTokens('CC(=O)CC')
    tokensABC = getTokens('c1cccc1')
*/

function getTokens(input) {

  return _tokenize$decode.tokenize(input);
}

/*
  Method: readTokens
  --convert SMILES tokens into atoms (nodes) and bonds (edges)

  Syntax
    {id, atoms, bonds} = readTokens(tokens)

  Arguments
    tokens : array of tokens obtained from 'getTokens'

  Output
    {id, atoms, bonds} : array of atom/bond objects

  Examples
    {id, atoms, bonds} = readTokens(mytokensABC)
    {id, atoms, bonds} = readTokens(tokens123)
*/

function readTokens(tokens) {

  return _tokenize$decode.decode(tokens);
}

/*
  Utility: getMolecule
  --return new molecule object
*/

function getMolecule() {
  var atoms = arguments[0] === undefined ? {} : arguments[0];
  var bonds = arguments[1] === undefined ? {} : arguments[1];
  var id = arguments[2] === undefined ? 0 : arguments[2];
  var name = arguments[3] === undefined ? '' : arguments[3];

  return {
    id: id,
    name: name,
    atoms: atoms,
    bonds: bonds,
    properties: {}
  };
}

/*
  Utility: molecular_formula
  --determine molecular formula
*/

function molecular_formula(atoms) {

  var formula = {},
      keys = Object.keys(atoms);

  for (var i = 0; i < keys.length; i++) {

    if (formula[atoms[keys[i]].name] === undefined) {
      formula[atoms[keys[i]].name] = 1;
    } else {
      formula[atoms[keys[i]].name] += 1;
    }
  }

  return formula;
}

/*
  Utility: molecular_weight
  --calculate molecular weight
*/

function molecular_weight(atoms) {

  var weight = 0,
      keys = Object.keys(atoms);

  for (var i = 0; i < keys.length; i++) {
    weight += atoms[keys[i]].protons + atoms[keys[i]].neutrons;
  }

  return Math.round(weight * 1000) / 1000;
}

/*
  Exports
*/

exports.getTokens = getTokens;
exports.readTokens = readTokens;
exports.molecular_formula = molecular_formula;
exports.molecular_weight = molecular_weight;