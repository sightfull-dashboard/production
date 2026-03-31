import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  X,
  MessageSquare,
  FileText,
  AlertCircle,
  Check,
  ExternalLink,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { InternalNotification, User } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { appService } from '../services/appService';

interface InternalNotificationsProps {
  currentUser?: User;
  onNavigate?: (section: string, metadata?: any) => void;
}

const POLL_INTERVAL_MS = 60000;

const normalizeNotification = (notification: any): InternalNotification => ({
  id: String(notification?.id || ''),
  type: String(notification?.type || 'general') as InternalNotification['type'],
  title: String(notification?.title || 'Notification'),
  message: String(notification?.message || ''),
  created_at: String(notification?.created_at || new Date().toISOString()),
  updated_at: notification?.updated_at ? String(notification.updated_at) : undefined,
  read: Boolean(notification?.is_read ?? notification?.read),
  read_at: notification?.read_at ?? null,
  link: notification?.link ?? null,
  actor_user_id: notification?.actor_user_id ?? null,
  client_id: notification?.client_id ?? notification?.metadata?.client_id ?? null,
  metadata: typeof notification?.metadata === 'object' && notification.metadata !== null
    ? notification.metadata
    : {},
});

export const InternalNotifications: React.FC<InternalNotificationsProps> = ({ currentUser, onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<InternalNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const hasLoadedRef = useRef(false);

  const fetchNotifications = useCallback(async (options: { showLoading?: boolean } = {}) => {
    if (!currentUser || !['superadmin', 'staff'].includes(String(currentUser.role || '').toLowerCase())) {
      setNotifications([]);
      hasLoadedRef.current = false;
      return;
    }

    const { showLoading = !hasLoadedRef.current } = options;

    try {
      if (showLoading) setLoading(true);
      const data = await appService.getInternalNotifications();
      setNotifications((Array.isArray(data) ? data : []).map(normalizeNotification));
      hasLoadedRef.current = true;
    } catch (error) {
      console.error('Failed to load internal notifications:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void fetchNotifications({ showLoading: false });
  }, [fetchNotifications]);

  useEffect(() => {
    if (!currentUser || !['superadmin', 'staff'].includes(String(currentUser.role || '').toLowerCase())) {
      return;
    }

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void fetchNotifications({ showLoading: false });
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    const interval = window.setInterval(() => {
      if (isOpen || document.visibilityState === 'visible') {
        refresh();
      }
    }, POLL_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [currentUser, fetchNotifications, isOpen]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true, read_at: n.read_at || new Date().toISOString() } : n)));
    try {
      await appService.markInternalNotificationRead(id);
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      fetchNotifications();
    }
  }, [fetchNotifications]);

  const markAllAsRead = useCallback(async () => {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true, read_at: n.read_at || now })));
    try {
      await appService.markAllInternalNotificationsRead();
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      fetchNotifications();
    }
  }, [fetchNotifications]);

  const dismissNotification = useCallback(async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await appService.dismissInternalNotification(id);
    } catch (error) {
      console.error('Failed to dismiss notification:', error);
      fetchNotifications();
    }
  }, [fetchNotifications]);

  const handleNotificationClick = useCallback(async (notification: InternalNotification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    if (notification.type === 'support_tag' || notification.type === 'support_comment' || notification.type === 'support_resolved') {
      onNavigate?.('tickets', {
        ticketId: notification.metadata?.ticket_id,
        clientId: notification.client_id || notification.metadata?.client_id,
      });
    } else if (notification.type === 'payroll_submission') {
      onNavigate?.('notifications', {
        clientId: notification.client_id || notification.metadata?.client_id,
      });
    } else {
      onNavigate?.('internal', { clientId: notification.client_id || notification.metadata?.client_id });
    }

    setIsOpen(false);
  }, [markAsRead, onNavigate]);

  const getIcon = (type: string) => {
    switch (type) {
      case 'support_tag':
        return <MessageSquare className="w-4 h-4 text-indigo-600" />;
      case 'support_comment':
        return <MessageSquare className="w-4 h-4 text-sky-600" />;
      case 'support_resolved':
        return <ShieldCheck className="w-4 h-4 text-emerald-600" />;
      case 'payroll_submission':
        return <FileText className="w-4 h-4 text-emerald-600" />;
      case 'worker_failed':
      case 'system_alert':
        return <AlertCircle className="w-4 h-4 text-amber-600" />;
      default:
        return <Bell className="w-4 h-4 text-slate-600" />;
    }
  };

  if (!currentUser || !['superadmin', 'staff'].includes(String(currentUser.role || '').toLowerCase())) {
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          const nextOpen = !isOpen;
          setIsOpen(nextOpen);
          if (nextOpen) {
            void fetchNotifications({ showLoading: notifications.length === 0 });
          }
        }}
        className={cn(
          'relative p-3.5 rounded-full transition-all active:scale-95 shadow-xl border',
          isOpen
            ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-300/50'
            : 'bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 border-slate-200'
        )}
        aria-label="Open internal notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-rose-500 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-[80]"
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-16 right-0 w-[26rem] max-w-[calc(100vw-2rem)] bg-white rounded-[32px] shadow-2xl border border-slate-100 z-[90] overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div>
                  <h3 className="text-lg font-black text-slate-800 tracking-tight">Notifications</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Internal Updates</p>
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-700 transition-colors"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-[450px] overflow-y-auto no-scrollbar">
                {loading && notifications.length === 0 ? (
                  <div className="p-10 text-center text-xs font-bold uppercase tracking-widest text-slate-400">Loading notifications...</div>
                ) : notifications.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Bell className="w-8 h-8 text-slate-200" />
                    </div>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">All caught up!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={cn(
                          'p-5 transition-colors group relative',
                          notification.read ? 'opacity-70' : 'bg-indigo-50/30'
                        )}
                      >
                        <div className="flex gap-4">
                          <div className={cn(
                            'w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm',
                            notification.read ? 'bg-slate-100' : 'bg-white'
                          )}>
                            {getIcon(notification.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1 gap-3">
                              <h4 className="text-sm font-black text-slate-800 truncate">{notification.title}</h4>
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 font-medium leading-relaxed mb-3">
                              {notification.message}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleNotificationClick(notification)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[10px] font-black text-slate-600 uppercase tracking-widest hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm"
                              >
                                View Details
                                <ExternalLink className="w-3 h-3" />
                              </button>
                              {!notification.read && (
                                <button
                                  onClick={() => markAsRead(notification.id)}
                                  className="p-1.5 text-slate-400 hover:text-emerald-600 transition-colors"
                                  title="Mark as read"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => dismissNotification(notification.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors opacity-0 group-hover:opacity-100"
                                title="Dismiss"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                        {!notification.read && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-600" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
