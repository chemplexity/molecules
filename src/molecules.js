/**
 * File        : molecules.js
 * Version     : 0.1.0-20170525
 * Description : chemical graph theory library
 *
 * Options     : load, save, topology
 */

import { tokenize, decode } from './main/smiles';
import { default as Topology } from './main/topology';


/**
 * Method      : load
 * Description : load molecule from supported chemical file format
 *
 * Options     : load.smiles, load.json
 */

var load = {

    /**
     * Method      : load.smiles(input)
     * Description : load molecule from SMILES string
     */

    smiles: function (input) {
        let { tokens } = tokenize(input);
        let { atoms, bonds } = decode(tokens);
        return getMolecule(atoms, bonds);
    },

    /**
     * Method      : load.json(input)
     * Description : load molecule from JSON object
     */

    json: function (input) {
        return JSON.parse(input);
    }

};

/**
 * Method      : save
 * Description : save molecule as supported chemical file formats
 *
 * Options     : json
 */

var save = {

    /**
     * Method      : save.json(input)
     * Description : save molecule as JSON object
     */

    json: function (input) {
        return JSON.stringify(input, null, '\t');
    },

    /**
     * Method      : save.d3(input)
     * Description : save molecule as d3 graph object {nodes: atoms, links: bonds}
     */

    d3: function (input) {
        return molecule2graph(input);
    }

};

/**
 * Method      : topology
 * Description : chemical graph matrices and topological indices
 *
 * Options     : topology.matrix, topology.index
 */

var topology = {

    /**
     * Method      : topology.matrix
     * Description : chemical graph matrices
     *
     * Options     : adjacency, degree, distance, laplacian, randic, reciprocal
     */

    matrix: {

        /**
         * Method      : topology.matrix.adjacency(G)
         * Description : returns adjacency matrix (A)
         */

        adjacency: function (G) {
            return Topology.matrix.adjacency(G);
        },

        /**
         * Method      : topology.matrix.degree(A)
         * Description : returns degree matrix (DEG)
         */

        degree: function (A) {
            return Topology.matrix.degree(A);
        },

        /**
         * Method      : topology.matrix.distance(A)
         * Description : returns distance matrix (D)
         *
         * Reference   : R. Seidel, ACM, (1992) 745-749.
         */

        distance: function (A) {
            return Topology.matrix.distance(A);
        },

        /**
         * Method      : topology.matrix.laplacian(A, DEG)
         * Description : returns Laplacian matrix (L)
         */

        laplacian: function (A, DEG) {
            return Topology.matrix.laplacian(A, DEG);
        },

        /**
         * Method      : topology.matrix.randic(A, DEG)
         * Description : returns Randic matrix (R)
         */

        randic: function (A, DEG) {
            return Topology.matrix.randic(A, DEG);
        },

        /**
         * Method      : topology.matrix.reciprocal(D)
         * Description : returns reciprocal matrix (RD)
         */

        reciprocal: function (D) {
            return Topology.matrix.reciprocal(D);
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

        balaban: function (D) {
            return Topology.index.balaban(D);
        },

        /**
         * Method      : topology.index.harary(RD)
         * Description : returns the Harary index (H)
         */

        harary: function (RD) {
            return Topology.index.harary(RD);
        },

        /**
         * Method      : topology.index.hyperwiener(D)
         * Description : returns the Hyper-Wiener index (WW)
         */

        hyperwiener: function (D) {
            return Topology.index.hyperwiener(D);
        },

        /**
         * Method      : topology.index.randic(R)
         * Description : returns the Randic index (RI)
         */

        randic: function (R) {
            return Topology.index.randic(R);
        },

        /**
         * Method      : topology.index.wiener(D)
         * Description : returns the Wiener index (W)
         */

        wiener: function (D) {
            return Topology.index.wiener(D);
        }
    }
};

/**
 * Method      : getMolecule
 * Description : return molecule
 */

class Molecule {

    constructor() {

        this.id = [];
        this.name = [];
        this.tags = [];

        this.atoms = [];
        this.bonds = [];
        this.properties = {};
    }
}

class Atom {

    constructor() {

        this.id = [];
        this.name = [];
        this.tags = [];

        this.bonds = [];
        this.properties = {};
    }
}

class Bond {

    constructor () {

        this.id = [];
        this.name = [];
        this.tags = [];

        this.atoms = [];
        this.properties = {};
    }
}


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
 * molecule2graph
 * @param {Object} molecule object
 * @return {Object} d3 graph object {nodes: atoms, links: bonds}
 */

function molecule2graph(molecule) {

    if (typeof molecule !== 'object') { return null; }

    let atoms = Object.keys(molecule.atoms);
    let bonds = Object.keys(molecule.bonds);

    let nodes = [];
    let links = [];

    for (let i = 0; i < atoms.length; i++) {

        nodes.push({
            id: molecule.atoms[atoms[i]].id,
            name: molecule.atoms[atoms[i]].name,
            group: molecule.atoms[atoms[i]].group,
            protons: molecule.atoms[atoms[i]].protons,
            neutrons: molecule.atoms[atoms[i]].neutrons,
            electrons: molecule.atoms[atoms[i]].electrons,
            bonds: molecule.atoms[atoms[i]].bonds,
            properties: molecule.atoms[atoms[i]].properties
        });
    }

    for (let i = 0; i < bonds.length; i++) {

        links.push({
            id: molecule.bonds[bonds[i]].id,
            name: molecule.bonds[bonds[i]].name,
            value: molecule.bonds[bonds[i]].value,
            source: molecule.bonds[bonds[i]].atoms[0],
            target: molecule.bonds[bonds[i]].atoms[1],
            //source: atoms.indexOf(molecule.bonds[bonds[i]].atoms[0]),
            //target: atoms.indexOf(molecule.bonds[bonds[i]].atoms[1]),
            order: molecule.bonds[bonds[i]].order
        });
    }

    return {nodes: nodes, links: links};
}

/**
 * Exports
 */

export { load, save, topology };
