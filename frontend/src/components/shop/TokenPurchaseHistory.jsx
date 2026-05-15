import React, { useEffect, useState } from 'react';
import apiClient from '../../api/client';

function TokenPurchaseHistory({ API, user }) {
  const [open, setOpen] = React.useState(false);
  const [history, setHistory] = React.useState([]);
  const [page, setPage] = React.useState(1);
  const [totalCount, setTotalCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const PER_PAGE = 5;

  const load = React.useCallback(async (p) => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const offset = (p - 1) * PER_PAGE;
      const r = await apiClient.get(`/purchase-history/${user.id}?limit=${PER_PAGE}&offset=${offset}`);
      setHistory(r.data.purchases || []);
      setTotalCount(r.data.total || r.data.purchases?.length || 0);
    } catch { setHistory([]); } finally { setLoading(false); }
  }, [API, user?.id]);

  const toggle = () => {
    if (!open) { setPage(1); load(1); }
    setOpen(o => !o);
  };

  const goPage = (p) => { setPage(p); load(p); };
  const totalPages = Math.ceil(totalCount / PER_PAGE);

  return (
    <div style={{ marginTop: 10 }}>
      {/* Toggle button */}
      <button
        onClick={toggle}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: open ? '14px 14px 0 0' : 14, padding: '12px 16px', cursor: 'pointer', transition: 'border-radius 0.2s' }}
      >
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>💳 Token Purchase History</span>
        <span style={{ fontSize: 16, color: '#64748b', transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▾</span>
      </button>

      {/* Expanded content */}
      {open && (
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 16px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 13 }}>Loading...</div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 13 }}>No purchases yet</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'rgba(139,92,246,0.07)', borderRadius: 8, border: '1px solid rgba(139,92,246,0.15)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>+{p.tokens_purchased ?? '?'} tokens</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>
                        {p.purchase_date ? new Date(p.purchase_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#22c55e' }}>{p.sol_amount?.toFixed(6)} SOL</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>
                        {p.eur_value ? `€${Number(p.eur_value).toFixed(2)}` : p.sol_amount && p.sol_eur_price ? `€${(p.sol_amount * p.sol_eur_price).toFixed(2)}` : '—'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <button onClick={() => goPage(page - 1)} disabled={page === 1} style={{ padding: '4px 10px', borderRadius: 6, background: page === 1 ? 'rgba(255,255,255,0.04)' : 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)', color: page === 1 ? '#475569' : '#a78bfa', cursor: page === 1 ? 'not-allowed' : 'pointer', fontSize: 12 }}>←</button>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{page} / {totalPages}</span>
                  <button onClick={() => goPage(page + 1)} disabled={page === totalPages} style={{ padding: '4px 10px', borderRadius: 6, background: page === totalPages ? 'rgba(255,255,255,0.04)' : 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)', color: page === totalPages ? '#475569' : '#a78bfa', cursor: page === totalPages ? 'not-allowed' : 'pointer', fontSize: 12 }}>→</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default TokenPurchaseHistory;
