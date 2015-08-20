/**
 * File        : molecules.js
 * Description : chemical graph theory library
 *
 * Options     : format, topology
 */

import { tokenize, decode } from './format/smiles';
import { topology } from './core/topology';

/**
 * Method      : format
 * Description : convert to/from supported chemical file formats
 *
 * Options     : load, save
 */

var format = {

    /**
     * Method      : format.load
     * Description : load molecule from supported chemical file format
     *
     * Options     : smiles, json
     */

    load: {

        /**
         * Method      : format.load.smiles(input)
         * Description : load molecule from SMILES string
         */

        smiles: function (input) {
            let { atoms, bonds } = decode(tokenize(input));
            return getMolecule(atoms, bonds);
        },

        /**
         * Method      : format.load.json(input)
         * Description : load molecule from JSON object
         */

        json: function (input) {
            return JSON.parse(input);
        }
    },

    /**
     * Method      : format.save
     * Description : save molecule as supported chemical file formats
     *
     * Options     : json
     */

    save: {

        /**
         * Method      : format.save.json(input)
         * Description : save molecule as JSON object
         */

        json: function (input) {
            return JSON.stringify(input, null, '\t');
        }
    }
};

/**
 * Method      : topology
 * Description : chemical graph matrices and topological indices
 *
 * Options     : matrix, index
 */

var topology = {

    /**
     * Method      : topology.matrix
     * Description : chemical graph matrices
     *
     * Options     : adjacency, degree, distance, lapacian, randic, reciprocal
     */

    matrix: {

        /**
         * Method      : topology.matrix.adjacency(G)
         * Description : returns adjacency matrix (A)
         */

        adjacency: function (G) {
            return topology.matrix.adjacency(G);
        },

        /**
         * Method      : topology.matrix.degree(A)
         * Description : returns degree matrix (DEG)
         */

        degree: function (A) {
            return topology.matrix.degree(A);
        },

        /**
         * Method      : topology.matrix.distance(A)
         * Description : returns distance matrix (D)
         *
         * Reference   : R. Seidel, ACM, (1992) 745-749.
         */

        distance: function (A) {
            return topology.matrix.distance(A);
        },

        /**
         * Method      : topology.matrix.lapacian(A, DEG)
         * Description : returns lapacian matrix (L)
         */

        lapacian: function (A, DEG) {
            return topology.matrix.lapacian(A, DEG);
        },

        /**
         * Method      : topology.matrix.randic(A, DEG)
         * Description : returns randic matrix (R)
         */

        randic: function (A, DEG) {
            return topology.matrix.randic(A, DEG);
        },

        /**
         * Method      : topology.matrix.reciprocal(D)
         * Description : returns reciprocal matrix (RD)
         */

        reciprocal: function (D) {
            return topology.matrix.reciprocal(D);
        }
    },

    /**
     * Method      : topology.index
     * Description : molecular topological indices
     *
     * Options     : balaban, harary, hyperwiener, randic, wiener
     */

    index: {

        /**
         * Method      : topology.index.balaban(D)
         * Description : returns the Balaban index (J)
         */

        balaban: function (RD) {
            return topology.index.balaban(D);
        },

        /**
         * Method      : topology.index.harary(RD)
         * Description : returns the Harary index (H)
         */

        harary: function (RD) {
            return topology.index.harary(RD);
        },

        /**
         * Method      : topology.index.hyperwiener(D)
         * Description : returns the Hyper-Wiener index (WW)
         */

        hyperwiener: function (D) {
            return topology.index.hyperwiener(D);
        },

        /**
         * Method      : topology.index.randic(A, DEG)
         * Description : returns the Randic index (R)
         */

        randic: function (A, DEG) {
            return topology.index.randic(A, DEG);
        },

        /**
         * Method      : topology.index.wiener(D)
         * Description : returns the Wiener index (W)
         */

        wiener: function (D) {
            return topology.index.wiener(D);
        }
    }
};

/**
 * Method      : getMolecule
 * Description : return molecule
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

/**
 * Method      : getFormula
 * Description : return molecular formula
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

/**
 * Method      : getName
 * Description : return molecular formula as string
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

/**
 * Method      : getMass
 * Description : return molecular weight
 */

function getMass(atoms, mass = 0) {

    if (typeof atoms !== 'object') { return null; }

    let keys = Object.keys(atoms);

    for (let i = 0; i < keys.length; i++) {
        mass += atoms[keys[i]].protons + atoms[keys[i]].neutrons;
    }

    return Math.round(mass * 10000) / 10000;
}

/**
 * Exports
 */

export { format, topology };
