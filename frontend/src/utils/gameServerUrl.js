export function resolveGameServerUrl() {
  const configured = process.env.REACT_APP_GAME_SERVER_URL;
  if (configured) return configured;

  const override = new URLSearchParams(window.location.search).get('gameServerUrl');
  if (override) return override;

  // Always use the /colyseus proxy path — setupProxy.js forwards it to :2567 in dev,
  // and the production reverse proxy handles it the same way. This keeps localhost and
  // TG/production on the same code path so both can be tested identically.
  return `${window.location.origin}/colyseus`;
}
