module.exports = function(grunt) {

    grunt.initConfig({

        pkg: grunt.file.readJSON('package.json'),

        babel: {
            dist: {
                files: [{
                    expand: true,
                    flatten: false,
                    cwd: 'src/',
                    src: ['**/*.js'],
                    dest: 'dist/',
                    ext: '.js'
                }]
            },
            options: {
                modules: 'common'
            }
        },

        browserify: {
            dist: {
                src: 'dist/molecules.js',
                dest: 'dist/molecules.js',
                options: {
                    browserifyOptions: {
                        standalone: 'molecules'
                    }
                }
            }
        },

        uglify: {
            dist: {
                src: 'dist/molecules.js',
                dest: 'dist/molecules.min.js'
            },
            options: {
                mangle: true
            }
        }
    });

    grunt.loadNpmTasks('grunt-babel');
    grunt.loadNpmTasks('grunt-browserify');
    grunt.loadNpmTasks('grunt-contrib-uglify');

    grunt.registerTask('default', ['babel', 'browserify', 'uglify']);
};