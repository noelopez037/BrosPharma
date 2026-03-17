'use strict';
// Shim: forces the development JSX dev runtime regardless of NODE_ENV.
// Fixes React 19.1+ breaking Expo static rendering on web.
// Static require so Metro can resolve the dependency graph.
module.exports = require('../node_modules/react/cjs/react-jsx-dev-runtime.development.js');
