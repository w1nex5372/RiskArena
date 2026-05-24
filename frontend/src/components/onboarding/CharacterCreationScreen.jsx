import React, { useEffect, useMemo, useState } from 'react';
import { Check, Eye, Shirt, Sparkles, Swords } from 'lucide-react';
import apiClient from '../../api/client';
import CharPreview from '../arena/CharPreview';
import { CLASS_INFO } from '../../utils/characters';

const CLASS_KEYS = ['warrior', 'rogue', 'mage'];

const WEAPON_BY_CLASS = {
  warrior: 'weapon.sword.katana',
  rogue: 'weapon.sword.scimitar',
  mage: 'weapon.staff.mage_staff',
};

const HAIR_OPTIONS = [
  { asset: 'hair.bedhead', label: 'Wild' },
  { asset: 'hair.bangslong', label: 'Duelist' },
  { asset: 'hair.xlong', label: 'Mystic' },
];

const HAIR_COLOR_OPTIONS = [
  { variant: 'raven', label: 'Raven', color: '#211a1f' },
  { variant: 'brown', label: 'Brown', color: '#7a4a27' },
  { variant: 'blonde', label: 'Blonde', color: '#d3a548' },
  { variant: 'red', label: 'Ember', color: '#b8451f' },
  { variant: 'white', label: 'Ash', color: '#d5d7cf' },
  { variant: 'blue', label: 'Arcane', color: '#3068be' },
];

const EYE_OPTIONS = [
  { variant: 'blue', label: 'Blue', color: '#60a5fa' },
  { variant: 'green', label: 'Green', color: '#4ade80' },
  { variant: 'gray', label: 'Gray', color: '#94a3b8' },
  { variant: 'purple', label: 'Violet', color: '#a78bfa' },
  { variant: 'yellow', label: 'Amber', color: '#facc15' },
  { variant: 'brown', label: 'Brown', color: '#b45309' },
];

const CLASS_PRESETS = {
  warrior: [
    {
      id: 'ares',
      label: 'Ares Guard',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'blue' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'black' },
        { slot: 'feet', asset: 'feet.boots.rimmed', variant: 'black' },
        { slot: 'torso', asset: 'torso.armour.plate', variant: null },
        { slot: 'hair', asset: 'hair.bedhead', variant: 'red' },
      ],
    },
    {
      id: 'iron',
      label: 'Iron Duelist',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'green' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'leather' },
        { slot: 'feet', asset: 'feet.boots.rimmed', variant: 'brown' },
        { slot: 'torso', asset: 'torso.armour.plate', variant: null },
        { slot: 'hair', asset: 'hair.bangslong', variant: 'brown' },
      ],
    },
    {
      id: 'vanguard',
      label: 'Black Vanguard',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'gray' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'black' },
        { slot: 'feet', asset: 'feet.boots.rimmed', variant: 'black' },
        { slot: 'torso', asset: 'torso.armour.plate', variant: null },
        { slot: 'hair', asset: 'hair.xlong', variant: 'raven' },
      ],
    },
    {
      id: 'mercenary',
      label: 'Leather Merc',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'brown' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'brown' },
        { slot: 'feet', asset: 'feet.boots.rimmed', variant: 'leather' },
        { slot: 'torso', asset: 'torso.armour.leather', variant: null },
        { slot: 'hair', asset: 'hair.bedhead', variant: 'blonde' },
      ],
    },
  ],
  rogue: [
    {
      id: 'hermes',
      label: 'Hermes Shade',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'gray' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'brown' },
        { slot: 'feet', asset: 'feet.boots.rimmed', variant: 'leather' },
        { slot: 'torso', asset: 'torso.armour.leather', variant: null },
        { slot: 'hair', asset: 'hair.bangslong', variant: 'brown' },
      ],
    },
    {
      id: 'night',
      label: 'Night Runner',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'purple' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'black' },
        { slot: 'feet', asset: 'feet.boots.rimmed', variant: 'black' },
        { slot: 'torso', asset: 'torso.armour.leather', variant: null },
        { slot: 'hair', asset: 'hair.bedhead', variant: 'raven' },
      ],
    },
    {
      id: 'knife',
      label: 'Black Knife',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'green' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'black' },
        { slot: 'feet', asset: 'feet.boots.rimmed', variant: 'leather' },
        { slot: 'torso', asset: 'torso.armour.leather', variant: null },
        { slot: 'hair', asset: 'hair.xlong', variant: 'white' },
      ],
    },
    {
      id: 'tracker',
      label: 'Dust Tracker',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'yellow' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'leather' },
        { slot: 'feet', asset: 'feet.boots.rimmed', variant: 'brown' },
        { slot: 'torso', asset: 'torso.armour.leather', variant: null },
        { slot: 'hair', asset: 'hair.bangslong', variant: 'red' },
      ],
    },
  ],
  mage: [
    {
      id: 'zeus',
      label: 'Zeus Adept',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'blue' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'navy' },
        { slot: 'feet', asset: 'feet.sandals', variant: 'leather' },
        { slot: 'torso', asset: 'torso.clothes.vest_open', variant: 'blue' },
        { slot: 'waist', asset: 'torso.waist.belt_robe', variant: 'teal' },
        { slot: 'hair', asset: 'hair.xlong', variant: 'blue' },
      ],
    },
    {
      id: 'storm',
      label: 'Storm Scholar',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'yellow' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'black' },
        { slot: 'feet', asset: 'feet.sandals', variant: 'leather' },
        { slot: 'torso', asset: 'torso.clothes.vest_open', variant: 'blue' },
        { slot: 'waist', asset: 'torso.waist.belt_robe', variant: 'teal' },
        { slot: 'hair', asset: 'hair.bedhead', variant: 'blonde' },
      ],
    },
    {
      id: 'ember',
      label: 'Ember Oracle',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'orange' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'black' },
        { slot: 'feet', asset: 'feet.sandals', variant: 'leather' },
        { slot: 'torso', asset: 'torso.clothes.vest_open', variant: 'blue' },
        { slot: 'waist', asset: 'torso.waist.belt_robe', variant: 'teal' },
        { slot: 'hair', asset: 'hair.xlong', variant: 'red' },
      ],
    },
    {
      id: 'void',
      label: 'Void Scholar',
      layers: [
        { slot: 'body', asset: 'body.male', variant: null },
        { slot: 'head', asset: 'head.human.male', variant: null },
        { slot: 'face', asset: 'face.male.neutral', variant: null },
        { slot: 'eyes', asset: 'eyes.human.neutral', variant: 'purple' },
        { slot: 'legs', asset: 'legs.pants2', variant: 'navy' },
        { slot: 'feet', asset: 'feet.sandals', variant: 'leather' },
        { slot: 'torso', asset: 'torso.clothes.vest_open', variant: 'blue' },
        { slot: 'waist', asset: 'torso.waist.belt_robe', variant: 'teal' },
        { slot: 'hair', asset: 'hair.bangslong', variant: 'raven' },
      ],
    },
  ],
};

function findLayer(preset, slot) {
  return preset.layers.find((layer) => layer.slot === slot) || null;
}

function buildCharacter(classKey, preset, appearance) {
  const layers = preset.layers
    .filter((layer) => layer.slot !== 'hair' && layer.slot !== 'eyes')
    .map((layer) => ({ ...layer }));
  layers.push(
    { slot: 'eyes', asset: 'eyes.human.neutral', variant: appearance.eyeVariant },
    { slot: 'hair', asset: appearance.hairAsset, variant: appearance.hairVariant },
  );
  return {
    schemaVersion: 'character_build.v1',
    className: classKey,
    bodyType: 'male',
    layers,
    weapon: { asset: WEAPON_BY_CLASS[classKey], enabled: false },
  };
}

export default function CharacterCreationScreen({ user, onComplete }) {
  const [isCompact, setIsCompact] = useState(() => window.innerWidth <= 640);
  const [classKey, setClassKey] = useState('warrior');
  const [presetId, setPresetId] = useState(CLASS_PRESETS.warrior[0].id);
  const [hairAsset, setHairAsset] = useState('hair.bedhead');
  const [hairVariant, setHairVariant] = useState('red');
  const [eyeVariant, setEyeVariant] = useState('blue');
  const [previewPath, setPreviewPath] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const presets = CLASS_PRESETS[classKey];
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === presetId) || presets[0],
    [presetId, presets],
  );
  const classInfo = CLASS_INFO[classKey];
  const characterBuild = useMemo(
    () => buildCharacter(classKey, selectedPreset, { hairAsset, hairVariant, eyeVariant }),
    [classKey, selectedPreset, hairAsset, hairVariant, eyeVariant],
  );

  useEffect(() => {
    const updateCompact = () => setIsCompact(window.innerWidth <= 640);
    updateCompact();
    window.addEventListener('resize', updateCompact);
    return () => window.removeEventListener('resize', updateCompact);
  }, []);

  const selectClass = (nextClass) => {
    const nextPreset = CLASS_PRESETS[nextClass][0];
    setClassKey(nextClass);
    setPresetId(nextPreset.id);
    setHairAsset(findLayer(nextPreset, 'hair')?.asset || 'hair.bedhead');
    setHairVariant(findLayer(nextPreset, 'hair')?.variant || 'brown');
    setEyeVariant(findLayer(nextPreset, 'eyes')?.variant || 'blue');
    setError('');
  };

  const selectPreset = (nextPreset) => {
    setPresetId(nextPreset.id);
    setHairAsset(findLayer(nextPreset, 'hair')?.asset || hairAsset);
    setHairVariant(findLayer(nextPreset, 'hair')?.variant || hairVariant);
    setEyeVariant(findLayer(nextPreset, 'eyes')?.variant || eyeVariant);
  };

  useEffect(() => {
    let alive = true;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await apiClient.post('/me/character-build/preview', {
          character_build: characterBuild,
        });
        if (alive) {
          setPreviewPath(response.data?.character_spritesheet_path || '');
        }
      } catch (_) {
        if (alive) setPreviewPath('');
      } finally {
        if (alive) setPreviewLoading(false);
      }
    }, 180);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [characterBuild]);

  const confirmCharacter = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await apiClient.post('/me/character-build', {
        character_build: characterBuild,
      });
      onComplete?.({
        class_name: response.data?.class_name || classKey,
        character_build_json: response.data?.character_build_json || characterBuild,
        character_spritesheet_path: response.data?.character_spritesheet_path || '',
        character_spritesheet_hash: response.data?.character_spritesheet_hash || '',
      });
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not create character.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #08080f 0%, #141323 54%, #090d18 100%)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: isCompact ? 10 : 18,
    }}>
      <div style={{ width: '100%', maxWidth: 960 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isCompact ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: isCompact ? 10 : 18,
          alignItems: 'stretch',
        }}>
          <section style={{
            order: isCompact ? 2 : 1,
            border: '1px solid rgba(201,168,76,0.22)',
            background: 'linear-gradient(180deg, rgba(26,24,42,0.96), rgba(15,17,32,0.98))',
            borderRadius: 8,
            padding: isCompact ? 12 : 18,
            minWidth: 0,
          }}>
            <div style={{ color: '#c9a84c', fontSize: 12, fontWeight: 900, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>
              Character Creation
            </div>
            <h1 style={{ margin: 0, fontSize: isCompact ? 25 : 30, lineHeight: 1.08, fontWeight: 900 }}>
              Choose your fighter
            </h1>
            <div style={{
              marginTop: isCompact ? 12 : 18,
              display: 'grid',
              gridTemplateColumns: isCompact ? 'repeat(3, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(128px, 1fr))',
              gap: isCompact ? 7 : 10,
            }}>
              {CLASS_KEYS.map((key) => {
                const info = CLASS_INFO[key];
                const active = key === classKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectClass(key)}
                    style={{
                      border: `1px solid ${active ? info.color : 'rgba(255,255,255,0.10)'}`,
                      background: active ? `linear-gradient(180deg, ${info.glow}, rgba(20,20,34,0.95))` : 'rgba(255,255,255,0.045)',
                      color: '#fff',
                      borderRadius: 8,
                      padding: isCompact ? 8 : 10,
                      cursor: 'pointer',
                      textAlign: 'left',
                      minHeight: isCompact ? 82 : 106,
                      boxShadow: active ? `0 0 22px ${info.glow}` : 'none',
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Swords size={isCompact ? 15 : 18} color={active ? '#f4d35e' : 'rgba(255,255,255,0.56)'} />
                      {active ? <Check size={isCompact ? 15 : 18} color="#39e878" /> : null}
                    </div>
                    <div style={{ marginTop: isCompact ? 7 : 10, fontSize: isCompact ? 15 : 19, fontWeight: 900 }}>{info.name}</div>
                    <div style={{ marginTop: 3, fontSize: isCompact ? 10 : 12, color: '#c9a84c', fontWeight: 800, lineHeight: 1.15 }}>{info.title}</div>
                    <div style={{ marginTop: isCompact ? 4 : 6, fontSize: isCompact ? 10 : 12, color: 'rgba(255,255,255,0.68)', lineHeight: 1.15 }}>{info.bonus}</div>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: isCompact ? 14 : 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c9a84c', fontSize: 12, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase' }}>
                <Shirt size={15} /> Outfit Preset
              </div>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: isCompact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                {presets.map((preset) => {
                  const active = preset.id === selectedPreset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => selectPreset(preset)}
                      style={{
                        border: `1px solid ${active ? '#c9a84c' : 'rgba(255,255,255,0.10)'}`,
                        background: active ? 'rgba(201,168,76,0.14)' : 'rgba(255,255,255,0.04)',
                        color: '#fff',
                        borderRadius: 8,
                        padding: isCompact ? '10px 9px' : 12,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <Eye size={16} color={active ? '#f4d35e' : 'rgba(255,255,255,0.55)'} />
                      <span style={{ fontWeight: 800, fontSize: isCompact ? 13 : 16 }}>{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: isCompact ? 14 : 18 }}>
              <div style={{ color: '#c9a84c', fontSize: 12, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase' }}>
                Hair Style
              </div>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 10 }}>
                {HAIR_OPTIONS.map((option) => {
                  const active = option.asset === hairAsset;
                  return (
                    <button
                      key={option.asset}
                      type="button"
                      onClick={() => setHairAsset(option.asset)}
                      style={{
                        border: `1px solid ${active ? '#c9a84c' : 'rgba(255,255,255,0.10)'}`,
                        background: active ? 'rgba(201,168,76,0.14)' : 'rgba(255,255,255,0.04)',
                        color: active ? '#f4d35e' : '#fff',
                        borderRadius: 8,
                        padding: '10px 12px',
                        cursor: 'pointer',
                        fontWeight: 850,
                        textAlign: 'center',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: isCompact ? 14 : 18 }}>
              <div style={{ color: '#c9a84c', fontSize: 12, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase' }}>
                Hair Color
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {HAIR_COLOR_OPTIONS.map((option) => {
                  const active = option.variant === hairVariant;
                  return (
                    <button
                      key={option.variant}
                      type="button"
                      onClick={() => setHairVariant(option.variant)}
                      aria-label={option.label}
                      title={option.label}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 999,
                        border: `2px solid ${active ? '#f4d35e' : 'rgba(255,255,255,0.12)'}`,
                        background: option.color,
                        boxShadow: active ? `0 0 14px ${option.color}` : 'none',
                        cursor: 'pointer',
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: isCompact ? 14 : 18 }}>
              <div style={{ color: '#c9a84c', fontSize: 12, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase' }}>
                Eye Color
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {EYE_OPTIONS.map((option) => {
                  const active = option.variant === eyeVariant;
                  return (
                    <button
                      key={option.variant}
                      type="button"
                      onClick={() => setEyeVariant(option.variant)}
                      aria-label={option.label}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 999,
                        border: `2px solid ${active ? '#f4d35e' : 'rgba(255,255,255,0.12)'}`,
                        background: option.color,
                        boxShadow: active ? `0 0 14px ${option.color}` : 'none',
                        cursor: 'pointer',
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {error ? (
              <div style={{ marginTop: 14, color: '#ff6666', fontSize: 13, fontWeight: 700 }}>
                {error}
              </div>
            ) : null}
          </section>

          <aside style={{
            order: isCompact ? 1 : 2,
            border: '1px solid rgba(255,255,255,0.10)',
            background: `radial-gradient(circle at 50% 30%, ${classInfo.glow}, rgba(12,14,27,0.98) 58%)`,
            borderRadius: 8,
            padding: isCompact ? 12 : 18,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: isCompact ? 318 : 420,
          }}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  width: isCompact ? 156 : 184,
                  height: isCompact ? 156 : 184,
                  borderRadius: 18,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: `radial-gradient(circle at 50% 48%, ${classInfo.glow}, rgba(8,12,24,0.96) 68%)`,
                  boxShadow: '0 10px 28px rgba(0,0,0,0.38)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: previewLoading ? 0.72 : 1,
                  transition: 'opacity 0.16s ease',
                }}
              >
                <CharPreview cls={classKey} sheetPath={previewPath} size={isCompact ? 146 : 166} fitToContent />
              </div>
            </div>
            <div style={{ marginTop: isCompact ? 10 : 18, textAlign: 'center' }}>
              {!isCompact ? <CharPreview cls={classKey} sheetPath={previewPath} size={132} fitToContent /> : null}
              <div style={{ marginTop: isCompact ? 0 : 10, fontSize: isCompact ? 21 : 24, fontWeight: 900 }}>{classInfo.name}</div>
              <div style={{ color: '#c9a84c', fontWeight: 800, marginTop: 4 }}>{selectedPreset.label}</div>
              <div style={{ marginTop: 10, color: 'rgba(255,255,255,0.68)', fontSize: 13 }}>
                {user?.first_name || 'Fighter'}
              </div>
            </div>
            <button
              type="button"
              onClick={confirmCharacter}
              disabled={saving}
              style={{
                width: '100%',
                marginTop: 22,
                border: '1px solid rgba(201,168,76,0.56)',
                background: saving ? 'rgba(201,168,76,0.20)' : 'linear-gradient(180deg, #c9a84c, #9f7425)',
                color: saving ? 'rgba(255,255,255,0.62)' : '#130d08',
                borderRadius: 8,
                padding: '14px 16px',
                fontSize: 15,
                fontWeight: 900,
                cursor: saving ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Sparkles size={18} />
              {saving ? 'Creating...' : 'Enter RiskArena'}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
