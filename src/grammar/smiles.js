//
// smiles.js
// -parse SMILES chemical line notation
//

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

        // Find nearest atoms
        function nearestAtom (id, atoms, direction) {

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

            // Determine atom location
            var nearest = distance.reduce(function (a, b) { return ( a < b ? a : b ); });

            // Return index
            return index[distance.indexOf(nearest)];
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
                    while (entry = match.exec(input)) {

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
                var source = [], target = [], edge = [];

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
                        valence: getValenceBySymbol(tokens[i].symbol)
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
                            edge = [atoms[source].id, atoms[target].id];

                            // Bond properties
                            switch (tokens[i].symbol) {
                                case '-': properties = { type: tokens[i].type, value: 1 }; break;
                                case '=': properties = { type: tokens[i].type, value: 2 }; break;
                                case '#': properties = { type: tokens[i].type, value: 3 }; break;
                                case '$': properties = { type: tokens[i].type, value: 4 }; break;
                            }

                            // Add bond
                            bonds.push(new Bond(bonds.length, tokens[i].symbol, edge, properties));
                            break;

                        case 'branch':

                            // Check branch type
                            switch (tokens[i].type) {

                                case 'start':

                                    // Find nearest atoms
                                    source = nearestAtom(tokens[i].id, atoms, -1);
                                    target = nearestAtom(tokens[i].id, atoms, 1);
                                    edge = [atoms[source].id, atoms[target].id];
                                    break;

                                case 'end':

                                    // Find nearest atoms
                                    for (var k = i; i > 0; k+=-1) {

                                        var skip = 0;

                                        // Find branch start
                                        if (tokens[k].type === 'start' && skip === 0) {
                                            source = nearestAtom(tokens[k].id, atoms, -1);
                                            break;
                                        }
                                        else if (tokens[k].type === 'start' && skip > 0) {
                                            skip += -1;
                                        }
                                        else if (tokens[k].type === 'end') {
                                            skip += 1;
                                        }
                                    }

                                    target = nearestAtom(tokens[i].id, atoms, 1);
                                    edge = [atoms[source].id, atoms[target].id];
                                    break;
                            }

                            // Bond properties
                            properties = { type: 'single', value: 1 };

                            // Add bond
                            bonds.push(new Bond(bonds.length, tokens[i].symbol, edge, properties));
                            break;

                        case 'ring':

                            if (i+1 > tokens.length) { continue; }

                            // Find ring start
                            source = getIndexByID(tokens[i].id, atoms);

                            // Find ring end
                            target = getIndexByID(getIDByRingIndex(tokens[i].symbol, tokens.slice(i+1)), atoms);

                            if (target === undefined) { continue; }

                            edge = [atoms[source].id, atoms[target].id];

                            // Bond properties
                            properties = { type: 'single', value: 1 };

                            // Add bond
                            bonds.push(new Bond(bonds.length, tokens[i].symbol, edge, properties));
                            break;

                        case 'charge':

                            var symbol = tokens[i].symbol;

                            // Charge
                            var charge = symbol.slice(symbol.match(/[+-]|[0-9]/).index);

                            // Magnitude
                            var magnitude = charge.match(/[0-9]+/);

                            if (magnitude === null) { charge = charge.length; }
                            else { charge = Number(magnitude[0]); }

                            // Sign
                            if (tokens[i].type === 'negative') { charge = -charge; }

                            // Update charge
                            source = getIndexByID(tokens[i].id, atoms);
                            atoms[source].properties.charge = charge;
                            break;
                    }
                }

                // Add implicit bonds
                for (i = 1; i < atoms.length; i++) {

                    if (atoms[i].id - atoms[i-1].id === 1) {

                        // Bond properties
                        properties = { type: 'single', value: 1 };

                        // Add bond
                        edge = [atoms[i-1].id, atoms[i].id];
                        bonds.push(new Bond(bonds.length, '-', edge, properties));
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

                // Add molecule
                return new Molecule(1, '1', atoms, bonds, []);
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
