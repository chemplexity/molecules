/*
  molecules.js

  description : dynamic 2D molecules
  imports     : elements, smiles
  exports     :
*/

/*
  Imports
*/

'use strict';

var _require = require('./elements');

var periodic_table = _require.periodic_table;

var _require2 = require('./smiles');

var tokenize = _require2.tokenize;
var decode = _require2.decode;

/*
  Parse
*/

function parse(input) {

  return decode(tokenize(input));
}