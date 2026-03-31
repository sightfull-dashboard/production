import React, { useState, useEffect } from 'react';
import { ShieldCheck, Loader2, AlertCircle, Copy, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { apiPost } from '../lib/api';
import { cn } from '../lib/utils';

interface MfaSetupProps {
  onComplete: () => void;
  onCancel: () => void;
  isModal?: boolean;
}

export const MfaSetup: React.FC<MfaSetupProps> = ({ onComplete, onCancel, isModal = false }) => {
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchSetup = async () => {
      try {
        const res = await apiPost<{ secret: string; qrCodeUrl: string }>('/api/mfa/setup');
        setSecret(res.secret);
        setQrCodeUrl(res.qrCodeUrl);
      } catch (err: any) {
        setError(err.message || 'Failed to initialize MFA setup');
      } finally {
        setLoading(false);
      }
    };
    fetchSetup();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (token.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      await apiPost('/api/mfa/verify-setup', { token });
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const copySecret = () => {
    if (secret) {
      navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className={cn(
        "flex items-center justify-center p-6",
        !isModal && "min-h-screen bg-slate-50"
      )}>
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  const content = (
    <motion.div 
      initial={isModal ? {} : { opacity: 0, scale: 0.95 }}
      animate={isModal ? {} : { opacity: 1, scale: 1 }}
      className={cn(
        "w-full max-w-md bg-white rounded-[32px] p-8",
        !isModal && "shadow-2xl shadow-indigo-100/50"
      )}
    >
      <div className="text-center space-y-4 mb-8">
        <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldCheck className="w-8 h-8 text-indigo-600" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Set Up 2FA</h2>
        <p className="text-slate-500 font-medium text-sm">
          Scan the QR code with Google Authenticator or your preferred 2FA app.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600 text-sm font-bold">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-6">
        {qrCodeUrl && (
          <div className="flex justify-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48" />
          </div>
        )}

        {secret && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Or enter this code manually</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-mono text-slate-700 text-center tracking-widest">
                {secret}
              </code>
              <button
                onClick={copySecret}
                className="p-3 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 text-slate-500 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4 pt-4 border-t border-slate-100">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Enter 6-digit code</label>
            <input 
              type="text" 
              required 
              maxLength={6}
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full px-4 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 outline-none transition-all font-mono text-center text-2xl tracking-widest text-slate-800 placeholder:text-slate-300"
            />
          </div>

          <button
            type="submit"
            disabled={verifying || token.length !== 6}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2"
          >
            {verifying ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Verify & Enable'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold text-lg transition-all flex items-center justify-center"
          >
            Cancel
          </button>
        </form>
      </div>
    </motion.div>
  );

  if (isModal) return content;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      {content}
    </div>
  );
};
