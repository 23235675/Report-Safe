// Polyfill DOMException before anything else using require (not import, which hoists)
require('./polyfills.js');

const { registerRootComponent } = require('expo');
const { default: App } = require('./App');

registerRootComponent(App);