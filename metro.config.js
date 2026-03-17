// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Fix: React 19.1+ sets jsxDEV = void 0 in the production build of
// react/jsx-dev-runtime. Expo's static HTML rendering evaluates bundles
// in production mode, which loads that build and crashes with
// "_reactJsxDevRuntime.jsxDEV is not a function".
// Force the development build for this module so jsxDEV is always available.
const originalResolveRequest = config.resolver?.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react/jsx-dev-runtime") {
    return {
      filePath: require.resolve("./shims/react-jsx-dev-runtime.js"),
      type: "sourceFile",
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
