import React from 'react';
import type { WalletTransaction } from '../types/bazar';

interface WalletTabProps {
  walletBalance: number;
  totalCashbackEarned?: number;
  cashbackPercent?: number;
  allowCashback?: boolean;
  minDeposit: number;
  maxDeposit: number;
  minWithdraw: number;
  maxWithdraw: number;
  allowReferrals: boolean;
  referrerBonus: number;
  refereeBonus: number;
  referralCode: string;
  transactions: Record<string, WalletTransaction>;
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
  onCopyReferral: () => void;
}

export const WalletTab: React.FC<WalletTabProps> = ({
  walletBalance,
  totalCashbackEarned = 0,
  cashbackPercent = 5,
  allowCashback = true,
  minDeposit,
  maxDeposit,
  minWithdraw,
  maxWithdraw,
  allowReferrals,
  referrerBonus,
  refereeBonus,
  referralCode,
  transactions,
  onOpenDeposit,
  onOpenWithdraw,
  onCopyReferral,
}) => {
  const entries = Object.entries(transactions).sort(
    (a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)
  );
  const referralShareMsg = encodeURIComponent(
    `Shop fresh groceries in 15 mins on Chutki! Use my referral code ${referralCode} at signup to get ₹${refereeBonus} Wallet bonus!`
  );

  return (
    <div id="tab-wallet" className="tab-content active">
      <div className="wallet-hero-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                color: '#94a3b8',
                fontWeight: 800,
              }}
            >
              Bazar Wallet Balance
            </span>
            <div
              id="wallet-balance-display"
              style={{
                fontSize: '2.1rem',
                fontWeight: 900,
                color: '#34d399',
                margin: '4px 0',
              }}
            >
              ₹{walletBalance.toFixed(2)}
            </div>
            <div
              style={{ fontSize: '0.72rem', color: '#cbd5e1' }}
              id="wallet-limits-caption"
            >
              Deposit: ₹{minDeposit}-₹{maxDeposit} • Withdraw: ₹{minWithdraw}-₹
              {maxWithdraw}
            </div>
          </div>
          <i
            className="fa-solid fa-wallet"
            style={{ fontSize: '2rem', color: '#38bdf8', opacity: 0.8 }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ flex: 1, padding: '0.7rem' }}
            onClick={onOpenDeposit}
          >
            <i className="fa-solid fa-plus" /> Add Money
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{
              flex: 1,
              padding: '0.7rem',
              color: '#fff',
              borderColor: 'rgba(255,255,255,0.35)',
            }}
            onClick={onOpenWithdraw}
          >
            <i className="fa-solid fa-arrow-up-right-from-square" /> Withdraw
          </button>
        </div>
      </div>

      {allowCashback && (
        <div className="cashback-promo-card" data-testid="wallet-cashback-card">
          <div>
            <div className="cashback-promo-title">
              🪙 {cashbackPercent}% Instant Wallet Cashback
            </div>
            <div className="cashback-promo-sub">
              Auto-credited on every UPI, Card &amp; Wallet grocery order.
            </div>
          </div>
          <div className="cashback-earned-pill">
            <span>Earned</span>
            <strong id="wallet-cashback-earned">₹{Number(totalCashbackEarned || 0).toFixed(0)}</strong>
          </div>
        </div>
      )}

      {allowReferrals && (
        <div className="referral-card" id="referral-card-box">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px',
            }}
          >
            <strong style={{ color: 'var(--brand-green)', fontSize: '0.95rem' }}>
              <i className="fa-solid fa-gift" /> Refer & Earn Wallet Cash
            </strong>
            <span className="express-pill" id="referral-reward-badge">
              Get ₹{referrerBonus}
            </span>
          </div>
          <p
            style={{ fontSize: '0.76rem', color: '#334155', marginBottom: '8px' }}
            id="referral-desc-text"
          >
            Invite friends! You earn ₹{referrerBonus} & your friend gets ₹
            {refereeBonus} in Wallet on signup.
          </p>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              background: '#fff',
              border: '1px solid #cbd5e1',
              padding: '6px 10px',
              borderRadius: '10px',
            }}
          >
            <code
              id="my-referral-code"
              style={{
                flex: 1,
                fontSize: '1rem',
                fontWeight: 900,
                color: '#0f172a',
                letterSpacing: '1.5px',
              }}
            >
              {referralCode}
            </code>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={onCopyReferral}
            >
              <i className="fa-regular fa-copy" /> Copy
            </button>
            <a
              href={`https://wa.me/?text=${referralShareMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
              aria-label="Share referral code on WhatsApp"
            >
              <i className="fa-brands fa-whatsapp" /> Share
            </a>
          </div>
        </div>
      )}

      <div
        style={{ fontSize: '0.95rem', fontWeight: 900, marginBottom: '0.6rem' }}
      >
        Recent Wallet Transactions
      </div>
      <div id="wallet-transactions-list">
        {entries.length === 0 ? (
          <p
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              padding: '1rem',
            }}
          >
            No transactions yet.
          </p>
        ) : (
          entries.slice(0, 20).map(([txId, t]) => (
            <div
              key={txId}
              style={{
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '0.75rem 0.9rem',
                marginBottom: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <strong style={{ fontSize: '0.84rem', display: 'block' }}>
                  {t.note || t.type}
                </strong>
                <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                  {new Date(t.createdAt || Date.now()).toLocaleString()}
                </small>
              </div>
              <strong
                style={{
                  color:
                    t.type === 'CREDIT' ? 'var(--brand-green)' : 'var(--danger)',
                  fontSize: '0.95rem',
                }}
              >
                {t.type === 'CREDIT' ? '+' : '-'}₹
                {Number(t.amount || 0).toFixed(0)}
              </strong>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
