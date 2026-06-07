// Shared base-class stat row used on the Home class card and the Arena hero card.
// Renders the class identity stats (HP / ATK / Guard / Speed) from battle_classes.json.
// Pass gearBonuses (loadoutEffectiveStats) to show gear-adjusted totals instead of raw base values.

export default function ClassStatRow({ classInfo, showNote = true, style, gearBonuses = null }) {
  if (!classInfo) return null;

  const stats = classInfo.stats || {};
  const attack = classInfo.attack || {};
  const b = gearBonuses || {};

  const flatAtk = Number(b.attack_bonus || 0);
  const pctAtk = Number(b.bonus_attack_percent || 0);
  const flatHp = Number(b.hp_bonus || 0);

  const baseHp = stats.base_hp;
  const displayHp = baseHp != null ? baseHp + flatHp : null;
  const hpBoosted = flatHp !== 0;

  let displayAtk = null;
  let atkBoosted = false;
  if (attack.min != null && attack.max != null) {
    const adjMin = Math.round((attack.min + flatAtk) * (1 + pctAtk));
    const adjMax = Math.round((attack.max + flatAtk) * (1 + pctAtk));
    atkBoosted = adjMin !== attack.min || adjMax !== attack.max;
    displayAtk = `${adjMin}–${adjMax}`;
  }

  const pills = [
    { emoji: '❤️', label: 'HP', value: displayHp, boosted: hpBoosted },
    { emoji: '⚔️', label: 'ATK', value: displayAtk, boosted: atkBoosted },
    { emoji: '🛡️', label: 'GUARD', value: stats.guard_max, boosted: false },
    { emoji: '👟', label: 'SPEED', value: stats.move_speed, boosted: false },
  ].filter((s) => s.value != null && s.value !== '');

  if (pills.length === 0) return null;

  return (
    <div style={style}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {pills.map((s) => (
          <div
            key={s.label}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: s.boosted ? 'rgba(34,197,94,0.08)' : 'rgba(0,0,0,0.28)',
              border: s.boosted ? '1px solid rgba(34,197,94,0.22)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10, padding: '5px 9px',
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>{s.emoji}</span>
            <span style={{ color: s.boosted ? 'rgba(134,239,172,0.8)' : 'rgba(203,213,225,0.6)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</span>
            <span style={{ color: s.boosted ? '#86efac' : '#f8fafc', fontSize: 12, fontWeight: 850 }}>{s.value}</span>
          </div>
        ))}
      </div>
      {showNote && (
        <div style={{ color: 'rgba(148,163,184,0.55)', fontSize: 9.5, fontWeight: 600, marginTop: 8, letterSpacing: '0.02em' }}>
          Base class stats &middot; before weapon &amp; item bonuses
        </div>
      )}
    </div>
  );
}
