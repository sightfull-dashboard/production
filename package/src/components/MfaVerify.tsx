import React, { useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { apiPost } from '../lib/api';
import { cn } from '../lib/utils';

interface MfaVerifyProps {
  onComplete: () => void;
  onCancel: () => void;
  isModal?: boolean;
}

export const MfaVerify: React.FC<MfaVerifyProps> = ({ onComplete, onCancel, isModal = false }) => {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (token.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiPost('/api/mfa/verify', { token });
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Two-Factor Authentication</h2>
        <p className="text-slate-500 font-medium text-sm">
          Enter the 6-digit code from your authenticator app.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600 text-sm font-bold">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleVerify} className="space-y-6">
        <div className="space-y-1.5">
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
          disabled={loading || token.length !== 6}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Verify'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold text-lg transition-all flex items-center justify-center"
        >
          Cancel
        </button>
      </form>
    </motion.div>
  );

  if (isModal) return content;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      {content}
    </div>
  );
};
