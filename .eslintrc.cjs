module.exports = {
  env: {
    es2022: true,
    node: true,
    browser: true
  },
  extends: ['eslint:recommended', 'prettier', 'plugin:jsdoc/recommended'],
  plugins: ['jsdoc'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    // Possible errors
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

    // Best practices
    curly: ['error', 'all'],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'prefer-const': 'error',
    'no-var': 'error',

    // ES6 / maintainability
    'no-duplicate-imports': 'error',
    'object-shorthand': 'error',
    'prefer-arrow-callback': 'error',
    'prefer-template': 'error',

    // Keep ESLint focused on code quality; Prettier owns formatting.
    'spaced-comment': 'error',

    // JSDoc — warn on missing docs so gaps surface without blocking builds
    'jsdoc/require-jsdoc': ['warn', {
      publicOnly: true,
      require: {
        FunctionDeclaration: true,
        ArrowFunctionExpression: false,
        ClassDeclaration: true,
        MethodDefinition: false
      }
    }],
    'jsdoc/require-param': 'warn',
    'jsdoc/require-returns': 'warn',
    'jsdoc/check-param-names': 'error',
    'jsdoc/check-tag-names': 'error',
    'jsdoc/no-undefined-types': 'off'
  },
  overrides: [
    {
      files: ['tests/**/*.js', '**/*.test.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      files: ['rollup.config.js'],
      env: {
        node: true
      }
    }
  ]
};
