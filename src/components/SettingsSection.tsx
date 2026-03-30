import React, { useState } from 'react';
import { Shield, ShieldCheck, ShieldAlert, Loader2, Mail, User as UserIcon, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { User } from '../types';
import { apiPost } from '../lib/api';
import { MfaSetup } from './MfaSetup';
import { cn } from '../lib/utils';

interface SettingsSectionProps {
  user: User;
  onUpdateUser: (updatedUser: User) => void;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({ user, onUpdateUser }) => {
  const [isSettingUpMfa, setIsSettingUpMfa] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDisableMfa = async () => {
    if (user.mfa_required) {
      toast.error('2FA is required by administrator and cannot be disabled.');
      return;
    }

    setLoading(true);
    try {
      await apiPost('/api/mfa/disable');
      onUpdateUser({ ...user, mfa_enabled: false });
      toast.success('Two-factor authentication disabled');
    } catch (error: any) {
      toast.error(error.message || 'Failed to disable 2FA');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaComplete = () => {
    setIsSettingUpMfa(false);
    onUpdateUser({ ...user, mfa_enabled: true });
    toast.success('Two-factor authentication enabled successfully');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div className="space-y-1">
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Account Settings</h2>
        <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Manage your profile and security</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Profile Info */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 p-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
                <UserIcon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">Profile Information</h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Your personal account details</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="email" 
                      value={user.email}
                      readOnly
                      className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 outline-none font-bold text-sm cursor-not-allowed" 
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Account Role</label>
                  <div className="relative">
                    <Shield className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={user.role.toUpperCase()}
                      readOnly
                      className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 outline-none font-bold text-sm cursor-not-allowed" 
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                <p className="text-xs text-amber-700 font-medium leading-relaxed">
                  Profile editing is currently restricted. Please contact your system administrator to update your account details.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Security / 2FA */}
        <div className="space-y-6">
          <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 p-8">
            <div className="flex items-center gap-4 mb-8">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center",
                user.mfa_enabled ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"
              )}>
                {user.mfa_enabled ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">Security</h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Two-Factor Auth</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700">2FA Status</span>
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg",
                    user.mfa_enabled ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500"
                  )}>
                    {user.mfa_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Add an extra layer of security to your account by requiring a code from Google Authenticator.
                </p>
              </div>

              {user.mfa_enabled ? (
                <button
                  onClick={handleDisableMfa}
                  disabled={loading || user.mfa_required}
                  className={cn(
                    "w-full py-3 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2",
                    user.mfa_required 
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                      : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                  )}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Disable 2FA'}
                </button>
              ) : (
                <button
                  onClick={() => setIsSettingUpMfa(true)}
                  className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-black text-sm hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  Enable 2FA
                </button>
              )}

              {user.mfa_required && (
                <div className="flex items-start gap-2 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                  <Lock className="w-3.5 h-3.5 text-indigo-600 mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] text-indigo-700 font-bold leading-tight">
                    2FA is required for your account by administrator policy.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isSettingUpMfa && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md"
            >
              <MfaSetup 
                onComplete={handleMfaComplete} 
                onCancel={() => setIsSettingUpMfa(false)} 
                isModal={true}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
