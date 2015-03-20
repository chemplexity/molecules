//
// smiles.js
// -tokenize SMILES chemical line notation
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
            {category: 'atom',    type: 'aliphatic',     symbol: 'B',  expression: 'B(?=[^eraihk])'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'C',  expression: 'C(?=[^larou])'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'N',  expression: 'N(?=[^aei])'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'O',  expression: 'O'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'F',  expression: 'F'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'P',  expression: 'P'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'S',  expression: 'S(?=[^ei])'},
            {category: 'atom',    type: 'aliphatic',     symbol: 'I',  expression: 'I'},
            {category: 'atom',    type: 'aromatic',      symbol: 'B',  expression: 'b'},
            {category: 'atom',    type: 'aromatic',      symbol: 'C',  expression: 'c'},
            {category: 'atom',    type: 'aromatic',      symbol: 'N',  expression: 'n'},
            {category: 'atom',    type: 'aromatic',      symbol: 'O',  expression: 'o'},
            {category: 'atom',    type: 'aromatic',      symbol: 'P',  expression: 'p'},
            {category: 'atom',    type: 'aromatic',      symbol: 'S',  expression: 's(?=[^ei])'},
            {category: 'bond',    type: 'single',        symbol: '-',  expression: '[-]'},
            {category: 'bond',    type: 'double',        symbol: '=',  expression: '[=]'},
            {category: 'bond',    type: 'triple',        symbol: '#',  expression: '[#]'},
            {category: 'bond',    type: 'quadrupole',    symbol: '$',  expression: '[$]'},
            {category: 'branch',  type: 'start',         symbol: '(',  expression: '[(]'},
            {category: 'branch',  type: 'end',           symbol: ')',  expression: '[)]'},
            {category: 'chiral',  type: 'anticlockwise', symbol: '@',  expression: '[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])'},
            {category: 'chiral',  type: 'clockwise',     symbol: '@@', expression: '[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)'},
            {category: 'ring',    type: 'index',         symbol: '%',  expression: '(?:[A-Z]?[a-z]?)[%]?\\d+(?=([^+-]|$))'},
            {category: 'charge',  type: 'positive',      symbol: '+',  expression: '[a-zA-Z]{1,2}[0-9]?[+]+[0-9]?(?=[\\]])'},
            {category: 'charge',  type: 'negative',      symbol: '-',  expression: '[a-zA-Z]{1,2}[0-9]?[-]+[0-9]?(?=[\\]])'},
            {category: 'isotope', type: 'neutrons',      symbol: 'n',  expression: '[0-9]+[A-Z]{1,2}(?=.?[^\\[]*[\\]])'},
            {category: 'other',   type: 'wildcard',      symbol: '*',  expression: '[*]'},
            {category: 'other',   type: 'disconnect',    symbol: '.',  expression: '[A-Z][+-]?[\\[]?[.]'}
        ];

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

        // Utility
        function nearestAtom (id, atoms, direction) {

            var distance = [], index = [];

            for (var i = 0; i < atoms.length; i++) {

                // Direction to search
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

            // Determine nearest atom
            var nearest = distance.reduce(function (a, b) { return ( a < b ? a : b ); });

            return index[distance.indexOf(nearest)];
        }

        function getIndexByID (id, array) {
            for (var i = 0; i < array.length; i++) { if (id === array[i].id) { return i; }}
        }

        function getIndexByType (array) {
            for (var i = 0; i < array.length; i++) { if (type === array[i].type) { return i; }}
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

                var atoms = [], bonds = [], index = [];

                // Parse tokens (atoms)
                for (var i = 0; i < tokens.length; i++) {

                    // Check for atom
                    if (tokens[i].category !== 'atom') {
                        index.push(i);
                        continue;
                    }

                    // Check aromatic
                    if (tokens[i].type === 'aromatic') {
                        tokens[i].symbol = tokens[i].symbol.toUpperCase();
                    }

                    // Add atom
                    atoms.push(new Atom( tokens[i].id, tokens[i].symbol, [], { type: tokens[i].type } ));
                }

                // Parse tokens (non-atoms)
                for (i = 0; i < index.length; i++) {

                    var j = index[i],
                        source = [],
                        target = [];
                        edge = [];

                    // Check category
                    switch (tokens[j].category) {

                        case 'bond':

                            // Find nearest atoms
                            source = nearestAtom(tokens[j].id, atoms, -1);
                            target = nearestAtom(tokens[j].id, atoms, 1);
                            edge = [atoms[source].id, atoms[target].id];

                            // Add bond
                            bonds.push(new Bond(tokens[j].id, tokens[j].symbol, edge, {type: tokens[j].type}));
                            break;

                        case 'branch':

                            // Check branch type
                            switch (tokens[i].type) {

                                case 'start':

                                    // Find nearest atoms
                                    source = nearestAtom(tokens[j].id, atoms, -1);
                                    target = nearestAtom(tokens[j].id, atoms, 1);
                                    edge = [atoms[source].id, atoms[target].id];
                                    break;

                                case 'end':

                                    // Find starting location2


                            }

                            // Add bond
                            bonds.push(new Bond(tokens[j].id, tokens[j].symbol, edge, {type: tokens[j].type}));
                    }
                }


            }
        };
    }

    return {

        getInstance: function () {

            if (!instance) { instance = initialize(); }
            return instance;
        }
    };
}));
