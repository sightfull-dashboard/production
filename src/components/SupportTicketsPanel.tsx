import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Eye, ShieldCheck, Search, Filter, X, CheckCircle2, Clock, AlertCircle, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { Tooltip } from './Tooltip';
import { SupportTicket, User } from '../types';
import { Modal } from './Modal';
import { TicketDetailPage } from './TicketDetailPage';

interface SupportTicketsPanelProps {
  tickets: SupportTicket[];
  onUpdateTicket?: (ticket: SupportTicket) => void;
  onDeleteTicket?: (ticket: SupportTicket) => void | Promise<void>;
  clientScoped?: boolean;
  currentUser?: User;
}

export const SupportTicketsPanel: React.FC<SupportTicketsPanelProps> = ({ 
  tickets, 
  onUpdateTicket,
  onDeleteTicket,
  clientScoped = false,
  currentUser
}) => {
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>('all');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [view, setView] = useState<'list' | 'detail'>('list');

  const uniqueClients = useMemo(() => {
    const clients = new Map<string, string>();
    tickets.forEach(t => {
      if (t.client_id) {
        clients.set(t.client_id, t.client_name || t.client_id);
      }
    });
    return Array.from(clients.entries()).map(([id, name]) => ({ id, name }));
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    return tickets.filter(ticket => {
      const matchesFilter = 
        filter === 'all' ? true :
        filter === 'open' ? (ticket.status === 'open' || ticket.status === 'in_progress') :
        (ticket.status === 'resolved' || ticket.status === 'closed');
        
      const matchesSearch = 
        ticket.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.user_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.message.toLowerCase().includes(searchQuery.toLowerCase());
        
      const matchesClient = clientScoped || selectedClientFilter === 'all' || ticket.client_id === selectedClientFilter;
        
      return matchesFilter && matchesSearch && matchesClient;
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [tickets, filter, searchQuery, selectedClientFilter, clientScoped]);

  const handleTicketClick = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setView('detail');
  };

  const handleBack = () => {
    setView('list');
    setSelectedTicket(null);
  };

  const handleUpdateTicket = (updated: SupportTicket) => {
    if (onUpdateTicket) {
      onUpdateTicket(updated);
    }
    setSelectedTicket(updated);
  };

  const handleResolveTicket = (ticket: SupportTicket) => {
    if (!onUpdateTicket) return;
    onUpdateTicket({
      ...ticket,
      status: 'resolved',
      updated_at: new Date().toISOString()
    });
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent': return <AlertCircle className="w-4 h-4" />;
      case 'high': return <Clock className="w-4 h-4" />;
      default: return <MessageSquare className="w-4 h-4" />;
    }
  };

  if (view === 'detail' && selectedTicket && currentUser) {
    return (
      <TicketDetailPage 
        ticket={selectedTicket}
        onBack={handleBack}
        onUpdateTicket={handleUpdateTicket}
        currentUser={currentUser}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-2xl font-black text-slate-800 tracking-tight">Support Tickets</h3>
          <p className="text-sm text-slate-400 font-bold uppercase tracking-widest">{clientScoped ? 'Track tickets raised by this client only' : 'Manage client issues and requests'}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search tickets..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 pl-10 pr-4 py-2 rounded-xl bg-white border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none font-bold text-sm text-slate-700 placeholder:text-slate-400"
            />
          </div>
          {!clientScoped && (
            <select
              value={selectedClientFilter}
              onChange={(e) => setSelectedClientFilter(e.target.value)}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none font-bold text-sm text-slate-700"
            >
              <option value="all">All Clients</option>
              {uniqueClients.map(client => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          )}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            {(['all', 'open', 'resolved'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  filter === f ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredTickets.length > 0 ? (
          filteredTickets.map((ticket) => (
            <motion.div
              key={ticket.id}
              layoutId={`support-ticket-${ticket.id}`}
              onClick={() => handleTicketClick(ticket)}
              className="group bg-white p-6 rounded-[24px] border border-slate-100 hover:shadow-xl hover:shadow-indigo-900/5 transition-all cursor-pointer"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="flex items-start sm:items-center gap-4 flex-1">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                    ticket.priority === 'urgent' ? "bg-rose-100 text-rose-600" :
                    ticket.priority === 'high' ? "bg-amber-100 text-amber-600" :
                    "bg-indigo-100 text-indigo-600"
                  )}>
                    {getPriorityIcon(ticket.priority)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h4 className="font-black text-slate-800 truncate">{ticket.subject}</h4>
                      <span className={cn(
                        "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest",
                        ticket.status === 'open' ? "bg-indigo-100 text-indigo-600" :
                        ticket.status === 'in_progress' ? "bg-amber-100 text-amber-600" :
                        "bg-emerald-100 text-emerald-600"
                      )}>
                        {ticket.status.replace('_', '-')}
                      </span>
                      {ticket.priority === 'urgent' && (
                        <span className="px-2 py-0.5 bg-rose-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest animate-pulse">
                          Urgent
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 font-medium line-clamp-1">{ticket.message}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6 shrink-0">
                  <div className="hidden sm:block text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{clientScoped ? 'Raised By' : 'Client'}</p>
                    <p className="text-xs font-bold text-slate-700">{clientScoped ? ticket.user_email : (ticket.client_name || ticket.user_email)}</p>
                  </div>
                  <div className="hidden sm:block text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Date</p>
                    <p className="text-xs font-bold text-slate-700">{format(new Date(ticket.created_at), 'MMM d, h:mm a')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!clientScoped && ticket.status !== 'resolved' && ticket.status !== 'closed' && (currentUser?.role === 'superadmin' || currentUser?.permissions?.includes('resolve_tickets')) && (
                      <Tooltip content="Mark as Resolved">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResolveTicket(ticket);
                          }}
                          className="p-2.5 bg-slate-50 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 rounded-xl transition-all"
                        >
                          <CheckCircle2 className="w-5 h-5" />
                        </button>
                      </Tooltip>
                    )}
                    {onDeleteTicket && currentUser?.role === 'superadmin' && (
                      <Tooltip content="Delete Ticket">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTicket(ticket);
                          }}
                          className="p-2.5 bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-xl transition-all"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip content="View Details">
                      <button className="p-2.5 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl transition-all">
                        <Eye className="w-5 h-5" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        ) : (
          <div className="text-center py-16 bg-white rounded-[32px] border border-slate-100">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-black text-slate-800 mb-2">No tickets found</h3>
            <p className="text-sm text-slate-500 font-medium">There are no support tickets matching your current filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};
