import React, { useState } from 'react';
import { ShieldCheck, Mail, Lock, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { SIDEBAR_LOGO as sidebarLogo } from '../app/shared/formOptions';

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export const SuperAdminLogin: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-7xl bg-slate-900 rounded-[40px] shadow-2xl shadow-black/50 flex overflow-hidden min-h-[600px] border border-slate-800"
      >
        {/* Left: Form */}
        <div className="w-full lg:w-1/2 p-12 flex flex-col justify-center">
          <div className="space-y-8 max-w-md mx-auto w-full">
            <div className="flex flex-col items-center lg:items-start space-y-6">
              <div className="space-y-2 text-center lg:text-left">
                <h2 className="text-4xl font-black text-white tracking-tight">Super Admin Login</h2>
                <p className="text-slate-400 font-medium">Secure access to system-wide controls</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="p-4 bg-rose-950/50 border border-rose-900 rounded-2xl flex items-center gap-3 text-rose-400 text-sm font-bold">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                    <input 
                      type="email" 
                      required 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="superadmin@sightfull.co.za"
                      className="w-full pl-12 pr-4 py-4 rounded-2xl bg-slate-950 border border-slate-800 focus:ring-4 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-bold text-white placeholder:text-slate-700"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                    <input 
                      type={showPassword ? "text" : "password"}
                      required 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-12 pr-14 py-4 rounded-2xl bg-slate-950 border border-slate-800 focus:ring-4 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-bold text-white placeholder:text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-slate-400 font-bold cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500" />
                  Remember for 30 Days
                </label>
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-indigo-900/50 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Access Panel'}
              </button>

              <p className="text-center text-xs text-slate-500 font-medium">
                Authorized personnel only. All access is logged and monitored.
              </p>
            </form>
          </div>
        </div>

        {/* Right: Blue side */}
        <div className="hidden lg:flex w-1/2 bg-indigo-950 p-16 text-white flex-col justify-center relative overflow-hidden">
          <div className="relative z-10 space-y-10">
            <div className="flex items-center gap-3">
              <img src={sidebarLogo} alt="Logo" className="w-12 h-12 object-contain" />
              <div className="flex flex-col">
                <h1 className="text-2xl font-black text-white tracking-tighter leading-none">SIGHTFULL</h1>
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-[0.2em] mt-1">SUPER ADMIN</span>
              </div>
            </div>

            <h1 className="text-4xl font-black leading-[1.1] tracking-tight uppercase">
              SECURE SYSTEM<br />
              <span className="text-amber-400">ADMIN ACCESS</span>
            </h1>
            <p className="text-indigo-200 text-xl font-medium max-w-sm leading-relaxed opacity-90">
              Manage platform-wide configurations, user access, and system integrity from this centralized control panel.
            </p>

            <div className="mt-12 bg-white/5 backdrop-blur-md p-8 rounded-3xl border border-white/10 shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <span className="font-bold text-lg tracking-wide">System Integrity</span>
                <div className="flex gap-4 text-xs font-bold uppercase tracking-widest opacity-80">
                  <span className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-400"></div> Secure</span>
                  <span className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-white"></div> Active</span>
                </div>
              </div>
              <div className="h-40 flex items-end gap-3">
                {[40, 60, 30, 80, 50, 90, 40].map((h, i) => (
                  <div key={i} className="flex-1 bg-white/10 rounded-t-lg relative" style={{ height: `${h}%` }}>
                    <div className="absolute bottom-0 left-0 right-0 bg-amber-400 rounded-t-lg shadow-lg" style={{ height: '60%' }}></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Decorative circles */}
          <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-amber-900 rounded-full blur-3xl opacity-20"></div>
          <div className="absolute top-20 -left-20 w-72 h-72 bg-indigo-900 rounded-full blur-3xl opacity-30"></div>
        </div>
      </motion.div>
    </div>
  );
};
