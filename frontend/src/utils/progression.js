export const RAID_UNLOCK_LEVEL = 5;

export function getUserLevel(user) {
  const level = Number(user?.level || 1);
  return Number.isFinite(level) && level > 0 ? level : 1;
}

export function isRaidUnlocked(user) {
  return getUserLevel(user) >= RAID_UNLOCK_LEVEL;
}
