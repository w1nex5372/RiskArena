import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getClassBattleSkills } from '../../utils/battleSkills';

const SLOT_LABELS = {
  class: 'Class Skill',
  ability_2: 'Item Skill 2',
  item: 'Item Skill',
};

const SOURCE_LABELS = {
  class: 'Built-in',
  item: 'Equipped',
};

function SkillIcon({ skill }) {
  const [failed, setFailed] = useState(false);
  if (!skill?.image_path || failed) {
    return <Sparkles style={{ width: 20, height: 20, color: '#475569' }} />;
  }
  return (
    <img
      src={skill.image_path}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: '72%', height: '72%', objectFit: 'contain', imageRendering: 'pixelated' }}
    />
  );
}

export default function BattleSkillLoadout({
  className = 'warrior',
  equippedAbility = null,
  equippedAbility2 = null,
  onItemClick,
  onItem2Click,
  compact = false,
}) {
  const skills = getClassBattleSkills(className, equippedAbility, equippedAbility2);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: compact ? 5 : 8 }}>
      {skills.map((skill, index) => {
        const slotId = skill?.slot_id || (index === 0 ? 'class' : index === 1 ? 'ability_2' : 'item');
        const isItem = slotId === 'item' || slotId === 'ability_2';
        const itemClick = slotId === 'ability_2' ? onItem2Click : onItemClick;
        const isEmpty = !skill;
        return (
          <button
            key={slotId}
            type="button"
            disabled={!isItem || !itemClick}
            onClick={isItem && itemClick ? itemClick : undefined}
            style={{
              minWidth: 0,
              minHeight: compact ? 76 : 96,
              padding: compact ? '6px 5px' : '8px 7px',
              borderRadius: 8,
              border: isEmpty ? '1px dashed rgba(148,163,184,0.18)' : '1px solid rgba(201,168,76,0.22)',
              background: isEmpty ? 'rgba(255,255,255,0.02)' : 'linear-gradient(180deg, rgba(25,26,47,0.98), rgba(9,13,27,0.98))',
              color: 'inherit',
              cursor: isItem && itemClick ? 'pointer' : 'default',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              overflow: 'hidden',
            }}
          >
            <div style={{
              width: compact ? 34 : 44,
              height: compact ? 34 : 44,
              borderRadius: 8,
              border: isEmpty ? '1px dashed rgba(148,163,184,0.16)' : '1px solid rgba(201,168,76,0.18)',
              background: isEmpty ? 'rgba(255,255,255,0.02)' : 'radial-gradient(circle, rgba(201,168,76,0.14), rgba(8,12,24,0.92) 70%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <SkillIcon skill={skill} />
            </div>
            <span style={{
              width: '100%',
              color: isEmpty ? '#475569' : '#f1f5f9',
              fontSize: compact ? 8 : 9,
              fontWeight: 900,
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'center',
            }}>
              {skill?.name || 'Empty'}
            </span>
            <span style={{
              color: isEmpty ? '#334155' : isItem ? '#c9a84c' : '#60a5fa',
              fontSize: 7,
              fontWeight: 900,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'center',
            }}>
              {compact ? SLOT_LABELS[slotId].replace(' Skill', '') : SLOT_LABELS[slotId]} / {isEmpty ? 'Empty' : SOURCE_LABELS[skill.source]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
