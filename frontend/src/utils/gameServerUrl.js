export function resolveGameServerUrl() {
  const configured = process.env.REACT_APP_GAME_SERVER_URL;
  if (configured) return configured;

  const override = new URLSearchParams(window.location.search).get('gameServerUrl');
  if (override) return override;

  const { hostname, protocol, origin } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:2567`;
  }

  return `${origin}/colyseus`;
}
