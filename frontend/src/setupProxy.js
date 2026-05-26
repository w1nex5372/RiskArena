const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const backendTarget = process.env.REACT_APP_DEV_BACKEND_URL || 'http://localhost:8001';

  app.use(
    createProxyMiddleware('/api', {
      target: backendTarget,
      changeOrigin: true,
    })
  );

  app.use(
    createProxyMiddleware('/generated', {
      target: backendTarget,
      changeOrigin: true,
    })
  );
};
