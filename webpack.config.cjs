const path = require('node:path');

module.exports = {
  target: ['web', 'es2020'],
  entry: {
    'CreativeWorkshop/index': path.resolve(__dirname, 'src/CreativeWorkshop/index.ts'),
    'CreativeWorkshop-staging/index': path.resolve(__dirname, 'src/CreativeWorkshop/staging.ts'),
  },
  output: {
    path: path.resolve(__dirname, 'test-dist'),
    filename: '[name].js',
    clean: false,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@util': path.resolve(__dirname, 'util'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          },
        },
      },
      {
        test: /\.html$/,
        type: 'asset/source',
      },
    ],
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: false,
    minimize: false,
  },
  devtool: 'source-map',
  performance: {
    hints: false,
  },
};
