//
// molecules.js (v0.1.0)
//

/* TODO v0.1.0
*   -Parse SMILES (COMPLETE)
*   -Parse Tokens (COMPLETE)
*   -Graph Topology (IN PROGRESS)
*   -Force Layout
*   -Atom Properties
*   -CSS Properties
*   -UMD Module (COMPLETE)
*/

(function (root, factory) {

    if (typeof define === 'function' && define.amd) {

        // AMD
        define(['./grammar/smiles'], factory);

    } else if (typeof exports === 'object') {

        // Node
        module.exports = factory(require('./grammar/smiles'));

    } else {

        // Global
        root.exports = factory(root.smiles);
    }

}(this, function (smiles) {

        'use strict';

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

        // Utility
        function nearestAtom(id, atoms, direction) {

            // Variables
            var distance = [],
                index = [];

            for (var i = 0; i < atoms.length; i++) {

                // Direction to search
                switch (direction) {

                    case 'left':

                        if (id < atoms[i].id) { continue; }

                        distance.push(id - atoms[i].id);
                        index.push(i);
                        break;

                    case 'right':

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

        function getIndex(id, array) {
            for (var i = 0; i < array.length; i++) {
                if (id === array[i].id) { return i; }
            }
        }

        return {

            tokenize: function (input, encoding) {

                // Check input length
                if (input.length === 0 || input.length > 1000) {
                    return false;
                }

                // Variables
                var grammar, tokens;

                // Check input encoding
                switch (encoding) {

                    case 'SMILES':
                        grammar = smiles.getInstance();
                        break;

                    default:
                        grammar = smiles.getInstance();
                }

                // Parse input
                tokens = grammar.tokenize(input);

                return tokens;
            },

            parse: function (tokens) {

                // Check for tokens
                if ( tokens === undefined ) {
                    return false;
                }

                // Parse tokens (atoms)
                var atoms = [],
                    bonds = [],
                    index = [];

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

                    var j = index[i];

                    // Check category
                    switch (tokens[j].category) {

                        case 'bond':

                            // Find nearest atoms
                            var source = nearestAtom(tokens[j].id, atoms, 'left'),
                                target = nearestAtom(tokens[j].id, atoms, 'right'),
                                edge = [atoms[source].id, atoms[target].id];

                            // Add bond
                            bonds.push(new Bond(tokens[j].id, tokens[j].symbol, edge, {type: tokens[j].type}));
                            break;
                    }
                }


                return new Molecule(0, 0, atoms, bonds, []);
            },

            topology: function (tokens, atoms) {}
        };
}));
