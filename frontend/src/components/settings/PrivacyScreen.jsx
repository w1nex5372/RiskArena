import { ArrowLeft } from 'lucide-react';

function Para({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {title && <p style={{ color: '#c9a84c', fontWeight: 700, fontSize: 13, margin: '0 0 6px' }}>{title}</p>}
      <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.7, margin: 0 }}>{children}</p>
    </div>
  );
}

export default function PrivacyScreen({ onBack }) {
  return (
    <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100, color: '#e8e0d0' }}>
      <div style={{ position: 'sticky', top: 0, background: 'rgba(26,26,46,0.97)', borderBottom: '1px solid rgba(201,168,76,0.15)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, zIndex: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <ArrowLeft style={{ width: 20, height: 20, color: '#c9a84c' }} />
        </button>
        <h1 style={{ fontSize: 17, fontWeight: 800, color: 'white', margin: 0 }}>Privacy Policy</h1>
      </div>

      <div style={{ padding: '20px 16px' }}>
        <p style={{ color: '#475569', fontSize: 11, marginBottom: 24 }}>Last updated: May 2026</p>

        <Para title="1. Information We Collect">
          When you use RiskArena via Telegram, we receive your Telegram user ID, first name, last name (if provided), username, and profile photo URL. We also collect gameplay data including match history, token balances, item ownership, and in-app settings.
        </Para>

        <Para title="2. How We Use Your Information">
          We use your information to: (a) authenticate your identity; (b) operate the game and process transactions; (c) calculate rankings and display leaderboards; (d) send Telegram bot notifications (if enabled); (e) detect fraud and enforce our Terms of Service; (f) improve game balance and performance.
        </Para>

        <Para title="3. Data Storage">
          Your data is stored in a PostgreSQL database hosted on Render.com (or equivalent cloud provider). Data is encrypted in transit (TLS). We do not store full Telegram session data — only the information shared at authentication.
        </Para>

        <Para title="4. Sharing of Data">
          We do not sell your personal data. Leaderboard-visible data (username, win rate, level) is visible to other players unless you disable this in Settings → Privacy. We do not share data with third parties except as required by law.
        </Para>

        <Para title="5. Blockchain Transactions">
          Solana wallet addresses derived for your account are stored and used for payment processing. On-chain transactions are public by the nature of blockchain technology and cannot be made private.
        </Para>

        <Para title="6. Telegram Mini App">
          RiskArena operates as a Telegram Mini App. Your use of Telegram is governed by Telegram's own Privacy Policy. We only access the data Telegram provides through the Mini App initData mechanism.
        </Para>

        <Para title="7. Data Retention">
          We retain your account data for the lifetime of your account. If you request account deletion, we will delete your personal data within 30 days, except where retention is required by law or for fraud prevention.
        </Para>

        <Para title="8. Your Rights">
          You have the right to: access your data (via the Account section in Settings), request correction of inaccurate data, request deletion of your account and associated data. Contact us through the official Telegram channel to exercise these rights.
        </Para>

        <Para title="9. Cookies and Local Storage">
          The App uses browser localStorage to cache your session token and UI preferences. No third-party tracking cookies are used.
        </Para>

        <Para title="10. Contact">
          Privacy questions? Reach us through the official RiskArena Telegram channel.
        </Para>
      </div>
    </div>
  );
}
