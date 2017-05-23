/**
 * File        : molecules.js
 * Version     : 0.1.1-20170523
 * Description : chemical graph theory library
 **/

import { tokenize, decode } from './main/smiles';
import { default as Topology } from './main/topology';


/**
 * load
 * load molecules from supported chemical file format
 */

var load = {

    /**
     * load.smiles
     * @param {String} input - SMILES encoded string
     * @return {Object} molecule object
     */

    smiles: function (input) {
        let { tokens } = tokenize(input);
        let { atoms, bonds } = decode(tokens);
        return getMolecule(atoms, bonds);
    },

    /**
     * load.json
     * @param {String} input - JSON encoded string
     * @return {Object} molecule object
     */

    json: function (input) {
        return JSON.parse(input);
    }

};

/**
 * save
 * save molecule as supported chemical file formats
 */

var save = {

    /**
     * save.json
     * @param {Object} input - molecule object
     * @return {String} JSON encoded string
     */

    json: function (input) {
        return JSON.stringify(input, null, '\t');
    },

    /**
     * save.d3
     * @param {Object} input - molecule object
     * @return {Object} d3 graph object {nodes: atoms, links: bonds}
     */

    d3: function (input) {
        return molecule2graph(input);
    }

};

/**
 * topology
 * chemical graph matrices and topological indices
 */

var topology = {

    /**
     * topology.matrix
     * adjacency, degree, distance, lapacian, randic, reciprocal
     */

    matrix: {

        /**
         * topology.matrix.adjacency
         * @param {Object} G - molecule object
         * @return {Array} A - adjacency matrix
         */

        adjacency: function (G) {
            return Topology.matrix.adjacency(G);
        },

        /**
         * topology.matrix.degree
         * @param {Array} A - adjacency matrix
         * @return {Array} DEG - degree matrix
         */

        degree: function (A) {
            return Topology.matrix.degree(A);
        },

        /**
         * topology.matrix.distance
         * @param {Array} A - adjacency matrix
         * @return {Array} D - distance matrix
         */

        distance: function (A) {
            return Topology.matrix.distance(A);
        },

        /**
         * topology.matrix.lapacian
         * @param {Array} A - adjacency matrix
         * @param {Array} DEG - degree matrix
         * @return {Array} L - Lapacian matrix
         */

        lapacian: function (A, DEG) {
            return Topology.matrix.lapacian(A, DEG);
        },

        /**
         * topology.matrix.randic
         * @param {Array} A - adjacency matrix
         * @param {Array} DEG - degree matrix
         * @return {Array} R - Randic matrix
         */

        randic: function (A, DEG) {
            return Topology.matrix.randic(A, DEG);
        },

        /**
         * topology.matrix.reciprocal
         * @param {Array} D - distance matrix
         * @return {Array} RD - reciprocal matrix
         */

        reciprocal: function (D) {
            return Topology.matrix.reciprocal(D);
        }
    },

    /**
     * topology.index
     * balaban, harary, hyperwiener, randic, wiener
     */

    index: {

        /**
         * topology.index.balaban
         * @param {Array} D - distance matrix
         * @return {Number} J - Balaban index
         */

        balaban: function (D) {
            return Topology.index.balaban(D);
        },

        /**
         * topology.index.harary
         * @param {Array} RD - reciprocal matrix
         * @return {Number} H - Harary index
         */

        harary: function (RD) {
            return Topology.index.harary(RD);
        },

        /**
         * topology.index.hyperwiener
         * @param {Array} D - distance matrix
         * @return {Number} WW - Hyper-Wiener index
         */

        hyperwiener: function (D) {
            return Topology.index.hyperwiener(D);
        },

        /**
         * topology.index.randic
         * @param {Array} DEG - degree matrix
         * @return {Number} R - Randic index
         */

        randic: function (DEG) {
            return Topology.index.randic(DEG);
        },

        /**
         * topology.index.wiener
         * @param {Array} D - distance matrix
         * @return {Number} W - Wiener index
         */

        wiener: function (D) {
            return Topology.index.wiener(D);
        }
    }
};

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

/**
 * getMolecule
 * @param {Object} atoms - SMILES decoded atoms
 * @param {Object} bonds - SMILES decoded bonds
 * @param {Number} id - user specified identifier
 * @return {Object} molecule object
 */

function getMolecule(atoms = {}, bonds = {}, id = 0) {

    if (typeof atoms !== 'object') { return null; }

    let mass = getMass(atoms);
    let formula = getFormula(atoms);
    let name = getName(formula);

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
 * getFormula
 * @param {Object} atoms
 * @return {Object} formula object {elementName: elementCount}
 */

function getFormula(atoms) {

    if (typeof atoms !== 'object') { return null; }

    let keys = Object.keys(atoms);
    let formula = {};

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
 * getName
 * @param {Object} formula object
 * @return {String} formula string
 */

function getName(formula) {

    if (typeof formula !== 'object') { return null; }

    let keys = Object.keys(formula).sort();
    let name = [];

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
 * getMass
 * @param {Object} atoms
 * @return {Number} molecular weight
 */

function getMass(atoms) {

    if (typeof atoms !== 'object') { return null; }

    let keys = Object.keys(atoms);
    let mass = 0;

    for (let i = 0; i < keys.length; i++) {
        mass += atoms[keys[i]].protons + atoms[keys[i]].neutrons;
    }

    let x = 5;

    return Math.round(mass * Math.pow(10,x)) / Math.pow(10,x);
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
