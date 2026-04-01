import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

const input = 'src/index.js';

const sharedPlugins = [resolve(), commonjs()];

export default [
  // ESM — for bundlers and Node ESM consumers
  {
    input,
    output: {
      file: 'es/index.js',
      format: 'es',
      sourcemap: true
    },
    plugins: sharedPlugins
  },

  // CJS — for require() consumers
  {
    input,
    output: {
      file: 'lib/index.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named'
    },
    plugins: sharedPlugins
  },

  // UMD unminified — CDN / script tag
  {
    input,
    output: {
      file: 'dist/molecules.umd.js',
      format: 'umd',
      name: 'Molecules',
      sourcemap: true
    },
    plugins: sharedPlugins
  },

  // UMD minified
  {
    input,
    output: {
      file: 'dist/molecules.umd.min.js',
      format: 'umd',
      name: 'Molecules',
      sourcemap: true
    },
    plugins: [...sharedPlugins, terser()]
  }
];
