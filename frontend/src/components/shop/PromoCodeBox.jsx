import React, { useState } from 'react';
import axios from 'axios';

function PromoCodeBox({ API, user, onTokensAdded }) {
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const redeem = async () => {
    if (!code.trim() || !user?.telegram_id) return;
    setLoading(true);
    try {
      const r = await axios.post(`${API}/use-promo?code=${encodeURIComponent(code.trim().toUpperCase())}&telegram_id=${user.telegram_id}`);
      toast.success(`🎉 +${r.data.tokens} tokens added!`);
      onTokensAdded(r.data.tokens);
      setCode('');
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(detail === 'ALREADY_REDEEMED' ? 'You already used this code' : (detail || 'Invalid code'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid rgba(124,58,237,0.15)', paddingTop: 12, marginTop: 4 }}>
      <p className="text-xs text-slate-500 text-center mb-2">🎟️ Have a promo code?</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && redeem()}
          placeholder="Enter code"
          style={{ flex: 1, background: '#0a0a12', border: '1px solid rgba(124,58,237,0.3)', color: 'white', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
        />
        <button
          onClick={redeem}
          disabled={loading || !code.trim()}
          style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', border: 'none', borderRadius: 8, padding: '8px 16px', color: 'white', fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? '...' : 'Redeem'}
        </button>
      </div>
    </div>
  );
}

export default PromoCodeBox;
