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

        return {

            tokenize: function (input, encoding) {

                // Check input length
                if (input.length === 0 || input.length > 10000) { return false; }

                // Check input encoding
                switch (encoding) {

                    case 'SMILES':
                        this.grammar = smiles.getInstance();
                        break;

                    default:
                        this.grammar = smiles.getInstance();
                }

                // Parse input
                return this.grammar.tokenize(input);
            },

            assemble: function (tokens) {

                // Check for tokens
                if (tokens === undefined) { return false; }

               return this.grammar.assemble(tokens);
            }
        };
}));
