import React from 'react';
import { Lock, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

type Theme = 'indigo' | 'emerald' | 'rose';
type IconType = React.ComponentType<any>;

export const SidebarItem = ({ icon: Icon, label, active, onClick, badge, theme = 'indigo', isLocked = false }: { icon: IconType; label: string; active: boolean; onClick: () => void; badge?: number; theme?: Theme; isLocked?: boolean }) => {
  const themes = {
    indigo: {
      active: 'bg-indigo-600 text-white shadow-lg shadow-indigo-200',
      hover: 'text-slate-600 hover:bg-white/50 hover:translate-x-1',
      iconActive: 'text-white',
      iconHover: 'text-slate-400 group-hover:text-indigo-600',
    },
    emerald: {
      active: 'bg-emerald-600 text-white shadow-lg shadow-emerald-200',
      hover: 'text-slate-600 hover:bg-white/50 hover:translate-x-1',
      iconActive: 'text-white',
      iconHover: 'text-slate-400 group-hover:text-emerald-600',
    },
    rose: {
      active: 'bg-rose-600 text-white shadow-lg shadow-rose-200',
      hover: 'text-slate-400 hover:bg-white/10 hover:translate-x-1',
      iconActive: 'text-white',
      iconHover: 'text-slate-500 group-hover:text-rose-400',
    },
  } as const;

  const currentTheme = themes[theme];

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200 group relative',
        active ? currentTheme.active : currentTheme.hover,
        isLocked && 'opacity-70 grayscale-[0.3]',
      )}
    >
      <Icon className={cn('w-5 h-5', active ? currentTheme.iconActive : currentTheme.iconHover)} />
      <span className="font-bold text-sm tracking-tight">{label}</span>
      {isLocked && (
        <span className="absolute right-3">
          <Lock className="w-3.5 h-3.5 text-slate-400" />
        </span>
      )}
      {badge !== undefined && badge > 0 && !isLocked && (
        <span className="absolute right-3 w-5 h-5 bg-rose-500 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-sm">
          {badge}
        </span>
      )}
    </button>
  );
};

export const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 p-6', className)}>
    {children}
  </div>
);

export const FeatureWrapper = ({ isLocked, featureName, children }: { isLocked: boolean; featureName: string; children: React.ReactNode }) => {
  if (!isLocked) return <>{children}</>;

  return (
    <div className="relative min-h-[60vh]">
      <div className="absolute inset-0 blur-md pointer-events-none select-none opacity-40 transition-all duration-300 overflow-hidden">
        {children}
      </div>
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center text-center px-4 bg-white/30 backdrop-blur-sm rounded-[32px]">
        <div className="w-24 h-24 bg-rose-50 rounded-[32px] flex items-center justify-center mb-8 border border-rose-100 shadow-xl shadow-rose-100/50">
          <Lock className="w-10 h-10 text-rose-500" />
        </div>
        <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">Feature Locked</h2>
        <p className="text-slate-500 max-w-md mb-8 text-lg leading-relaxed">
          The <span className="font-bold text-slate-700">{featureName}</span> feature is not available in your current plan. Please contact your administrator to upgrade your account and unlock this feature.
        </p>
        <button className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-sm hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/20 hover:shadow-2xl hover:shadow-slate-900/30 hover:-translate-y-1">
          Contact Administrator
        </button>
      </div>
    </div>
  );
};

export const Modal = ({ isOpen, onClose, title, children, footer }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl bg-white rounded-[40px] shadow-2xl z-[101] overflow-hidden"
        >
          <div className="flex items-center justify-between p-8 border-b border-slate-100">
            <h3 className="text-2xl font-black text-slate-800 tracking-tight">{title}</h3>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
          <div className="p-8 max-h-[70vh] overflow-y-auto">{children}</div>
          {footer && <div className="p-8 bg-slate-50 flex justify-end gap-3">{footer}</div>}
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export const SuperAdminSidebarItem = ({ icon: Icon, label, active, onClick, badge }: { icon: IconType; label: string; active: boolean; onClick: () => void; badge?: number }) => (
  <button
    onClick={onClick}
    className={cn(
      'flex items-center justify-between w-full px-4 py-3 rounded-xl transition-all duration-200 group',
      active ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-white/10 hover:translate-x-1',
    )}
  >
    <div className="flex items-center gap-3">
      <Icon className={cn('w-5 h-5', active ? 'text-white' : 'text-slate-500 group-hover:text-indigo-400')} />
      <span className="font-bold text-sm tracking-tight">{label}</span>
    </div>
    {badge !== undefined && badge > 0 && (
      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-black', active ? 'bg-white/20 text-white' : 'bg-rose-500/20 text-rose-400')}>
        {badge}
      </span>
    )}
  </button>
);
