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

        return {

            tokenize: function (input, encoding) {

                // Check input length
                if (input.length === 0 || input.length > 1000) {
                    return false;
                }

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

            assemble: function (tokens) {

                // Check for tokens
                if (tokens === undefined) {
                    return false;
                }


                return new Molecule(0, 0, atoms, bonds, []);
            }
        };
}));
