import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const input = 'src/index.js';
const modules = ['core', 'algorithms', 'matrices', 'descriptors', 'data', 'io', 'layout', 'smarts', 'smirks', 'utils', 'validation'];

const sharedPlugins = [resolve()];

export default [
  // All package entry points share one module tree and the same class instances.
  {
    input: [input, ...modules.map(name => `src/${name}/index.js`)],
    output: {
      dir: 'es',
      format: 'es',
      preserveModules: true,
      preserveModulesRoot: 'src',
      sourcemap: true
    },
    plugins: sharedPlugins
  },

  // ESM unminified — browser module scripts
  {
    input,
    output: {
      file: 'dist/molecules.js',
      format: 'es',
      sourcemap: true
    },
    plugins: sharedPlugins
  },

  // ESM minified
  {
    input,
    output: {
      file: 'dist/molecules.min.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [...sharedPlugins, terser()]
  }
];
