import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, Loader2, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../api/client';

export default function PaymentModal({ isOpen, onClose, userId, tokenAmount: initialTokenAmount, initialEurAmount, onConfirm }) {
  // step: 'configure' = user sets amount | 'invoice' = wallet created, waiting for payment
  const [step, setStep] = useState('configure');

  const getInitialEur = () => {
    if (initialEurAmount) return initialEurAmount;
    const saved = localStorage.getItem('casino_last_eur_amount');
    if (saved) return parseFloat(saved);
    return (initialTokenAmount || 1000) / 100;
  };

  const [eurAmount, setEurAmount] = useState(getInitialEur());
  const [eurInput, setEurInput]   = useState(getInitialEur().toString());
  const [validationError, setValidationError] = useState('');
  const [solPrice, setSolPrice]   = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);

  // invoice step state
  const [paymentData, setPaymentData]     = useState(null);
  const [generatingWallet, setGeneratingWallet] = useState(false);
  const [copied, setCopied]               = useState(false);
  const [timeLeft, setTimeLeft]           = useState(1200);
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const checkingRef = useRef(false);

  // Sync eurAmount when prop changes
  useEffect(() => {
    if (isOpen && initialEurAmount != null) {
      setEurAmount(initialEurAmount);
      setEurInput(initialEurAmount.toString());
    }
  }, [isOpen, initialEurAmount]);

  // Body scroll lock + reset on close
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      // Reset all state
      setStep('configure');
      setPaymentData(null);
      setPaymentStatus('pending');
      setValidationError('');
      setTimeLeft(1200);
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Fetch SOL price only on configure step open
  useEffect(() => {
    if (!isOpen || step !== 'configure') return;
    let cancelled = false;

    const fetchPrice = async () => {
      setPriceLoading(true);
      try {
        const res = await apiClient.get('/sol-eur-price');
        if (!cancelled && res.data?.sol_eur_price) {
          setSolPrice(res.data.sol_eur_price);
          localStorage.setItem('casino_last_sol_eur_price', res.data.sol_eur_price.toString());
        }
      } catch {
        const fallback = parseFloat(localStorage.getItem('casino_last_sol_eur_price')) || 120;
        if (!cancelled) setSolPrice(fallback);
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    };

    fetchPrice();
    return () => { cancelled = true; };
  }, [isOpen, step]);

  // Countdown timer (invoice step only)
  useEffect(() => {
    if (!isOpen || step !== 'invoice') return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          toast.error('Payment expired');
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, step, onClose]);

  // Poll payment status (invoice step only)
  useEffect(() => {
    if (!isOpen || step !== 'invoice' || !paymentData) return;
    if (['completed', 'failed', 'timeout'].includes(paymentStatus)) return;

    const poll = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const res = await apiClient.get(`/purchase-status/${userId}/${paymentData.wallet_address}`);
        const status = res.data.purchase_status;
        if (status.tokens_credited) {
          setPaymentStatus('completed');
          toast.success('🎉 Payment successful! Tokens credited.');
          setTimeout(() => {
            onClose();
            window.dispatchEvent(new CustomEvent('payment-completed'));
            setTimeout(() => window.location.reload(), 500);
          }, 2000);
        } else if (status.payment_detected && paymentStatus !== 'processing') {
          setPaymentStatus('processing');
          toast.success('💰 Payment detected! Processing...');
        }
      } catch { /* silent */ } finally {
        checkingRef.current = false;
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [isOpen, step, paymentData, paymentStatus, userId, onClose]);

  // 5 min timeout
  useEffect(() => {
    if (!isOpen || step !== 'invoice' || !paymentData) return;
    const t = setTimeout(() => {
      if (['pending', 'processing'].includes(paymentStatus)) {
        setPaymentStatus('timeout');
        toast.error('⚠️ Payment not detected. Please try again.');
      }
    }, 300000);
    return () => clearTimeout(t);
  }, [isOpen, step, paymentData, paymentStatus]);

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied!');
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error('Failed to copy'); }
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const solAmount = solPrice ? (eurAmount / solPrice).toFixed(6) : '...';

  const handleEurChange = (e) => {
    let value = e.target.value.replace(',', '.');
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return;
    setEurInput(value);
    if (value === '' || value === '.') { setValidationError(''); return; }
    const n = parseFloat(value);
    if (isNaN(n)) { setValidationError('Enter a valid number'); return; }
    if (n < 0.1)  { setValidationError('Minimum 0.1 EUR'); return; }
    setValidationError('');
    setEurAmount(n);
    localStorage.setItem('casino_last_eur_amount', n.toString());
  };

  const handleEurBlur = () => {
    const n = parseFloat(eurInput.replace(',', '.'));
    if (isNaN(n) || n < 0.1) {
      setEurAmount(0.1); setEurInput('0.10');
      setValidationError('');
      localStorage.setItem('casino_last_eur_amount', '0.1');
    } else {
      setEurInput(n.toFixed(2));
      setEurAmount(n);
      localStorage.setItem('casino_last_eur_amount', n.toString());
    }
  };

  const handleGenerateInvoice = async () => {
    if (validationError || eurAmount < 0.1) return;
    setGeneratingWallet(true);
    try {
      const tokenAmount = Math.floor(eurAmount * 100);
      const res = await apiClient.post('/purchase-tokens', { token_amount: tokenAmount });
      if (res.data.status === 'success') {
        setPaymentData(res.data.payment_info);
        setTimeLeft(1200);
        setPaymentStatus('pending');
        setStep('invoice');
        toast.success('Payment wallet created!');
      } else {
        toast.error('Failed to create payment wallet');
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create payment wallet');
    } finally {
      setGeneratingWallet(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      style={{ animation: 'fadeIn 0.3s ease-out' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !['processing', 'crediting'].includes(paymentStatus))
          onClose();
      }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div
        className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border border-purple-500/30 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        style={{ animation: 'slideUp 0.3s ease-out' }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-purple-800 p-4 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <QrCode className="w-6 h-6" />
            {step === 'configure' ? 'Buy Tokens' : 'Payment Invoice'}
          </h2>
          <button
            onClick={onClose}
            disabled={['processing', 'crediting'].includes(paymentStatus)}
            className={`transition-colors ${['processing', 'crediting'].includes(paymentStatus) ? 'text-white/40 cursor-not-allowed' : 'text-white/80 hover:text-white'}`}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* ── STEP 1: Configure ── */}
        {step === 'configure' && (
          <div className="p-6 space-y-5">
            {/* EUR input */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white">Amount in EUR</label>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-lg">€</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={eurInput}
                  onChange={handleEurChange}
                  onBlur={handleEurBlur}
                  placeholder="0.10"
                  className="flex-1 bg-slate-900 border border-slate-700 text-white text-xl font-bold rounded-lg px-4 py-3 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none"
                />
              </div>
              {validationError && <p className="text-xs text-red-400">⚠️ {validationError}</p>}
              <p className="text-xs text-slate-500">Minimum €0.10 • Use dot (.) or comma (,)</p>
            </div>

            {/* Tokens */}
            <div className="flex justify-between items-center p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <span className="text-purple-300">Tokens You'll Get</span>
              <span className="text-purple-400 font-bold">{Math.floor(eurAmount * 100)} tokens</span>
            </div>

            {/* SOL equivalent */}
            <div className="flex justify-between items-center p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <span className="text-green-300">Amount in SOL</span>
              {priceLoading
                ? <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
                : <span className="text-green-400 font-bold">{solAmount} SOL</span>
              }
            </div>

            {/* Rate */}
            <p className="text-xs text-slate-500 text-center">
              {solPrice ? `Rate: 1 SOL = €${solPrice.toFixed(2)} | 1 EUR = 100 tokens` : 'Fetching live rate...'}
            </p>

            {/* Generate button */}
            <button
              onClick={handleGenerateInvoice}
              disabled={generatingWallet || !!validationError || eurAmount < 0.1 || !solPrice}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
            >
              {generatingWallet
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                : '⚡ Generate Payment Address'
              }
            </button>

            <button onClick={onClose} className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-all">
              Cancel
            </button>
          </div>
        )}

        {/* ── STEP 2: Invoice ── */}
        {step === 'invoice' && paymentData && (
          <div className="p-6 space-y-5">
            {/* Timer */}
            <div className="bg-slate-800/50 rounded-lg p-4 border border-yellow-500/30 text-center">
              <div className="text-sm text-slate-400 mb-1">Time Remaining</div>
              <div className="text-3xl font-bold text-yellow-400">{formatTime(timeLeft)}</div>
              <div className="text-xs text-slate-500 mt-1">Expires in 20 minutes</div>
            </div>

            {/* Summary */}
            <div className="flex justify-between items-center p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <span className="text-purple-300">Tokens You'll Get</span>
              <span className="text-purple-400 font-bold">{paymentData.token_amount} tokens</span>
            </div>

            {/* Wallet address */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white">Send SOL to this address:</label>
              <div
                className="relative flex items-center justify-between bg-slate-900 p-4 rounded-lg border border-slate-700 cursor-pointer hover:bg-slate-800 transition-colors group"
                onClick={() => copyToClipboard(paymentData.wallet_address)}
              >
                <span className="break-all font-mono text-sm text-green-400 pr-8">{paymentData.wallet_address}</span>
                <span className="absolute top-2 right-2">
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-400 group-hover:text-green-400 transition-colors" />}
                </span>
              </div>
            </div>

            {/* Exact SOL amount */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white">Amount to send:</label>
              <div
                className="flex items-center justify-between bg-green-500/10 p-3 rounded-lg border border-green-500/30 cursor-pointer hover:bg-green-500/20 transition-colors group"
                onClick={() => {
                  navigator.clipboard.writeText(paymentData.required_sol.toFixed(6));
                  toast.success('✅ SOL amount copied!');
                }}
              >
                <span className="font-mono text-lg font-bold text-green-400">
                  {paymentData.required_sol.toFixed(6)} SOL
                </span>
                <Copy className="w-4 h-4 text-green-400 opacity-60 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-xs text-slate-500 text-center">
                Rate at creation: 1 SOL = €{paymentData.sol_eur_price?.toFixed(2)} | €{eurAmount.toFixed(2)} total
              </p>
            </div>

            {/* Status */}
            {paymentStatus !== 'pending' && (
              <div className={`p-4 rounded-lg border ${
                paymentStatus === 'processing' ? 'bg-yellow-500/10 border-yellow-500/30' :
                paymentStatus === 'completed'  ? 'bg-green-500/10 border-green-500/30' :
                'bg-red-500/10 border-red-500/30'
              }`}>
                <div className="flex items-center gap-3">
                  {!['timeout', 'failed'].includes(paymentStatus)
                    ? <Loader2 className={`w-5 h-5 animate-spin ${paymentStatus === 'processing' ? 'text-yellow-400' : 'text-green-400'}`} />
                    : <X className="w-5 h-5 text-red-400" />
                  }
                  <div>
                    <div className="font-semibold text-white">
                      {paymentStatus === 'processing' && '💰 Payment Detected'}
                      {paymentStatus === 'completed'  && '✅ Payment Complete!'}
                      {paymentStatus === 'timeout'    && '⚠️ Payment Timeout'}
                      {paymentStatus === 'failed'     && '❌ Payment Failed'}
                    </div>
                    <div className="text-sm text-slate-400">
                      {paymentStatus === 'processing' && 'Processing your payment...'}
                      {paymentStatus === 'completed'  && 'Tokens added! Closing...'}
                      {paymentStatus === 'timeout'    && 'Not detected. Check transaction or try again.'}
                      {paymentStatus === 'failed'     && 'Something went wrong. Please try again.'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 space-y-1">
              <h3 className="font-semibold text-white text-sm">📝 Instructions:</h3>
              <ul className="text-xs text-slate-300 space-y-1">
                <li>• Send <strong className="text-green-400">{paymentData.required_sol?.toFixed(6)} SOL</strong> to the address above</li>
                <li>• Small differences are OK — you'll receive tokens proportional to what you send</li>
                <li>• Payment detected automatically within 1-2 minutes</li>
                <li>• Do not close this window until confirmed</li>
              </ul>
            </div>

            {paymentStatus === 'pending' && (
              <button onClick={onClose} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all">
                Cancel Payment
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
