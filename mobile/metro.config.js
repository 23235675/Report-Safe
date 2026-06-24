const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const getPolyfills = require('./polyfills.js');
const config = getDefaultConfig(__dirname);
const polyfillPath = path.resolve(__dirname, './polyfills.js');

// expo-sqlite's web worker imports wa-sqlite.wasm; metro must treat .wasm as an
// asset or web bundling fails with "Unable to resolve ./wa-sqlite/wa-sqlite.wasm".
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Append our DOMException polyfill AFTER React Native's own polyfills so it
// runs once RN has finished setting up the global environment, but still before
// any module code executes.
var originalGetPolyfills =
  config.serializer && typeof config.serializer.getPolyfills === 'function'
    ? config.serializer.getPolyfills.bind(config.serializer)
    : null;

config.serializer = Object.assign({}, config.serializer, {
  getPolyfills: function (options) {
    var existing = [];
    if (originalGetPolyfills) {
      try { existing = originalGetPolyfills(options) || []; } catch (e) { existing = []; }
    }
    return existing.concat([polyfillPath]);
  },
});

module.exports = config;
