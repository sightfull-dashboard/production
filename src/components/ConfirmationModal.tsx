import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger'
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-[40px] shadow-2xl z-[201] overflow-hidden"
          >
            <div className="p-10 space-y-6">
              <div className="flex items-center justify-between">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  variant === 'danger' ? 'bg-rose-100 text-rose-600' : 
                  variant === 'warning' ? 'bg-amber-100 text-amber-600' : 
                  'bg-indigo-100 text-indigo-600'
                }`}>
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">{title}</h3>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">{message}</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={onClose}
                  className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                >
                  {cancelText}
                </button>
                <button 
                  onClick={() => { onConfirm(); onClose(); }}
                  className={`flex-1 px-6 py-3 rounded-2xl font-black text-white transition-all shadow-xl ${
                    variant === 'danger' ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-200' : 
                    variant === 'warning' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 
                    'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                  }`}
                >
                  {confirmText}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
