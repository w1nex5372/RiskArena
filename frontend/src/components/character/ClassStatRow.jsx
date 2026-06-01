// Shared base-class stat row used on the Home class card and the Arena hero card.
// Renders the class identity stats (HP / ATK / Guard / Speed) from battle_classes.json.
// These are BASE values before weapon & item bonuses — combat is server-authoritative.

export default function ClassStatRow({ classInfo, showNote = true, style }) {
  if (!classInfo) return null;

  const stats = classInfo.stats || {};
  const attack = classInfo.attack || {};

  const pills = [
    { emoji: '❤️', label: 'HP', value: stats.base_hp },
    {
      emoji: '⚔️',
      label: 'ATK',
      value: (attack.min != null && attack.max != null) ? `${attack.min}–${attack.max}` : null,
    },
    { emoji: '🛡️', label: 'Guard', value: stats.guard_max },
    { emoji: '👟', label: 'Speed', value: stats.move_speed },
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
              background: 'rgba(0,0,0,0.28)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10, padding: '5px 9px',
            }}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>{s.emoji}</span>
            <span style={{ color: 'rgba(203,213,225,0.6)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</span>
            <span style={{ color: '#f8fafc', fontSize: 12, fontWeight: 850 }}>{s.value}</span>
          </div>
        ))}
      </div>
      {showNote && (
        <div style={{ color: 'rgba(148,163,184,0.55)', fontSize: 9.5, fontWeight: 600, marginTop: 8, letterSpacing: '0.02em' }}>
          Base class stats · before weapon &amp; item bonuses
        </div>
      )}
    </div>
  );
}
