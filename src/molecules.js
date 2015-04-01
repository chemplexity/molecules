//
// molecules.js (v0.1.0)
//

/* TODO v0.1.0
*   -Parse SMILES (COMPLETE)
*   -Assemble Tokens (COMPLETE)
*   -D3 Force Layout (In Progress)
*   -Atom Properties
*   -CSS Properties
*   -UMD Module (COMPLETE)
*/

(function (root, factory) {

    if (typeof define === 'function' && define.amd) {
        // AMD
        define(['./encoding/smiles'], factory);

    } else if (typeof exports === 'object') {
        // Node
        module.exports = factory(require('./encoding/smiles'));

    } else {
        // Global
        root.exports = factory(root.smiles);
    }
}(this, function (smiles) {

    'use strict';

    return {

        // Tokenize input
        tokenize: function (input, encoding) {

            if (input.length === 0 || input.length > 10000) {
                return false;
            }

            // Check encoding type
            switch (encoding) {

                case 'SMILES':
                    this.grammar = smiles.getInstance();
                    break;

                default:
                    this.grammar = smiles.getInstance();
            }

            // Return tokens
            return this.grammar.tokenize(input);
        },

        // Assemble tokens
        assemble: function (tokens) {

            if (tokens === undefined) {
                return false;
            }

            // Return molecule
            return this.grammar.assemble(tokens);
        }
    };
}));