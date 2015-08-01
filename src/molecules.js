/*
  File        : molecules.js
  Description : chemical graph theory library

  Imports     : elements, tokenize, decode
  Exports     : parse, encode, connectivity, topology
*/


/*
  Imports
*/

import { tokenize, decode } from './encoding/smiles';
import { adjacencyMatrix, distanceMatrix, reciprocalMatrix } from './geometry/connectivity';
import { wienerIndex, hyperwienerIndex, hararyIndex } from './descriptors/topology';


/*
  Method      : parse
  Description : convert string to object

  Options     : .smiles, .json

  Examples
    myMolecule = Molecules.parse.smiles('CC(=O)CN')
    myMolecule = Molecules.parse.json(myJSON)
*/

var parse = {

    smiles : function (input) {

        if (typeof input === 'string') {

            let { atoms, bonds } = decode(tokenize(input));

            return getMolecule(atoms, bonds);
        }

    },

    json : function (input) {

        if (typeof input === 'string') {

            return JSON.parse(input);
        }
    }
};


/*
  Method      : encode
  Description : convert object to string

  Options     : .json

  Examples
    myJSON = Molecules.encode.json(myMolecule)
*/

var encode = {

    json : function (input) {

        if (typeof input === 'object') {

            return JSON.stringify(input, null, '\t');
        }
    }
};


/*
  Method      : connectivity
  Description : chemical graph matrices

  Options     : .adjacency, .distance, .reciprocal
*/

var connectivity = {

    adjacency : function (molecule) {
        return adjacencyMatrix(molecule);
    },

    distance : function (molecule) {
        return distanceMatrix(molecule);
    },

    reciprocal : function (molecule) {
        return reciprocalMatrix(molecule);
    }
};


/*
  Method      : topology
  Description : molecular topological indices

  Options     : .harary, .hyperwiener, .wiener
*/

var topology = {

    harary : function (molecule) {
        return hararyIndex(molecule);
    },

    hyperwiener : function (molecule) {
        return hyperwienerIndex(molecule);
    },

    wiener : function (molecule) {
        return wienerIndex(molecule);
    }
};


/*
  Method      : getMolecule
  Description : return new molecule
*/

function getMolecule(atoms = {}, bonds = {}, id = 0) {

    let mass = getMass(atoms),
        formula = getFormula(atoms),
        name = getName(formula);

    return {
        id: id,
        name: name,
        atoms: atoms,
        bonds: bonds,
        properties: {
            mass: mass,
            formula: formula
        }
    };
}


/*
  Method      : getFormula
  Description : return molecular formula
*/

function getFormula(atoms, formula = {}) {

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
  Method      : getName
  Description : return molecular formula as string
*/

function getName(formula, name = []) {

    if (typeof formula !== 'object') { return null; }

    let keys = Object.keys(formula).sort();

    let remove = (element) => keys.splice(keys.indexOf(element), 1);

    let update = (element) => {
        if (formula[element] === 1) { name.push(element); }
        else { name.push(element + formula[element]); }
    };

    if (keys.indexOf('C') !== -1) {
        update('C');
        remove('C');
    }

    if (keys.indexOf('H') !== -1) {
        update('H');
        remove('H');
    }

    if (keys.length > 0) {

        for (let i = 0; i < keys.length; i++) {
            update(keys[i]);
        }
    }

    return name.join('');
}


/*
  Method      : getMass
  Description : return molecular weight
*/

function getMass(atoms, mass = 0) {

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

export { parse, encode, connectivity, topology };
