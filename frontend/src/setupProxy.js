const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const backendTarget = process.env.REACT_APP_DEV_BACKEND_URL || 'http://localhost:8001';
  const gameServerTarget = process.env.REACT_APP_DEV_GAMESERVER_URL || 'http://localhost:2567';

  // Swallow abrupt client/socket disconnects (ECONNRESET on proxied WebSockets from
  // tunnels, mobile, or closed tabs) so they don't bubble up as an unhandled 'error'
  // event and crash the whole dev server.
  const onError = (err, req, res) => {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      try { res.writeHead(502); res.end('proxy error'); } catch (_) {}
    } else if (res && typeof res.destroy === 'function') {
      try { res.destroy(); } catch (_) {}
    }
  };

  app.use(
    createProxyMiddleware('/api', {
      target: backendTarget,
      changeOrigin: true,
      ws: true, // backend Socket.IO lives under /api/socket.io — proxy its WS upgrade too
      onError,
    })
  );

  app.use(
    createProxyMiddleware('/generated', {
      target: backendTarget,
      changeOrigin: true,
      onError,
    })
  );

  // Colyseus gameserver (HTTP matchmaking + WebSocket rooms). Proxied so the whole app
  // works through a single origin (e.g. a Cloudflare tunnel → localhost:3000) — the
  // client connects to `<origin>/colyseus`, which is forwarded here to the gameserver
  // with the `/colyseus` prefix stripped. `ws: true` is required for the room sockets.
  app.use(
    createProxyMiddleware('/colyseus', {
      target: gameServerTarget,
      changeOrigin: true,
      ws: true,
      pathRewrite: { '^/colyseus': '' },
      onError,
    })
  );
};
