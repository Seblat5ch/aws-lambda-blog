const path = require('path')
const fs = require('fs')
const webpack = require('webpack')
const DotEnvEmitter = require('./dotenv-emitter')
const cli = require('cli')
const UglifyJSPlugin = require('uglifyjs-webpack-plugin');
var ProgressBarPlugin = require('progress-bar-webpack-plugin');

cli.enable('help', 'version')
cli.parse({
  stage: [ 's', 'stage of environment, <dev|staging|prod>', 'string', 'local'],
  region: [ 'r', 'region of deployment', 'string', 'ap-northeast-1' ]
})

const stage = cli.options.stage
if (stage == null) {
  console.error('please provide a stage with -s <stage> or --stage <stage>.')
  process.exit(1)
}

function getFiles(srcpath) {
    return fs.readdirSync(srcpath).filter(function(file) {
        return !fs.statSync(path.join(srcpath, file)).isDirectory();
    });
}

function getEntries(){
    let entries = {};
    var public_files = getFiles(path.join(__dirname, "./lambdas/src/public"))
        .forEach(filename => {
            entries[filename] = path.join(
                path.join(__dirname, "./lambdas/src/public"),
                filename
            );
        })

    var admin_files = getFiles(path.join(__dirname, "./lambdas/src/admin"))
        .forEach(filename => {
            entries[filename] = path.join(
                path.join(__dirname, "./lambdas/src/admin"),
                filename
            );
        })

    return entries;
}

var entries = getEntries();
console.log(entries);

module.exports = {
  entry: entries,
  target: 'node',
  module: {
    loaders: [
      {
        test: /\.json$/, loader: 'json'
      },
      {
        test: /\.js$/,
        loaders: [ 'babel' ],
        exclude: /node_modules/,
      }
    ]
  },
  output: {
      libraryTarget: 'commonjs',
      path: 'build',
      filename: '[name]'
  },
  externals: [
    'aws-sdk'
  ],
  plugins: [
    new ProgressBarPlugin({
      format: '  build [:bar] ' + (':percent') + ' (:elapsed seconds)',
      clear: false
    }),
    new webpack.optimize.DedupePlugin(),
    new UglifyJSPlugin({
      test: /\.js($|\?)/i,
      sourceMap: true,
      uglifyOptions: {
          compress: true,
          keep_classnames: true,
          keep_fnames: true
      }
    })
  ]
}
