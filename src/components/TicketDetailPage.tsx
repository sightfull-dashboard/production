import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  MessageSquare, 
  Send, 
  User as UserIcon, 
  Shield, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  AtSign,
  Loader2,
  Trash2
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { SupportTicket, TicketComment, User, InternalPermission } from '../types';
import { cn } from '../lib/utils';
import { appService } from '../services/appService';
import { toast } from 'sonner';

interface TicketDetailPageProps {
  ticket: SupportTicket;
  onBack: () => void;
  onUpdateTicket: (ticket: SupportTicket) => void;
  onDeleteTicket?: (ticket: SupportTicket) => void | Promise<void>;
  currentUser: User;
}

export const TicketDetailPage: React.FC<TicketDetailPageProps> = ({ 
  ticket, 
  onBack, 
  onUpdateTicket,
  onDeleteTicket,
  currentUser
}) => {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loadingComments, setLoadingComments] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [internalUsers, setInternalUsers] = useState<User[]>([]);
  const [loadingInternalUsers, setLoadingInternalUsers] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchComments();
    setInternalUsers([]);
  }, [ticket.id]);

  const fetchComments = async () => {
    try {
      const data = await appService.getTicketComments(ticket.id);
      setComments(data);
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  const fetchInternalUsers = async () => {
    if (loadingInternalUsers) return;
    try {
      setLoadingInternalUsers(true);
      const data = await appService.getInternalMentionableUsers(ticket.client_id);
      setInternalUsers(data);
    } catch (err) {
      console.error('Failed to fetch internal users:', err);
    } finally {
      setLoadingInternalUsers(false);
    }
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const position = e.target.selectionStart;
    setNewComment(value);
    setCursorPosition(position);

    // Check for tagging
    const lastAt = value.lastIndexOf('@', position - 1);
    if (lastAt !== -1) {
      const textAfterAt = value.substring(lastAt + 1, position);
      if (!textAfterAt.includes(' ')) {
        setTagSearch(textAfterAt);
        setShowTagDropdown(true);
        if ((currentUser?.role === 'superadmin' || currentUser?.permissions?.includes('view_tickets')) && internalUsers.length === 0 && !loadingInternalUsers) {
          void fetchInternalUsers();
        }
        return;
      }
    }
    setShowTagDropdown(false);
  };

  const handleSelectUser = (user: User) => {
    const lastAt = newComment.lastIndexOf('@', cursorPosition - 1);
    const before = newComment.substring(0, lastAt);
    const after = newComment.substring(cursorPosition);
    const name = user.full_name || user.email;
    const updatedComment = `${before}@${name} ${after}`;
    setNewComment(updatedComment);
    setShowTagDropdown(false);
    textareaRef.current?.focus();
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || submitting) return;

    setSubmitting(true);
    try {
      const taggedUsers = internalUsers
        .filter(u => newComment.includes(`@${u.full_name || u.email}`))
        .map(u => u.id);

      const comment = await appService.addTicketComment(ticket.id, {
        message: newComment,
        tagged_users: taggedUsers,
        user_id: currentUser.id,
        user_name: currentUser.full_name || currentUser.email,
        user_email: currentUser.email,
        role: currentUser.role,
        created_at: new Date().toISOString()
      });

      setComments(prev => [...prev, comment]);
      setNewComment('');
      toast.success('Comment added');
    } catch (err) {
      console.error('Failed to add comment:', err);
      toast.error('Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async () => {
    try {
      const updated = await appService.updateSupportTicket(ticket.id, {
        status: 'resolved',
        updated_at: new Date().toISOString()
      });
      onUpdateTicket(updated);
      toast.success('Ticket marked as resolved');
    } catch (err) {
      console.error('Failed to resolve ticket:', err);
      toast.error('Failed to resolve ticket');
    }
  };

  const filteredUsers = internalUsers.filter(u => 
    (u.full_name || u.email).toLowerCase().includes(tagSearch.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-3 rounded-2xl bg-white border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-100 transition-all active:scale-95"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-black text-slate-800 tracking-tight">{ticket.subject}</h2>
              <span className={cn(
                "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                ticket.status === 'open' ? "bg-indigo-100 text-indigo-600" :
                ticket.status === 'in_progress' ? "bg-amber-100 text-amber-600" :
                "bg-emerald-100 text-emerald-600"
              )}>
                {ticket.status.replace('_', '-')}
              </span>
            </div>
            <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Ticket #{ticket.id.substring(0, 8)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onDeleteTicket && currentUser?.role === 'superadmin' && (
            <button
              onClick={() => onDeleteTicket(ticket)}
              className="px-6 py-3 rounded-2xl bg-rose-600 text-white font-black text-sm hover:bg-rose-700 shadow-xl shadow-rose-100 transition-all active:scale-95 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Ticket
            </button>
          )}
          {ticket.status !== 'resolved' && (currentUser?.role === 'superadmin' || currentUser?.permissions?.includes('resolve_tickets')) && (
            <button 
              onClick={handleResolve}
              className="px-6 py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all active:scale-95 flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Mark Resolved
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Ticket Info & Original Message */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</p>
                <p className="text-sm font-bold text-slate-700">{ticket.client_name || 'Unknown Client'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Requested By</p>
                <p className="text-sm font-bold text-slate-700">{ticket.user_email}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Created At</p>
                <p className="text-sm font-bold text-slate-700">{format(new Date(ticket.created_at), 'MMM d, yyyy h:mm a')}</p>
              </div>
            </div>

            <div className="pt-8 border-t border-slate-100">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Original Message
              </h4>
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed font-medium">
                  {ticket.message}
                </p>
              </div>
            </div>
          </div>

          {/* Comments Section */}
          <div className="space-y-6">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <MessageSquare className="w-6 h-6 text-indigo-600" />
              Internal Discussion
            </h3>

            <div className="space-y-4">
              {loadingComments ? (
                <div className="py-12 text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
                  <p className="mt-4 text-slate-500 font-bold">Loading discussion...</p>
                </div>
              ) : comments.length === 0 ? (
                <div className="py-12 text-center bg-white rounded-[32px] border border-slate-100">
                  <MessageSquare className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-500 font-bold">No internal comments yet.</p>
                  <p className="text-xs text-slate-400">Start the conversation below.</p>
                </div>
              ) : (
                comments.map((comment) => (
                  <motion.div 
                    key={comment.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white p-6 rounded-[24px] shadow-sm border border-slate-100 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 font-black text-xs">
                          {comment.user_name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-800">{comment.user_name}</p>
                          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{comment.role}</p>
                        </div>
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        {format(new Date(comment.created_at), 'MMM d, h:mm a')}
                      </p>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed font-medium whitespace-pre-wrap">
                      {comment.message.split(/(@\w+)/g).map((part, i) => {
                        if (part.startsWith('@')) {
                          return <span key={i} className="text-indigo-600 font-black">{part}</span>;
                        }
                        return part;
                      })}
                    </p>
                  </motion.div>
                ))
              )}
            </div>

            {/* Add Comment */}
            <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20 relative">
              <form onSubmit={handleSubmitComment} className="space-y-4">
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={newComment}
                    onChange={handleCommentChange}
                    placeholder="Type your message... Use @ to tag teammates"
                    className="w-full h-32 p-6 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 outline-none resize-none font-medium text-sm transition-all"
                  />
                  
                  <AnimatePresence>
                    {showTagDropdown && filteredUsers.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-full left-0 mb-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-50"
                      >
                        <div className="p-3 border-b border-slate-50 bg-slate-50/50">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tag Teammate</p>
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {filteredUsers.map(user => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => handleSelectUser(user)}
                              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-indigo-50 transition-colors text-left"
                            >
                              <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 font-black text-[10px]">
                                {(user.full_name || user.email).substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-xs font-black text-slate-800">{user.full_name || user.email}</p>
                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{user.role}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-400">
                    <AtSign className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Tag teammates for help</span>
                  </div>
                  <button
                    type="submit"
                    disabled={!newComment.trim() || submitting}
                    className="px-8 py-3 rounded-2xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send Message
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Right Column: Sidebar Info */}
        <div className="space-y-8">
          <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20 space-y-8">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Ticket Status</h4>
            
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                  ticket.priority === 'urgent' ? "bg-rose-100 text-rose-600" :
                  ticket.priority === 'high' ? "bg-amber-100 text-amber-600" :
                  "bg-indigo-100 text-indigo-600"
                )}>
                  {ticket.priority === 'urgent' ? <AlertCircle className="w-6 h-6" /> : 
                   ticket.priority === 'high' ? <Clock className="w-6 h-6" /> : 
                   <MessageSquare className="w-6 h-6" />}
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Priority</p>
                  <p className="text-sm font-black text-slate-800 uppercase tracking-widest">{ticket.priority}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0 text-slate-400">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Updated</p>
                  <p className="text-sm font-black text-slate-800">{format(new Date(ticket.updated_at), 'MMM d, h:mm a')}</p>
                </div>
              </div>
            </div>

            <div className="pt-8 border-t border-slate-100 space-y-4">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Internal Help</h4>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Need assistance? Tag a Super Admin or another Staff member in the comments to bring them into this ticket.
              </p>
              <div className="flex flex-wrap gap-2">
                {internalUsers.slice(0, 5).map(user => (
                  <div key={user.id} className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 font-black text-[10px]" title={user.full_name || user.email}>
                    {(user.full_name || user.email).substring(0, 2).toUpperCase()}
                  </div>
                ))}
                {internalUsers.length > 5 && (
                  <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 font-black text-[10px]">
                    +{internalUsers.length - 5}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
