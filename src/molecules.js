/*
  molecules.js

  description : dynamic 2D molecules
  imports     : elements, smiles
  exports     :
*/


/*
  Imports
*/

let {periodic_table} = require('./elements');
let {tokenize, decode} = require('./smiles');


/*
  Parse
*/

function parse(input) {

    return decode(tokenize(input));
}
