import React from 'react';
import { Loader2, AlertCircle, FileSearch, ShieldCheck, Building2, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface BrandedStateProps {
  type: 'loading' | 'empty' | 'error';
  portal?: 'superadmin' | 'client' | 'employee';
  title?: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const BrandedState: React.FC<BrandedStateProps> = ({ 
  type, 
  portal = 'client', 
  title, 
  message, 
  action 
}) => {
  const portalConfig = {
    superadmin: {
      color: 'text-rose-600',
      bg: 'bg-rose-50',
      icon: ShieldCheck,
      accent: 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'
    },
    client: {
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      icon: Building2,
      accent: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
    },
    employee: {
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      icon: Users,
      accent: 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
    }
  };

  const config = portalConfig[portal];

  if (type === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className={cn("w-20 h-20 rounded-[32px] flex items-center justify-center relative", config.bg)}>
          <Loader2 className={cn("w-10 h-10 animate-spin", config.color)} />
          <div className={cn("absolute inset-0 rounded-[32px] border-4 border-t-transparent animate-spin", config.color.replace('text-', 'border-'))} />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-xl font-black text-slate-800 tracking-tight">{title || 'Loading Content...'}</h3>
          <p className="text-slate-400 font-bold text-sm">{message || 'Please wait while we fetch your data.'}</p>
        </div>
      </div>
    );
  }

  if (type === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-8">
        <div className={cn("w-24 h-24 rounded-[40px] flex items-center justify-center", config.bg)}>
          <FileSearch className={cn("w-12 h-12", config.color)} />
        </div>
        <div className="text-center space-y-2 max-w-xs">
          <h3 className="text-2xl font-black text-slate-800 tracking-tight">{title || 'No Results Found'}</h3>
          <p className="text-slate-400 font-bold text-sm">{message || 'We couldn\'t find any data matching your request.'}</p>
        </div>
        {action && (
          <button 
            onClick={action.onClick}
            className={cn("px-8 py-4 text-white rounded-2xl font-black transition-all shadow-xl", config.accent)}
          >
            {action.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-8">
      <div className="w-24 h-24 bg-rose-50 rounded-[40px] flex items-center justify-center">
        <AlertCircle className="w-12 h-12 text-rose-600" />
      </div>
      <div className="text-center space-y-2 max-w-xs">
        <h3 className="text-2xl font-black text-slate-800 tracking-tight">{title || 'Something Went Wrong'}</h3>
        <p className="text-slate-400 font-bold text-sm">{message || 'An unexpected error occurred. Please try again later.'}</p>
      </div>
      {action && (
        <button 
          onClick={action.onClick}
          className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
