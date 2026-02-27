module.exports = function (api) {
  // Cache based on build env so dev/prod bundles don't reuse transforms.
  api.cache.using(() => process.env.BABEL_ENV || process.env.NODE_ENV);
  return {
    presets: ["babel-preset-expo"],
    // Keep Reanimated plugin last.
    plugins: ["react-native-reanimated/plugin"],
  };
};
