export const formatTokenAmount = (amount = 0) => Number(amount || 0).toLocaleString();

export const formatPlayerName = (player = {}) =>
  [player.first_name, player.last_name].filter(Boolean).join(' ') || player.username || 'Player';
