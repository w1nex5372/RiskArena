// Load configuration from environment or config file
const path = require('path');

// Environment variable overrides
const config = {
  disableHotReload: process.env.DISABLE_HOT_RELOAD === 'true',
};

module.exports = {
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {
      
      // Disable hot reload completely if environment variable is set
      if (config.disableHotReload) {
        // Remove hot reload related plugins
        webpackConfig.plugins = webpackConfig.plugins.filter(plugin => {
          return !(plugin.constructor.name === 'HotModuleReplacementPlugin');
        });
        
        // Disable watch mode
        webpackConfig.watch = false;
        webpackConfig.watchOptions = {
          ignored: /.*/, // Ignore all files
        };
      } else {
        // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
          ],
        };
      }
      
      // Phaser 3 webpack 5 compatibility: stub unused Node built-ins
      webpackConfig.resolve = webpackConfig.resolve || {};
      webpackConfig.resolve.fallback = {
        ...(webpackConfig.resolve.fallback || {}),
        fs: false,
        path: false,
        crypto: false,
      };

      // Strip console.log/debug/info from production bundles. Dev logging stays
      // intact, but this removes ~190 console calls (mostly App.jsx) that would
      // otherwise run on every render/socket/poll in the Telegram WebView —
      // pure overhead in prod. console.error/warn are kept for real diagnostics.
      if (webpackConfig.mode === 'production') {
        const minimizers = (webpackConfig.optimization && webpackConfig.optimization.minimizer) || [];
        minimizers.forEach((plugin) => {
          if (plugin && plugin.constructor && plugin.constructor.name === 'TerserPlugin') {
            // react-scripts stores the real terser config at plugin.options.minimizer.options
            // (not plugin.options.terserOptions). Mutate the compress block there.
            const terserOptions =
              (plugin.options && plugin.options.minimizer && plugin.options.minimizer.options) || null;
            if (terserOptions) {
              const compress = terserOptions.compress && typeof terserOptions.compress === 'object'
                ? terserOptions.compress
                : {};
              // pure_funcs is honored across terser versions. console.log/info/debug
              // calls have unused return values, so terser drops them in prod.
              // console.error/warn are kept for real diagnostics.
              terserOptions.compress = {
                ...compress,
                pure_funcs: [
                  ...(Array.isArray(compress.pure_funcs) ? compress.pure_funcs : []),
                  'console.log',
                  'console.info',
                  'console.debug',
                ],
              };
            }
          }
        });
      }

      return webpackConfig;
    },
  },
};
