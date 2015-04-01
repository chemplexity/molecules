//
// smiles.js
// -parse SMILES chemical line notation
//

/* TODO
 *  -Fix carbonyl parsing
 */

(function (root, factory) {

    if (typeof define === 'function' && define.amd) {
        // AMD
        define([], factory);

    } else if (typeof exports === 'object') {
        // Node
        module.exports = factory();

    } else {
        // Global
        root.exports = factory();
    }
}(this, function () {

    'use strict';

    var instance;

    function initialize() {

        // Definitions
        var definitions = [
            {category: 'atom',    type: 'hydrogen',      symbol: 'H',  expression: '[A-Z]?[H]([0-9]?)+'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'Cl', expression: 'Cl'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'Br', expression: 'Br'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'B',  expression: 'B(?=[^eraihk]|$)'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'C',  expression: 'C(?=[^larou]|$)'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'N',  expression: 'N(?=[^aei]|$)'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'O',  expression: 'O'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'F',  expression: 'F'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'P',  expression: 'P'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'S',  expression: 'S(?=[^ei]|$)'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'I',  expression: 'I'},
            {category: 'atom',    type: 'aromatic',      symbol: 'B',  expression: 'b'},
            {category: 'atom',    type: 'aromatic',      symbol: 'C',  expression: 'c'},
            {category: 'atom',    type: 'aromatic',      symbol: 'N',  expression: 'n'},
            {category: 'atom',    type: 'aromatic',      symbol: 'O',  expression: 'o'},
            {category: 'atom',    type: 'aromatic',      symbol: 'P',  expression: 'p'},
            {category: 'atom',    type: 'aromatic',      symbol: 'S',  expression: 's(?=[^ei]|$)'},
            {category: 'bond',    type: 'single',        symbol: '-',  expression: '[a-zA-Z][-](?=[^\\d-])'},
            {category: 'bond',    type: 'double',        symbol: '=',  expression: '[=]'},
            {category: 'bond',    type: 'triple',        symbol: '#',  expression: '[#]'},
            {category: 'bond',    type: 'quadrupole',    symbol: '$',  expression: '[$]'},
            {category: 'branch',  type: 'start',         symbol: '(',  expression: '[(]'},
            {category: 'branch',  type: 'end',           symbol: ')',  expression: '[)]'},
            {category: 'chiral',  type: 'anticlockwise', symbol: '@',  expression: '[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])'},
            {category: 'chiral',  type: 'clockwise',     symbol: '@@', expression: '[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)'},
            {category: 'ring',    type: 'index',         symbol: '%',  expression: '(?=[^+-])(?:[a-zA-Z]{1})[%]?\\d+(?=([^0-9+-]|$))'},
            {category: 'charge',  type: 'positive',      symbol: '+',  expression: '[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\\]])'},
            {category: 'charge',  type: 'negative',      symbol: '-',  expression: '[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\\]])'},
            {category: 'isotope', type: 'neutrons',      symbol: 'n',  expression: '[0-9]+[A-Z]{1,2}(?=.?[^\\[]*[\\]])'},
            {category: 'other',   type: 'wildcard',      symbol: '*',  expression: '[*]'},
            {category: 'other',   type: 'disconnect',    symbol: '.',  expression: '[A-Z][+-]?[\\[]?[.]'}
        ];

        var valence = [
            {symbol: 'H', value: 1},
            {symbol: 'Cl', value: 7},
            {symbol: 'Br', value: 7},
            {symbol: 'B', value: 3},
            {symbol: 'C', value: 4},
            {symbol: 'N', value: 5},
            {symbol: 'O', value: 6},
            {symbol: 'F', value: 7},
            {symbol: 'P', value: 4},
            {symbol: 'S', value: 6},
            {symbol: 'I', value: 7}
        ];

        // Molecule
        function Molecule (id, name, atoms, bonds, properties) {
            this.id = id;
            this.name = name;
            this.atoms = atoms;
            this.bonds = bonds;
            this.properties = properties;
        }

        // Atom
        function Atom (id, name, bonds, properties) {
            this.id = id;
            this.name = name;
            this.bonds = bonds;
            this.properties = properties;
        }

        // Bond
        function Bond (id, name, atoms, properties) {
            this.id = id;
            this.name = name;
            this.atoms = atoms;
            this.properties = properties;
        }

        // Determine molecular formula
        function getFormula(atoms) {

            var formula = {};

            // Count each element
            for (var i = 0; i < atoms.length; i++) {

                if (atoms[i].name in formula) { formula[atoms[i].name] += 1; }
                else { formula[atoms[i].name] = 1; }
            }

            return formula;
        }

        // Convert molecular formula to string
        function getName(formula) {

            var name = [],
                keys = Object.keys(formula).sort();

            for (var i = 0; i < keys.length; i++) {

                switch (keys[i]) {

                    case 'C':
                        name.splice(0, 0, 'C' + formula[keys[i]]);
                        break;
                    case 'H':
                        name.splice(1, 0, 'H' + formula[keys[i]]);
                        break;
                    case 'O':
                        name.splice(2, 0, 'O' + formula[keys[i]]);
                        break;
                    case 'N':
                        name.splice(2, 0, 'N' + formula[keys[i]]);
                        break;

                    default:
                        name.push(keys[i] + formula[keys[i]]);
                }
            }
            return name.join('');
        }

        // Find nearest atoms
        function nearestAtom(id, atoms, direction) {

            var distance = [], index = [];

            for (var i = 0; i < atoms.length; i++) {

                // Direction to search (left:-1, right: 1)
                switch (direction) {
                    case -1:
                        if (id < atoms[i].id) { continue; }
                        distance.push(id - atoms[i].id);
                        index.push(i);
                        break;
                    case 1:
                        if (id > atoms[i].id) { continue; }
                        distance.push(atoms[i].id - id);
                        index.push(i);
                        break;
                }
            }

            // Remove zeros
            for (i = 0; i < distance.length; i++) {
                if (distance[i] === 0) { distance[i] = 999; }
            }

            // Determine nearest atom
            var nearest = distance.reduce(function (a, b) { return ( a < b ? a : b ); });
            return index[distance.indexOf(nearest)];
        }

        // Create new bond
        function getBond(source, target, value, atoms, bonds) {

            // Check bonds
            if (source !== undefined && target !== undefined) {

                var properties = [];

                // Bond name
                var name = atoms[source].name + atoms[target].name;

                // Bond atoms
                var edge = [atoms[source].id, atoms[target].id];

                // Bond properties
                switch (value) {
                    case 1: properties = { type: 'single', value: 1 }; break;
                    case 2: properties = { type: 'double', value: 2 }; break;
                    case 3: properties = { type: 'triple', value: 3 }; break;
                    case 4: properties = { type: 'quadruple', value: 4 }; break;
                }

                // Add bond
                bonds.push(new Bond(bonds.length, name, edge, properties));
            }
            return bonds;
        }

        function compareArrays(a, b) {
            var i = a.length;
            if (i !== b.length) { return false; }
            while (i--) { if (a[i] !== b[i]) { return false; }}
            return true;
        }

        function getValenceBySymbol(symbol) {
            for (var i = 0; i < valence.length; i++) { if (symbol === valence[i].symbol) { return valence[i].value; }}
        }

        function getIndexBySymbol (symbol, array) {
            for (var i = 0; i < array.length; i++) { if (symbol === array[i].symbol) { return i; }}
        }

        function getIndexByID (id, array) {
            for (var i = 0; i < array.length; i++) { if (id === array[i].id) { return i; }}
        }

        function getIDByRingIndex (symbol, array) {
            for (var i = 0; i < array.length; i++) { if (symbol.slice(1) === array[i].symbol.slice(1)) { return array[i].id; }}
        }

        return {

            tokenize: function (input) {

                var tokens = [];

                // Parse input
                for (var i = 0; i < definitions.length; i++) {

                    var match = new RegExp(definitions[i].expression, 'g'),
                        entry = [];

                    // Check for match
                    if (input.search(match) === -1) { continue; }

                    // Find all matches
                    while ((entry = match.exec(input)) !== null) {

                        // Add token
                        tokens.push({
                            id: entry.index,
                            category: definitions[i].category,
                            type: definitions[i].type,
                            symbol: entry[0]
                        });
                    }
                }

                // Sort tokens by index
                tokens.sort(function (a, b) {
                    if (a.id < b.id) { return -1; }
                    if (a.id > b.id) { return 1; }
                    return 0;
                });

                return tokens;
            },

            assemble: function (tokens) {

                var atoms = [], bonds = [], properties = [];
                var source = [], target = [], adjacent = [], value = [];
                var j = 0;

                // Parse tokens (atoms)
                for (var i = 0; i < tokens.length; i++) {

                    // Check for atom
                    if (tokens[i].category !== 'atom') {
                        continue;
                    }

                    // Check aromatic
                    if (tokens[i].type === 'aromatic') {
                        tokens[i].symbol = tokens[i].symbol.toUpperCase();
                    }

                    // Atom properties
                    properties = {
                        type: tokens[i].type,
                        charge: 0,
                        valence: getValenceBySymbol(tokens[i].symbol),
                        bonding: 0
                    };

                    // Add atom
                    atoms.push(new Atom( tokens[i].id, tokens[i].symbol, [], properties ));
                }

                // Parse tokens (non-atoms)
                for (i = 0; i < tokens.length; i++) {

                    // Check token category
                    switch (tokens[i].category) {

                        case 'bond':

                            // Find nearest atoms
                            source = nearestAtom(tokens[i].id, atoms, -1);
                            target = nearestAtom(tokens[i].id, atoms, 1);

                            // Bond value
                            switch (tokens[i].symbol) {
                                case '-': value = 1; break;
                                case '=': value = 2; break;
                                case '#': value = 3; break;
                                case '$': value = 4; break;
                            }

                            // Add bond
                            bonds = getBond(source, target, value, atoms, bonds);
                            break;

                        case 'branch':

                            // Check branch type
                            switch (tokens[i].type) {

                                case 'start':

                                    // Find nearest atoms
                                    source = nearestAtom(tokens[i].id, atoms, -1);
                                    target = nearestAtom(tokens[i].id, atoms, 1);
                                    break;

                                case 'end':

                                    // Find nearest atoms
                                    for (j = i; j > 0; j+=-1) {

                                        var skip = 0;

                                        // Find branch start
                                        if (tokens[j].type === 'start' && skip === 0) {
                                            source = nearestAtom(tokens[j].id, atoms, -1);
                                            break;
                                        }
                                        else if (tokens[j].type === 'start' && skip > 0) {
                                            skip += -1;
                                        }
                                        else if (tokens[j].type === 'end') {
                                            skip += 1;
                                        }
                                    }

                                    target = nearestAtom(tokens[i].id, atoms, 1);
                                    break;
                            }

                            // Add bond
                            bonds = getBond(source, target, 1, atoms, bonds);
                            break;

                        case 'ring':

                            // Ring junction
                            source = getIndexByID(tokens[i].id, atoms);
                            target = getIndexByID(getIDByRingIndex(tokens[i].symbol, tokens.slice(i+1)), atoms);

                            if (target === undefined) { continue; }

                            // Add bond
                            bonds = getBond(source, target, 1, atoms, bonds);

                            // Adjacent bonds (ring start - 1)
                            if (tokens[getIndexByID(tokens[i-1].id, tokens)].symbol !== ')') {
                                adjacent = nearestAtom(atoms[source].id, atoms, -1);
                                bonds = getBond(adjacent, source, 1, atoms, bonds);
                            }

                            // Adjacent bonds (ring start + 1)
                            if (tokens[getIndexByID(tokens[i+1].id, tokens)].symbol !== '(') {
                                adjacent = nearestAtom(atoms[source].id, atoms, 1);
                                bonds = getBond(source, adjacent, 1, atoms, bonds);
                            }

                            index = getIndexBySymbol(tokens[i].symbol, tokens.slice(i+1)) + i;

                            // Adjacent bonds (ring end - 1)
                            if (tokens[getIndexByID(tokens[index-1].id, tokens)].symbol !== ')') {
                                adjacent = nearestAtom(atoms[target].id, atoms, -1);
                                bonds = getBond(adjacent, target, 1, atoms, bonds);
                            }

                            // Adjacent bonds (ring end + 1)
                            if (tokens[getIndexByID(tokens[index+1].id, tokens)].symbol !== '(') {
                                adjacent = nearestAtom(atoms[target].id, atoms, 1);
                                bonds = getBond(target, adjacent, 1, atoms, bonds);
                            }

                            break;

                        case 'charge':

                            // Charge
                            var charge = tokens[i].symbol.slice(tokens[i].symbol.match(/[+-]|[0-9]/).index);

                            // Magnitude
                            var magnitude = charge.match(/[0-9]+/);

                            if (magnitude === null) { charge = charge.length; }
                            else { charge = Number(magnitude[0]); }

                            // Sign
                            if (tokens[i].type === 'negative') { charge = -charge; }

                            // Update properties
                            source = getIndexByID(tokens[i].id, atoms);
                            atoms[source].properties.charge = charge;
                            atoms[source].properties.valence += -charge;
                            break;
                    }
                }

                // Add implicit bonds
                for (i = 1; i < atoms.length; i++) {

                    // Find adjacent atoms
                    if (atoms[i].id - atoms[i-1].id === 1) {

                        // Add bond
                        bonds = getBond(i-1, i, 1, atoms, bonds);
                    }
                }

                // Remove duplicate bonds
                for (i = 0; i < bonds.length; i++) {

                    // Find duplicate bonds
                    for (j = 0; j < bonds.length; j++) {

                        if (i === j) { continue; }

                        if (compareArrays(bonds[i].atoms, bonds[j].atoms)) {

                            if (bonds[j].properties.value > bonds[i].properties.value) { bonds.splice(i,1); }
                            else { bonds.splice(j,1); }
                        }
                    }
                }

                // Add bonds to atoms
                for (i = 0; i < bonds.length; i++) {

                    var index = [];

                    index = getIndexByID(bonds[i].atoms[0], atoms);
                    atoms[index].bonds.push(bonds[i]);

                    index = getIndexByID(bonds[i].atoms[1], atoms);
                    atoms[index].bonds.push(bonds[i]);
                }

                // Determine available bonds
                for (i = 0; i < atoms.length; i++) {

                    // Determine total bonds
                    for (j = 0; j < atoms[i].bonds.length; j++) {

                        if (atoms[i].bonds[j].length === 0) { continue; }

                        // Update total bonds
                        atoms[i].properties.bonding += atoms[i].bonds[j].properties.value;
                    }
                }

                // Add implicit hydrogen
                var n = atoms.length;

                for (i = 0; i < n; i++) {

                    // Determine available bonds
                    var total = 8 - atoms[i].properties.valence;

                    // Account for charge
                    if (atoms[i].properties.charge > 0) {
                        total += -atoms[i].properties.charge;
                    }

                    // Add hydrogen
                    if (atoms[i].properties.bonding < total) {

                        // Total hydrogen
                        var hydrogen = total - atoms[i].properties.bonding;

                        for (j = 0; j < hydrogen; j++) {

                            // Atom properties
                            properties = {
                                type: 'hydrogen',
                                charge: 0,
                                valence: 1,
                                bonding: 1
                            };

                            // Add hydrogen
                            atoms.push(new Atom(-atoms.length, 'H', [], properties));

                            // Add bond
                            source = i;
                            target = atoms.length-1;
                            bonds = getBond(source, target, 1, atoms, bonds);

                            // Add bonds to atoms
                            atoms[atoms.length-1].bonds.push(bonds[bonds.length -1]);
                            atoms[i].bonds.push(bonds[bonds.length - 1]);

                            // Update total bonds
                            atoms[i].properties.bonding += 1;
                        }
                    }
                }

                // Remove empty bonds
                for (i = 0; i < atoms.length; i++) {

                    if (atoms[i].bonds.length > 1) {

                        // Check each atom
                        for (j=0; j < atoms[i].bonds.length; j++) {

                            // Check empty bond
                            if (atoms[i].bonds[j].length === 0) { atoms[i].bonds.splice(j, 1); }
                        }
                    }
                }

                // Determine molecular formula
                var formula = getFormula(atoms);

                // Add molecule
                return new Molecule(1, getName(formula), atoms, bonds, [formula]);
            }
        };
    }

    return {

        getInstance: function () {

            if (!instance) {
                instance = initialize();
            }
            return instance;
        }
    };
}));
