import { ArrowLeft } from 'lucide-react';

function Para({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {title && <p style={{ color: '#c9a84c', fontWeight: 700, fontSize: 13, margin: '0 0 6px' }}>{title}</p>}
      <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.7, margin: 0 }}>{children}</p>
    </div>
  );
}

export default function TosScreen({ onBack }) {
  return (
    <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100, color: '#e8e0d0' }}>
      <div style={{ position: 'sticky', top: 0, background: 'rgba(26,26,46,0.97)', borderBottom: '1px solid rgba(201,168,76,0.15)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, zIndex: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <ArrowLeft style={{ width: 20, height: 20, color: '#c9a84c' }} />
        </button>
        <h1 style={{ fontSize: 17, fontWeight: 800, color: 'white', margin: 0 }}>Terms of Service</h1>
      </div>

      <div style={{ padding: '20px 16px' }}>
        <p style={{ color: '#475569', fontSize: 11, marginBottom: 24 }}>Last updated: May 2026</p>

        <Para title="1. Acceptance of Terms">
          By accessing or using RiskArena ("the App"), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the App. We reserve the right to modify these terms at any time — continued use constitutes acceptance.
        </Para>

        <Para title="2. Eligibility">
          You must be at least 18 years of age (or the legal gambling age in your jurisdiction, whichever is higher) to use RiskArena. By using the App, you confirm that you meet this requirement. We reserve the right to request age verification at any time.
        </Para>

        <Para title="3. Virtual Currency">
          RiskArena uses virtual tokens ("Coins") for in-game activities. Coins are acquired through gameplay, purchases, or promotional events. Coins have no real-world monetary value and cannot be redeemed for cash or equivalent. Solana (SOL) deposits are converted to Coins at a fixed rate for platform use.
        </Para>

        <Para title="4. Game Fairness">
          All game outcomes are determined by server-side logic. Arena duels are resolved by the combat engine. Risk rolls use a server-generated random result. We do not guarantee any particular outcome. Past results do not predict future results.
        </Para>

        <Para title="5. Prohibited Conduct">
          You may not: (a) exploit bugs or glitches to gain unfair advantage; (b) use bots, scripts, or automation; (c) attempt to hack, reverse-engineer, or disrupt the platform; (d) collude with other players; (e) create multiple accounts to abuse promotions. Violations may result in immediate account suspension without refund.
        </Para>

        <Para title="6. Responsible Gaming">
          We encourage responsible play. Use the in-app spending limits and session reminders. If you believe you have a gambling problem, please seek help from a professional service in your country.
        </Para>

        <Para title="7. Limitation of Liability">
          RiskArena is provided "as is." We are not liable for any financial losses, loss of data, or damages arising from use of the App, including but not limited to technical failures, game interruptions, or unauthorized access to your account.
        </Para>

        <Para title="8. Account Termination">
          We reserve the right to suspend or terminate any account at our sole discretion, including for violations of these terms, suspected fraud, or inactivity exceeding 12 months.
        </Para>

        <Para title="9. Governing Law">
          These terms are governed by applicable international law. Disputes shall be resolved through binding arbitration rather than in court, to the extent permitted by law.
        </Para>

        <Para title="10. Contact">
          Questions about these Terms? Contact us through the official RiskArena Telegram channel.
        </Para>
      </div>
    </div>
  );
}
