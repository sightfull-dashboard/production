import React, { useEffect, useState } from 'react';
import { 
  Building2, 
  Plus, 
  Users, 
  Files, 
  BarChart3, 
  Settings, 
  MoreVertical,
  Search,
  Upload,
  Trash2,
  Edit2,
  Folder,
  FileText,
  ChevronRight,
  ArrowLeft,
  Activity,
  History,
  Clock,
  User,
  ShieldCheck,
  Calendar,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
  RefreshCw,
  Lock,
  Unlock,
  LayoutDashboard,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  ArrowUpRight,
  Zap,
  Shield,
  HardDrive,
  MessageSquare,
  Bell,
  ArrowRight,
  Home
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import type { FileItem, PayrollSubmission, SupportTicket } from '../types';
import { BrandedState } from './BrandedStates';
import { Tooltip } from './Tooltip';
import { toast } from 'sonner';
import { adminService } from '../services/adminService';
import { appService } from '../services/appService';
import { SupportTicketsPanel } from './SupportTicketsPanel';
import { ClientNotificationsPanel } from './ClientNotificationsPanel';
import { INTERNAL_PANEL_ROSTER_DEFINITIONS as ROSTER_DEFINITIONS, PRESET_CLIENT_LOGOS } from './internal-panel/config';


interface InternalPanelProps {
  onLoginAsSuperAdmin?: (client: any) => void;
}

export const InternalPanel: React.FC<InternalPanelProps> = ({ onLoginAsSuperAdmin }) => {
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'files' | 'logs' | 'settings' | 'activity' | 'payroll_logs' | 'support_tickets' | 'payroll_notifications'>('overview');
  
  const [clientUsers, setClientUsers] = useState<any[]>([]);
  const [clientFiles, setClientFiles] = useState<any[]>([]);
  const [clientLogs, setClientLogs] = useState<any[]>([]);
  const [payrollLogs, setPayrollLogs] = useState<any[]>([]);
  const [clientSupportTickets, setClientSupportTickets] = useState<SupportTicket[]>([]);
  const [clientPayrollNotifications, setClientPayrollNotifications] = useState<PayrollSubmission[]>([]);
  const [loadingClientData, setLoadingClientData] = useState(false);
  const [logSearchTerm, setLogSearchTerm] = useState('');
  const [payrollLogSearchTerm, setPayrollLogSearchTerm] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [fileBackHistory, setFileBackHistory] = useState<(string | null)[]>([]);
  const [fileForwardHistory, setFileForwardHistory] = useState<(string | null)[]>([]);

  // Client Settings State
  const [rosterStartDay, setRosterStartDay] = useState<number>(1); // Monday
  const [rosterDuration, setRosterDuration] = useState<'1_week' | '2_weeks' | '1_month'>('1_week');
  const [enabledDefinitions, setEnabledDefinitions] = useState<RosterDefinition[]>(['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes']);
  const [dashboardType, setDashboardType] = useState<'rostering' | 'non-rostering'>('rostering');
  const [lockedFeatures, setLockedFeatures] = useState<string[]>([]);
  const [settingsTab, setSettingsTab] = useState<'general' | 'rostering' | 'features'>('general');
  const [isTrial, setIsTrial] = useState<boolean>(false);
  const [trialDuration, setTrialDuration] = useState<3 | 5 | 7>(7);
  const [payrollEmail, setPayrollEmail] = useState<string>('');
  const [payrollCc, setPayrollCc] = useState<string>('');
  const [payrollSubmissionDay, setPayrollSubmissionDay] = useState<number>(1); // Default to Monday or 1st

  const filteredPayrollLogs = payrollLogs.filter((submission: any) => {
    const query = payrollLogSearchTerm.trim().toLowerCase();
    if (!query) return true;
    return [
      submission?.id,
      submission?.clientName,
      submission?.client_name,
      submission?.submittedBy,
      submission?.submitted_by,
      submission?.period,
      submission?.status,
      submission?.processedBy,
      submission?.processed_by,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });


  const fetchClients = async () => {
    try {
      const data = await adminService.getClients();
      setClients(data);
    } catch (error) {
      console.error('Failed to fetch clients:', error);
      toast.error('Failed to load client dashboards');
      setClients([]);
    }
  };

  useEffect(() => {
    void fetchClients();
  }, []);

  React.useEffect(() => {
    if (selectedClient) {
      setLockedFeatures(selectedClient.lockedFeatures || []);
      setDashboardType(selectedClient.dashboardType || 'rostering');
      setIsTrial(selectedClient.isTrial || false);
      setTrialDuration(selectedClient.trialDuration || 7);
      setPayrollEmail(selectedClient.payrollEmail || '');
      setPayrollCc(selectedClient.payrollCc || '');
      setPayrollSubmissionDay(selectedClient.payrollSubmissionDay || 1);
      setRosterStartDay(selectedClient.rosterStartDay ?? 1);
      setRosterDuration(selectedClient.rosterDuration || '1_week');
      setEnabledDefinitions(selectedClient.enabledDefinitions || ['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes']);
      setClientFallbackImage(selectedClient.fallbackImage || null);
    }
  }, [selectedClient]);

  useEffect(() => {
    const loadClientData = async () => {
      if (!selectedClient?.id) {
        setClientUsers([]);
        setClientFiles([]);
        setClientLogs([]);
        setPayrollLogs([]);
        setClientSupportTickets([]);
        setClientPayrollNotifications([]);
        navigateClientFolder(null, { pushHistory: false });
        return;
      }
      setLoadingClientData(true);
      try {
        const [usersResult, filesResult, logsResult, payrollResult, supportResult, notificationsResult] = await Promise.allSettled([
          adminService.getClientUsers(selectedClient.id),
          adminService.getClientFiles(selectedClient.id),
          adminService.getClientLogs(selectedClient.id),
          adminService.getClientPayrollLogs(selectedClient.id),
          appService.getSupportTickets(),
          appService.getPayrollSubmissions(),
        ]);

        const users = usersResult.status === 'fulfilled' ? usersResult.value : [];
        const files = filesResult.status === 'fulfilled' ? filesResult.value : [];
        const logs = logsResult.status === 'fulfilled' ? logsResult.value : [];
        const payroll = payrollResult.status === 'fulfilled' ? payrollResult.value : [];
        const supportTickets = supportResult.status === 'fulfilled'
          ? supportResult.value.filter((ticket: SupportTicket) => ticket.client_id === selectedClient.id || ticket.client_name === selectedClient.name)
          : [];
        const payrollNotifications = notificationsResult.status === 'fulfilled'
          ? notificationsResult.value.filter((submission: PayrollSubmission) => submission.clientName === selectedClient.name)
          : [];

        setClientUsers(users);
        setClientFiles(files);
        setClientLogs(logs);
        setPayrollLogs(payroll);
        setClientSupportTickets(supportTickets);
        setClientPayrollNotifications(payrollNotifications);
        navigateClientFolder(null, { pushHistory: false });

        const failures = [usersResult, filesResult, logsResult, payrollResult, supportResult, notificationsResult].filter(result => result.status === 'rejected');
        if (failures.length > 0) {
          console.error('Failed to load some selected client data:', failures);
          toast.error('Some client details could not be loaded');
        }
      } catch (error) {
        console.error('Failed to load selected client data:', error);
        toast.error('Failed to load selected client details');
        setClientUsers([]);
        setClientFiles([]);
        setClientLogs([]);
        setPayrollLogs([]);
        setClientSupportTickets([]);
        setClientPayrollNotifications([]);
      } finally {
        setLoadingClientData(false);
      }
    };

    void loadClientData();
  }, [selectedClient?.id, selectedClient?.name]);


  useEffect(() => {
    if (!selectedClient && (activeTab === 'support_tickets' || activeTab === 'payroll_notifications')) {
      setActiveTab('overview');
    }
  }, [selectedClient, activeTab]);


  const navigateClientFolder = (folderId: string | null, options: { pushHistory?: boolean } = {}) => {
    const { pushHistory = true } = options;
    if (!pushHistory) {
      setFileBackHistory([]);
      setFileForwardHistory([]);
      setCurrentFolderId(folderId);
      return;
    }
    setCurrentFolderId(prev => {
      if (prev === folderId) return prev;
      setFileBackHistory(history => [...history, prev]);
      setFileForwardHistory([]);
      return folderId;
    });
  };

  const handleClientFilesBack = () => {
    setFileBackHistory(history => {
      if (history.length === 0) return history;
      const previous = history[history.length - 1];
      setFileForwardHistory(forward => [currentFolderId, ...forward]);
      setCurrentFolderId(previous);
      return history.slice(0, -1);
    });
  };

  const handleClientFilesForward = () => {
    setFileForwardHistory(history => {
      if (history.length === 0) return history;
      const [next, ...rest] = history;
      setFileBackHistory(back => [...back, currentFolderId]);
      setCurrentFolderId(next);
      return rest;
    });
  };

  const getClientFolderPath = () => {
    if (!currentFolderId) return [] as FileItem[];
    const byId = new Map<string, FileItem>(clientFiles.map((file) => [file.id, file]));
    const path: FileItem[] = [];
    let cursor: string | null = currentFolderId;
    const visited = new Set<string>();
    while (cursor && byId.has(cursor) && !visited.has(cursor)) {
      visited.add(cursor);
      const current = byId.get(cursor);
      if (!current) break;
      path.unshift(current);
      cursor = current.parent_id || null;
    }
    return path;
  };

  const toggleFeatureLock = (feature: string) => {
    setLockedFeatures(prev => 
      prev.includes(feature) ? prev.filter(f => f !== feature) : [...prev, feature]
    );
  };

  const toggleDefinition = (id: RosterDefinition) => {
    setEnabledDefinitions(prev => 
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const formatDetails = (detailsStr: any) => {
    try {
      const details = typeof detailsStr === 'string' ? JSON.parse(detailsStr) : detailsStr;
      if (!details || typeof details !== 'object') return String(detailsStr || '-');
      if (Object.keys(details).length === 0) return '-';
      return (
        <div className="text-xs space-y-1">
          {Object.entries(details).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="font-medium text-slate-500">{k}:</span>
              <span className="text-slate-700 truncate max-w-[200px]" title={String(v)}>{String(v)}</span>
            </div>
          ))}
        </div>
      );
    } catch {
      return typeof detailsStr === 'string' ? detailsStr : JSON.stringify(detailsStr ?? '-');
    }
  };

  // Modals
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [isUploadFileModalOpen, setIsUploadFileModalOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<any | null>(null);
  const [clientFallbackImage, setClientFallbackImage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');

  const generatePassword = () => {
    const length = 12;
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
      retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    setGeneratedPassword(retVal);
    return retVal;
  };

  const selectPresetClientLogo = (src: string) => {
    setClientFallbackImage(src);
  };

  const clearClientFallbackImage = () => {
    setClientFallbackImage(null);
  };

  const handleCreateClient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newClient = {
      name: formData.get('name') as string,
      fallbackImage: clientFallbackImage,
      status: 'active',
      dashboardType: 'rostering',
      lockedFeatures: [],
      enabledDefinitions,
      rosterStartDay,
      rosterDuration,
      isTrial,
      trialDuration,
      payrollEmail,
      payrollCc,
      payrollSubmissionDay,
    };

    try {
      await adminService.createClient(newClient);
      await fetchClients();
      setIsNewClientModalOpen(false);
      setClientFallbackImage(null);
      toast.success('Client created successfully');
    } catch (error) {
      console.error('Failed to create client:', error);
      toast.error('Failed to create client');
    }
  };

  const handleAddUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedClient) return;
    const formData = new FormData(e.currentTarget);
    const payload = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      role: formData.get('role') as string,
      password: formData.get('password') as string,
    };

    try {
      if (editingUser) {
        const updated = await adminService.updateClientUser(selectedClient.id, editingUser.id, payload);
        setClientUsers(clientUsers.map(u => u.id === editingUser.id ? updated : u));
        toast.success('User updated successfully');
      } else {
        const created = await adminService.createClientUser(selectedClient.id, payload);
        setClientUsers([created, ...clientUsers]);
        toast.success('User added successfully');
      }
      setIsNewUserModalOpen(false);
      setEditingUser(null);
      setShowPassword(false);
      setGeneratedPassword('');
    } catch (error: any) {
      console.error('Failed to save user:', error);
      toast.error(error?.message || 'Failed to save user');
    }
  };

  const handleUploadFile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedClient) return;
    const formData = new FormData(e.currentTarget);
    const password = formData.get('password') as string;

    try {
      if (editingFile) {
        const updated = await adminService.updateClientFile(selectedClient.id, editingFile.id, {
          name: formData.get('name') as string,
          password: editingFile.type === 'folder' ? password : editingFile.password,
        });
        setClientFiles(clientFiles.map(f => f.id === editingFile.id ? updated : f));
        toast.success('File updated successfully');
      } else {
        const fileInput = formData.get('file') as File;
        const isFolder = formData.get('type') === 'folder';
        if (isFolder) {
          const created = await adminService.createClientFile(selectedClient.id, {
            name: formData.get('name') as string,
            type: 'folder',
            parent_id: currentFolderId,
            password: password || null,
          });
          setClientFiles([created, ...clientFiles]);
        } else if (fileInput && fileInput.name) {
          const fileUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(fileInput);
          });
          const created = await adminService.createClientFile(selectedClient.id, {
            name: fileInput.name,
            type: 'file',
            size: `${(fileInput.size / 1024 / 1024).toFixed(2)} MB`,
            extension: fileInput.name.split('.').pop() || 'file',
            parent_id: currentFolderId,
            url: fileUrl,
          });
          setClientFiles([created, ...clientFiles]);
        }
        toast.success('File saved successfully');
      }
      setIsUploadFileModalOpen(false);
      setEditingFile(null);
    } catch (error: any) {
      console.error('Failed to save file:', error);
      toast.error(error?.message || 'Failed to save file');
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!selectedClient) return;
    try {
      await adminService.deleteClientUser(selectedClient.id, id);
      setClientUsers(clientUsers.filter(u => u.id !== id));
      toast.success('User deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete user:', error);
      toast.error(error?.message || 'Failed to delete user');
    }
  };

  const handleDeleteFile = async (id: string) => {
    if (!selectedClient) return;
    try {
      await adminService.deleteClientFile(selectedClient.id, id);
      setClientFiles(clientFiles.filter(f => f.id !== id));
      toast.success('File deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete file:', error);
      toast.error(error?.message || 'Failed to delete file');
    }
  };

  const handleDeleteClientDashboard = async () => {
    if (!selectedClient) return;

    const confirmed = window.confirm(`Are you sure you want to permanently remove the ${selectedClient.name} dashboard? This action cannot be undone.`);
    if (!confirmed) return;

    const passphrase = window.prompt('Type DELETE to permanently remove this dashboard.');
    if (passphrase === null) return;

    try {
      await adminService.deleteClient(selectedClient.id, passphrase);
      toast.success('Client dashboard removed successfully');
      setSelectedClient(null);
      setClientUsers([]);
      setClientFiles([]);
      setClientLogs([]);
      setPayrollLogs([]);
      await fetchClients();
    } catch (error: any) {
      console.error('Failed to delete client dashboard:', error);
      toast.error(error?.message || 'Failed to delete client dashboard');
    }
  };

  const handleFallbackImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setClientFallbackImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const renderClientList = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-4xl font-black text-slate-800 tracking-tight">Super Admin</h2>
          <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">System Management</p>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search clients..." 
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-indigo-600/20 outline-none font-bold text-sm text-slate-700 placeholder:text-slate-400"
              />
            </div>
            <Tooltip content="Create a new client dashboard">
              <button 
                onClick={() => { setClientFallbackImage(null); setIsNewClientModalOpen(true); }}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" />
                New Dashboard
              </button>
            </Tooltip>
          </div>
          <div className="overflow-x-auto">
            {clients.length === 0 ? (
              <BrandedState 
                type="empty" 
                portal="superadmin" 
                title="No Clients Found" 
                message="No client dashboards have been created yet." 
                action={{ label: 'New Dashboard', onClick: () => setIsNewClientModalOpen(true) }}
              />
            ) : (
              <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                  <th className="px-8 py-6">Client Name</th>
                  <th className="px-8 py-6">Status</th>
                  <th className="px-8 py-6">Users</th>
                  <th className="px-8 py-6">Files</th>
                  <th className="px-8 py-6">Last Active</th>
                  <th className="px-8 py-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map(client => (
                  <tr 
                    key={client.id} 
                    className="hover:bg-indigo-50/30 transition-colors group cursor-pointer"
                  >
                    <td className="px-8 py-6" onClick={() => { setSelectedClient(client); }}>
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-indigo-600 font-black text-xs overflow-hidden p-1">
                          {client.fallbackImage ? (
                            <img src={client.fallbackImage} alt="" className="w-full h-full object-contain bg-white p-1" />
                          ) : (
                            client.name.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <span className="text-sm font-bold text-slate-800">{client.name}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6" onClick={() => setSelectedClient(client)}>
                      <span className={cn(
                        "inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                        client.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'
                      )}>
                        {client.status}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-sm font-bold text-slate-600" onClick={() => setSelectedClient(client)}>{client.users}</td>
                    <td className="px-8 py-6 text-sm font-bold text-slate-600" onClick={() => setSelectedClient(client)}>{client.files}</td>
                    <td className="px-8 py-6 text-sm font-bold text-slate-500" onClick={() => setSelectedClient(client)}>{client.lastActive}</td>
                    <td className="px-8 py-6 text-right">
                      <Tooltip content="View Client Details">
                        <button 
                          onClick={() => setSelectedClient(client)}
                          className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-indigo-600 transition-colors shadow-sm"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  const renderClientDetail = () => (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Tooltip content="Back to Client List">
          <button 
            onClick={() => setSelectedClient(null)}
            className="p-3 bg-white rounded-2xl hover:bg-slate-50 transition-colors shadow-sm border border-slate-100 text-slate-400 hover:text-slate-600"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        </Tooltip>
        <div className="space-y-1">
          <h2 className="text-4xl font-black text-slate-800 tracking-tight">{selectedClient.name}</h2>
          <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Dashboard Management</p>{loadingClientData && <p className="text-xs text-indigo-600 font-bold">Loading live client data…</p>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Tooltip content="Access this client's dashboard with full admin privileges">
            <button 
              onClick={() => onLoginAsSuperAdmin?.({ ...selectedClient, lockedFeatures, dashboardType })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95"
            >
              <ShieldCheck className="w-4 h-4" />
              Login as Super Admin
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex gap-2 p-1.5 bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-slate-100 w-fit">
        {[
          { id: 'overview', icon: BarChart3, label: 'Overview' },
          { id: 'users', icon: Users, label: 'Users' },
          { id: 'files', icon: Files, label: 'Files' },
          { id: 'activity', icon: Activity, label: 'Activity Logs' },
          { id: 'support_tickets', icon: MessageSquare, label: 'Support Tickets' },
          { id: 'payroll_notifications', icon: Bell, label: 'Payroll Notifications' },
          { id: 'payroll_logs', icon: History, label: 'Payroll Logs' },
          { id: 'settings', icon: Settings, label: 'Settings' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all",
              activeTab === tab.id 
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Top Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white/80 backdrop-blur-md rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Users className="w-24 h-24 text-indigo-600" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center">
                      <Users className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest">
                      <ArrowUpRight className="w-3 h-3" />
                      +12%
                    </div>
                  </div>
                  <h3 className="text-4xl font-black text-slate-800 mb-1">{selectedClient.data.employees}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Employees</p>
                </div>
              </div>
              <div className="bg-white/80 backdrop-blur-md rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <BarChart3 className="w-24 h-24 text-emerald-600" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
                      <BarChart3 className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest">
                      <TrendingUp className="w-3 h-3" />
                      Active
                    </div>
                  </div>
                  <h3 className="text-4xl font-black text-slate-800 mb-1">{selectedClient.data.shiftsThisWeek}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Shifts This Week</p>
                </div>
              </div>
              <div className="bg-white/80 backdrop-blur-md rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <FileText className="w-24 h-24 text-amber-600" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center">
                      <FileText className="w-6 h-6 text-amber-600" />
                    </div>
                  </div>
                  <h3 className="text-4xl font-black text-slate-800 mb-1">{selectedClient.data.totalHours}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Hours Logged</p>
                </div>
              </div>
            </div>

            {/* Dashboard Pulse Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">Dashboard Pulse</h4>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Live Status</span>
                  <div className="h-4 w-px bg-slate-200" />
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    System Secure
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                  <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                    <Users className="w-24 h-24 text-indigo-600" />
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Users className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Users</p>
                      <p className="text-lg font-black text-slate-800">{clientUsers.length}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold">
                      <span className="text-slate-400">Last 24h</span>
                      <span className="text-indigo-600">85% Activity</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: '85%' }}
                        className="h-full bg-indigo-500 rounded-full" 
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                  <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                    <ShieldCheck className="w-24 h-24 text-emerald-600" />
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Payroll Status</p>
                      <p className="text-lg font-black text-slate-800">Healthy</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold">
                      <span className="text-slate-400">Compliance</span>
                      <span className="text-emerald-600">100% Verified</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        className="h-full bg-emerald-500 rounded-full" 
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                  <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                    <HardDrive className="w-24 h-24 text-amber-600" />
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <HardDrive className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Storage Used</p>
                      <p className="text-lg font-black text-slate-800">{clientFiles.length} Files</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold">
                      <span className="text-slate-400">Quota Used</span>
                      <span className="text-amber-600">12% of 100MB</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: '12%' }}
                        className="h-full bg-amber-500 rounded-full" 
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                  <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                    <Bell className="w-24 h-24 text-rose-600" />
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Bell className="w-5 h-5 text-rose-600" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Notifications</p>
                      <p className="text-lg font-black text-slate-800">2 Pending</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold">
                      <span className="text-slate-400">Action Required</span>
                      <span className="text-rose-600">Urgent</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: '40%' }}
                        className="h-full bg-rose-500 rounded-full" 
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Detailed Dashboard Information */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white/80 backdrop-blur-md rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20">
                <div className="flex items-center justify-between mb-8">
                  <div className="space-y-1">
                    <h4 className="font-black text-slate-800 uppercase tracking-widest text-xs">Live Dashboard Feed</h4>
                    <p className="text-xs text-slate-400 font-bold">A real-time stream of events from this client's portal</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {clientUsers.slice(0, 3).map((user, i) => (
                        <div key={i} className="w-6 h-6 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-600">
                          {user.email[0].toUpperCase()}
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">+{clientUsers.length - 3} more active</span>
                  </div>
                </div>
                <div className="space-y-4">
                  {clientLogs.slice(0, 6).map((log, i) => (
                    <motion.div 
                      key={log.id} 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/50 border border-slate-100 hover:border-indigo-100 hover:bg-white hover:shadow-sm transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center shadow-sm transition-colors",
                          log.action.includes('LOGIN') ? "bg-indigo-50 text-indigo-600" : 
                          log.action.includes('PAYROLL') ? "bg-emerald-50 text-emerald-600" :
                          log.action.includes('FILE') ? "bg-amber-50 text-amber-600" : "bg-white text-slate-400"
                        )}>
                          {log.action.includes('LOGIN') ? <Lock className="w-4 h-4" /> : 
                           log.action.includes('PAYROLL') ? <ShieldCheck className="w-4 h-4" /> :
                           log.action.includes('FILE') ? <Files className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-slate-800">{log.action.replace(/_/g, ' ')}</p>
                            {i === 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 text-[8px] font-black uppercase tracking-tighter">New</span>
                            )}
                          </div>
                          <p className="text-[10px] font-bold text-slate-400">{log.user_email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        <p className="text-[9px] font-bold text-slate-400">{new Date(log.created_at).toLocaleDateString()}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
                <button 
                  onClick={() => setActiveTab('activity')}
                  className="w-full mt-6 py-3 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:border-indigo-200 hover:text-indigo-600 transition-all"
                >
                  View Full Activity History
                </button>
              </div>

              <div className="space-y-6">
                <div className="bg-white/80 backdrop-blur-md rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20">
                  <h4 className="font-black text-slate-800 uppercase tracking-widest text-xs mb-6">System Health</h4>
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <Shield className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Security Status</p>
                        <p className="text-xs font-bold text-slate-800">All Systems Operational</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                        <RefreshCw className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Last Backup</p>
                        <p className="text-xs font-bold text-slate-800">Today, 04:00 AM</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Support Tickets</p>
                        <p className="text-xs font-bold text-slate-800">0 Open Tickets</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-indigo-600 rounded-[32px] p-8 shadow-xl shadow-indigo-200 border border-indigo-500 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                    <Zap className="w-20 h-20 text-white" />
                  </div>
                  <div className="relative z-10">
                    <h4 className="font-black text-white uppercase tracking-widest text-[10px] mb-2 opacity-80">Quick Action</h4>
                    <p className="text-white font-bold text-sm mb-6 leading-tight">Need to assist this client directly?</p>
                    <button 
                      onClick={() => onLoginAsSuperAdmin?.(selectedClient)}
                      className="w-full py-3 bg-white text-indigo-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-50 transition-colors shadow-lg"
                    >
                      Login as Admin
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Status Bar */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-3 px-6 py-4 bg-white/60 backdrop-blur-md rounded-2xl border border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <LayoutDashboard className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dashboard Type</p>
                  <p className="text-xs font-bold text-slate-800">{selectedClient.dashboardType === 'rostering' ? 'Rostering Enabled' : 'Basic Mode'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-6 py-4 bg-white/60 backdrop-blur-md rounded-2xl border border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Client Since</p>
                  <p className="text-xs font-bold text-slate-800">{new Date(selectedClient.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-800">Dashboard Users</h3>
              <Tooltip content="Add a new user to this client dashboard">
                <button 
                  onClick={() => { setEditingUser(null); setIsNewUserModalOpen(true); }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add User
                </button>
              </Tooltip>
            </div>
            {clientUsers.length === 0 ? (
              <BrandedState 
                type="empty" 
                portal="superadmin" 
                title="No Users" 
                message="No users have been added to this client dashboard." 
                action={{ label: 'Add User', onClick: () => { setEditingUser(null); setIsNewUserModalOpen(true); } }}
              />
            ) : (
              <div className="overflow-x-auto">
                <div className="pl-8 pr-8 pb-4">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                        <th className="px-8 py-4">Name</th>
                        <th className="px-8 py-4">Role</th>
                        <th className="px-8 py-4">Last Login</th>
                        <th className="px-8 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {clientUsers.map(user => (
                        <tr key={user.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-800">{user.name}</span>
                              <span className="text-xs font-medium text-slate-500">{user.email}</span>
                            </div>
                          </td>
                          <td className="px-8 py-4">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest">
                              {user.role}
                            </span>
                          </td>
                          <td className="px-8 py-4 text-sm font-bold text-slate-500">{user.lastLogin}</td>
                          <td className="px-8 py-4 text-right">
                            <div className="flex items-center justify-end gap-2 transition-opacity">
                              <Tooltip content="Edit User">
                                <button 
                                  onClick={() => { setEditingUser(user); setIsNewUserModalOpen(true); }} 
                                  className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-indigo-600 transition-colors shadow-sm"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              </Tooltip>
                              <Tooltip content="Delete User">
                                <button 
                                  onClick={() => handleDeleteUser(user.id)} 
                                  className="p-2 hover:bg-rose-50 rounded-xl text-slate-400 hover:text-rose-600 transition-colors shadow-sm"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'files' && (
          <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-black text-slate-800">Client Files</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleClientFilesBack}
                      disabled={fileBackHistory.length === 0}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleClientFilesForward}
                      disabled={fileForwardHistory.length === 0}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar text-xs font-black uppercase tracking-widest text-slate-400">
                  <button type="button" onClick={() => navigateClientFolder(null)} className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-slate-500 transition hover:border-indigo-100 hover:bg-white hover:text-indigo-600">
                    <Home className="w-3.5 h-3.5" />
                    Vault
                  </button>
                  {getClientFolderPath().map((folder) => (
                    <React.Fragment key={folder.id}>
                      <ChevronRight className="w-3 h-3 shrink-0 text-slate-300" />
                      <button
                        type="button"
                        onClick={() => navigateClientFolder(folder.id)}
                        className={cn("max-w-[180px] truncate rounded-lg border border-transparent px-2 py-1 transition hover:border-indigo-100 hover:bg-white", folder.id === currentFolderId ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-indigo-600")}
                        title={folder.name}
                      >
                        {folder.name}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Tooltip content="Create a new folder">
                  <button 
                    onClick={() => { setEditingFile(null); setIsUploadFileModalOpen(true); }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    New Folder
                  </button>
                </Tooltip>
                <Tooltip content="Upload a file to this folder">
                  <button 
                    onClick={() => { setEditingFile(null); setIsUploadFileModalOpen(true); }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload File
                  </button>
                </Tooltip>
              </div>
            </div>
            {clientFiles.filter(f => f.parent_id === currentFolderId).length === 0 ? (
              <BrandedState 
                type="empty" 
                portal="superadmin" 
                title="No Files" 
                message="No files have been uploaded for this client." 
                action={{ label: 'Upload File', onClick: () => { setEditingFile(null); setIsUploadFileModalOpen(true); } }}
              />
            ) : (
              <div className="overflow-x-auto">
                <div className="pl-8 pr-8 pb-4">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                        <th className="px-8 py-4">File Name</th>
                        <th className="px-8 py-4">Size</th>
                        <th className="px-8 py-4">Uploaded</th>
                        <th className="px-8 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {clientFiles
                        .filter(f => f.parent_id === currentFolderId)
                        .map(file => (
                        <tr key={file.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
                                {file.type === 'folder' ? (
                                  <Folder className="w-4 h-4 text-indigo-600" />
                                ) : (
                                  <FileText className="w-4 h-4 text-indigo-600" />
                                )}
                              </div>
                              <button 
                                onClick={() => file.type === 'folder' && navigateClientFolder(file.id)}
                                className={cn(
                                  "text-sm font-bold text-slate-800 flex items-center gap-2",
                                  file.type === 'folder' && "hover:text-indigo-600"
                                )}
                              >
                                {file.name}
                                {file.password && (
                                  <Tooltip content={`Locked with password: ${file.password}`}>
                                    <Lock className="w-3 h-3 text-amber-500" />
                                  </Tooltip>
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="px-8 py-4 text-sm font-bold text-slate-500">{file.size}</td>
                          <td className="px-8 py-4 text-sm font-bold text-slate-500">{file.date}</td>
                          <td className="px-8 py-4 text-right">
                            <div className="flex items-center justify-end gap-2 transition-opacity">
                              <Tooltip content="Edit File">
                                <button 
                                  onClick={() => { setEditingFile(file); setIsUploadFileModalOpen(true); }} 
                                  className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-indigo-600 transition-colors shadow-sm"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              </Tooltip>
                              <Tooltip content="Delete File">
                                <button 
                                  onClick={() => handleDeleteFile(file.id)} 
                                  className="p-2 hover:bg-rose-50 rounded-xl text-slate-400 hover:text-rose-600 transition-colors shadow-sm"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-800">Activity Logs</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search logs..." 
                  value={logSearchTerm}
                  onChange={(e) => setLogSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-48 shadow-sm"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="pl-8 pr-8 pb-4">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                      <th className="px-8 py-4"><div className="flex items-center gap-2"><Clock className="w-3 h-3" /> Timestamp</div></th>
                      <th className="px-8 py-4"><div className="flex items-center gap-2"><User className="w-3 h-3" /> User</div></th>
                      <th className="px-8 py-4"><div className="flex items-center gap-2"><Activity className="w-3 h-3" /> Action</div></th>
                      <th className="px-8 py-4">Details</th>
                      <th className="px-8 py-4">IP Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clientLogs
                      .filter(log => 
                        log.user_email.toLowerCase().includes(logSearchTerm.toLowerCase()) ||
                        log.action.toLowerCase().includes(logSearchTerm.toLowerCase()) ||
                        log.details.toLowerCase().includes(logSearchTerm.toLowerCase())
                      )
                      .map(log => (
                        <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-8 py-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                          <td className="px-8 py-4">
                            <span className="text-sm font-bold text-slate-800">{log.user_email}</span>
                          </td>
                          <td className="px-8 py-4">
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-[9px] font-black tracking-widest uppercase bg-slate-100 text-slate-600">
                              {log.action.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-8 py-4 text-xs text-slate-600">
                            {formatDetails(log.details)}
                          </td>
                          <td className="px-8 py-4 text-xs font-mono text-slate-400">
                            {log.ip_address}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}


        {activeTab === 'support_tickets' && (
          <SupportTicketsPanel
            tickets={clientSupportTickets}
            hideClientFilter
            onUpdateTicket={async (updatedTicket) => {
              try {
                const saved = await appService.updateSupportTicket(updatedTicket.id, {
                  status: updatedTicket.status,
                  priority: updatedTicket.priority,
                  admin_notes: updatedTicket.admin_notes || '',
                });
                setClientSupportTickets((prev) => prev.map((ticket) => ticket.id === saved.id ? saved : ticket));
                toast.success('Support ticket updated');
              } catch (error) {
                console.error('Failed to update support ticket:', error);
                toast.error('Failed to update support ticket');
              }
            }}
          />
        )}

        {activeTab === 'payroll_notifications' && (
          <ClientNotificationsPanel
            notifications={clientPayrollNotifications}
            title="Payroll Notifications"
            subtitle="Monitor payroll submissions for this client only"
            searchPlaceholder="Search submitters or periods..."
            onProcess={async (id) => {
              try {
                const saved = await appService.updatePayrollSubmissionStatus(id, 'processed');
                setClientPayrollNotifications((prev) => prev.map((submission) => submission.id === saved.id ? saved : submission));
                toast.success('Payroll submission marked as processed');
              } catch (error) {
                console.error('Failed to process payroll submission:', error);
                toast.error('Failed to process payroll submission');
              }
            }}
            onRevert={async (id) => {
              try {
                const saved = await appService.updatePayrollSubmissionStatus(id, 'pending');
                setClientPayrollNotifications((prev) => prev.map((submission) => submission.id === saved.id ? saved : submission));
                toast.success('Payroll submission reverted to pending');
              } catch (error) {
                console.error('Failed to revert payroll submission:', error);
                toast.error('Failed to revert payroll submission');
              }
            }}
          />
        )}

        
        {activeTab === 'payroll_logs' && (
          <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="font-black text-slate-800">Payroll Submission Logs</h3>
                <p className="text-xs text-slate-500 font-medium tracking-tight">Submission history for this client only.</p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input 
                  type="text" 
                  value={payrollLogSearchTerm}
                  onChange={(e) => setPayrollLogSearchTerm(e.target.value)}
                  placeholder="Search periods, status, submitter..." 
                  className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-72 shadow-sm"
                />
              </div>
            </div>
            {filteredPayrollLogs.length === 0 ? (
              <BrandedState
                type="empty"
                portal="superadmin"
                title="No Payroll Logs"
                message="No payroll submissions have been logged for this client yet."
              />
            ) : (
              <div className="overflow-x-auto">
                <div className="pl-8 pr-8 pb-4">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                        <th className="px-8 py-4"><div className="flex items-center gap-2"><Clock className="w-3 h-3" /> Submitted</div></th>
                        <th className="px-8 py-4">Period</th>
                        <th className="px-8 py-4">Submitted By</th>
                        <th className="px-8 py-4">Employees</th>
                        <th className="px-8 py-4">Hours</th>
                        <th className="px-8 py-4">Total Pay</th>
                        <th className="px-8 py-4">Status</th>
                        <th className="px-8 py-4">Processed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPayrollLogs.map((submission) => (
                        <tr key={submission.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                            {submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : '—'}
                          </td>
                          <td className="px-8 py-4">
                            <div className="space-y-0.5">
                              <p className="text-sm font-bold text-slate-800">{submission.period || '—'}</p>
                              <p className="text-[10px] text-slate-400 font-semibold">{submission.id}</p>
                            </div>
                          </td>
                          <td className="px-8 py-4 text-sm font-medium text-slate-700">
                            {submission.submittedBy || '—'}
                          </td>
                          <td className="px-8 py-4 text-sm font-bold text-slate-800">
                            {submission.employeeCount ?? 0}
                          </td>
                          <td className="px-8 py-4 text-sm font-bold text-slate-800">
                            {Number(submission.totalHours || 0).toFixed(2)}
                          </td>
                          <td className="px-8 py-4 text-sm font-bold text-slate-800 whitespace-nowrap">
                            R {Number(submission.totalPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-8 py-4">
                            <div className={cn(
                              "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                              submission.status === 'processed'
                                ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                                : submission.status === 'archived'
                                  ? "bg-slate-100 text-slate-600 border border-slate-200"
                                  : "bg-amber-50 text-amber-600 border border-amber-100"
                            )}>
                              {submission.status === 'processed' ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : submission.status === 'archived' ? (
                                <History className="w-3 h-3" />
                              ) : (
                                <AlertCircle className="w-3 h-3" />
                              )}
                              {submission.status}
                            </div>
                          </td>
                          <td className="px-8 py-4">
                            <div className="space-y-0.5">
                              <p className="text-xs font-medium text-slate-700">{submission.processedBy || 'Not processed'}</p>
                              <p className="text-[10px] text-slate-400 font-semibold">
                                {submission.processedAt ? new Date(submission.processedAt).toLocaleString() : '—'}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex gap-8 min-h-[600px]">
            {/* Settings Navigation Rail */}
            <div className="w-64 flex flex-col gap-1">
              {[
                { id: 'general', label: 'General', desc: 'Basic info & appearance', icon: Building2 },
                { id: 'rostering', label: 'Rostering', desc: 'Schedules & definitions', icon: Calendar },
                { id: 'features', label: 'Features', desc: 'Access & trial control', icon: ShieldCheck }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSettingsTab(tab.id as any)}
                  className={cn(
                    "flex items-start gap-4 p-4 rounded-2xl transition-all text-left group",
                    settingsTab === tab.id
                      ? "bg-white shadow-sm border border-slate-200"
                      : "hover:bg-white/50"
                  )}
                >
                  <div className={cn(
                    "p-2 rounded-xl transition-colors",
                    settingsTab === tab.id ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400 group-hover:text-slate-600"
                  )}>
                    <tab.icon className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className={cn(
                      "text-sm font-bold",
                      settingsTab === tab.id ? "text-slate-900" : "text-slate-500"
                    )}>{tab.label}</span>
                    <span className="text-[10px] font-medium text-slate-400">{tab.desc}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Settings Content Area */}
            <div className="flex-1 space-y-6">
              {settingsTab === 'general' && (
                <div className="space-y-6">
                  <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-200 space-y-8">
                    <div className="space-y-1">
                      <h3 className="text-lg font-black text-slate-800">Client Appearance</h3>
                      <p className="text-xs text-slate-500 font-medium">Customize how this client's dashboard looks.</p>
                    </div>
                    
                    <div className="space-y-5">
                      <div className="flex items-center gap-8 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="relative group">
                          <div className="w-24 h-24 rounded-[32px] bg-white border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-indigo-400">
                            {clientFallbackImage ? (
                              <img src={clientFallbackImage} alt="Fallback" className="w-full h-full object-contain bg-white p-2" />
                            ) : (
                              <Building2 className="w-8 h-8 text-slate-300" />
                            )}
                          </div>
                          <label className="absolute inset-0 flex items-center justify-center bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-[32px]">
                            <Upload className="w-5 h-5 text-white" />
                            <input type="file" accept="image/*" onChange={handleFallbackImageUpload} className="hidden" />
                          </label>
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-sm font-bold text-slate-800">Fallback Logo</h4>
                          <p className="text-xs text-slate-500 leading-relaxed max-w-xs">
                            Choose one of the preset fuel brand logos below or upload a custom fallback image.
                          </p>
                          <div className="flex flex-wrap gap-3">
                            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 cursor-pointer hover:border-indigo-300">
                              <Upload className="w-3.5 h-3.5" />
                              Upload Custom
                              <input type="file" accept="image/*" onChange={handleFallbackImageUpload} className="hidden" />
                            </label>
                            <button 
                              type="button"
                              onClick={clearClientFallbackImage}
                              className="px-3 py-2 rounded-xl border border-rose-200 text-[10px] font-black text-rose-600 uppercase tracking-widest hover:bg-rose-50"
                            >
                              Remove Image
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-sm font-bold text-slate-800">Preset Logos</h4>
                            <p className="text-xs text-slate-500">Quick-select a branded fallback for this client.</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {PRESET_CLIENT_LOGOS.map((logo) => {
                            const isSelected = clientFallbackImage === logo.src;
                            return (
                              <button
                                key={logo.id}
                                type="button"
                                onClick={() => selectPresetClientLogo(logo.src)}
                                className={cn(
                                  "group rounded-2xl border p-3 bg-white transition-all text-left",
                                  isSelected
                                    ? "border-indigo-500 ring-2 ring-indigo-100 shadow-sm"
                                    : "border-slate-200 hover:border-indigo-300 hover:shadow-sm"
                                )}
                              >
                                <div className="h-16 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden">
                                  <img src={logo.src} alt={logo.label} className="max-h-full max-w-full object-contain p-2" />
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-slate-700 truncate">{logo.label}</span>
                                  {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-slate-100 flex items-center justify-between">
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-800">Dashboard Mode</h4>
                        <p className="text-xs text-slate-500">Choose the primary focus of this workspace.</p>
                      </div>
                      <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200">
                        <button
                          onClick={() => setDashboardType('rostering')}
                          className={cn(
                            "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                            dashboardType === 'rostering' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                          )}
                        >
                          Rostering
                        </button>
                        <button
                          onClick={() => setDashboardType('non-rostering')}
                          className={cn(
                            "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                            dashboardType === 'non-rostering' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                          )}
                        >
                          Standard
                        </button>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-slate-100 space-y-6">
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-800">Automatic Payroll Submission</h4>
                        <p className="text-xs text-slate-500">Configure when payroll is automatically submitted for processing.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                            {rosterDuration === '1_month' ? 'Day of the Month' : 'Day of the Week'}
                          </label>
                          <select 
                            value={payrollSubmissionDay}
                            onChange={(e) => setPayrollSubmissionDay(Number(e.target.value))}
                            className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm bg-slate-50 appearance-none"
                          >
                            {rosterDuration === '1_month' ? (
                              Array.from({ length: 31 }, (_, i) => (
                                <option key={i + 1} value={i + 1}>{i + 1}{[1, 21, 31].includes(i + 1) ? 'st' : [2, 22].includes(i + 1) ? 'nd' : [3, 23].includes(i + 1) ? 'rd' : 'th'}</option>
                              ))
                            ) : (
                              <>
                                <option value={0}>Sunday</option>
                                <option value={1}>Monday</option>
                                <option value={2}>Tuesday</option>
                                <option value={3}>Wednesday</option>
                                <option value={4}>Thursday</option>
                                <option value={5}>Friday</option>
                                <option value={6}>Saturday</option>
                              </>
                            )}
                          </select>
                          <p className="text-[10px] text-slate-400 font-medium px-1 italic">
                            {rosterDuration === '1_week' && "Submitted every week on this day."}
                            {rosterDuration === '2_weeks' && "Submitted on this day in the second week of the cycle."}
                            {rosterDuration === '1_month' && "Submitted on this day in the last week of the month."}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-slate-100 space-y-6">
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-800">Payroll Submission Notifications</h4>
                        <p className="text-xs text-slate-500">Configure who receives payroll reports via email.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Recipient Email</label>
                          <input 
                            type="email"
                            value={payrollEmail}
                            onChange={(e) => setPayrollEmail(e.target.value)}
                            placeholder="payroll@example.com"
                            className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm bg-slate-50"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">CC Email(s)</label>
                          <input 
                            type="text"
                            value={payrollCc}
                            onChange={(e) => setPayrollCc(e.target.value)}
                            placeholder="manager@example.com, hr@example.com"
                            className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm bg-slate-50"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-rose-100 space-y-4">
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-rose-700">Danger Zone</h4>
                        <p className="text-xs text-slate-500">Permanently remove this client dashboard and all of its data. This action cannot be undone.</p>
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-slate-800">Kill Switch</p>
                          <p className="text-xs text-slate-500">This requires a confirmation prompt and the passphrase <span className="font-black text-rose-700">DELETE</span>.</p>
                        </div>
                        <Tooltip content="Permanently remove this client dashboard">
                          <button
                            onClick={handleDeleteClientDashboard}
                            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-sm bg-red-600 text-white hover:bg-red-700 shadow-xl shadow-red-200 transition-all active:scale-95"
                          >
                            <Trash2 className="w-4 h-4" />
                            Kill Switch
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === 'rostering' && (
                <div className="space-y-6">
                  <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-200 space-y-8">
                    <div className="space-y-1">
                      <h3 className="text-lg font-black text-slate-800">Roster Configuration</h3>
                      <p className="text-xs text-slate-500 font-medium">Define how schedules are generated and displayed.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Week Start Day</label>
                        <select 
                          value={rosterStartDay}
                          onChange={(e) => setRosterStartDay(Number(e.target.value))}
                          className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm bg-slate-50 appearance-none"
                        >
                          <option value={0}>Sunday</option>
                          <option value={1}>Monday</option>
                          <option value={2}>Tuesday</option>
                          <option value={3}>Wednesday</option>
                          <option value={4}>Thursday</option>
                          <option value={5}>Friday</option>
                          <option value={6}>Saturday</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Default Duration</label>
                        <select 
                          value={rosterDuration}
                          onChange={(e) => setRosterDuration(e.target.value as any)}
                          className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm bg-slate-50 appearance-none"
                        >
                          <option value="1_week">1 Week</option>
                          <option value="2_weeks">2 Weeks</option>
                          <option value="1_month">1 Month</option>
                        </select>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-slate-100 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-slate-800">Enabled Definitions</h4>
                          <p className="text-xs text-slate-500">Select which data points are tracked in the roster.</p>
                        </div>
                        <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full uppercase tracking-widest">
                          {enabledDefinitions.length} Active
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-3">
                        {ROSTER_DEFINITIONS.map(def => (
                          <button
                            key={def.id}
                            onClick={() => toggleDefinition(def.id)}
                            className={cn(
                              "flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
                              enabledDefinitions.includes(def.id)
                                ? "bg-white border-indigo-200 text-indigo-700 shadow-sm ring-1 ring-indigo-100"
                                : "bg-slate-50/50 border-slate-100 text-slate-400 hover:border-slate-200"
                            )}
                          >
                            <span className="text-[11px] font-bold truncate pr-2">{def.label}</span>
                            <div className={cn(
                              "w-8 h-4 rounded-full relative transition-colors",
                              enabledDefinitions.includes(def.id) ? "bg-indigo-600" : "bg-slate-200"
                            )}>
                              <div className={cn(
                                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm",
                                enabledDefinitions.includes(def.id) ? "left-4.5" : "left-0.5"
                              )} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === 'features' && (
                <div className="space-y-6">
                  <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-200 space-y-8">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className="text-lg font-black text-slate-800">Trial Management</h3>
                        <p className="text-xs text-slate-500 font-medium">Control trial access and duration for this client.</p>
                      </div>
                      <button
                        onClick={() => setIsTrial(!isTrial)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
                          isTrial 
                            ? "bg-amber-50 border-amber-200 text-amber-700" 
                            : "bg-slate-50 border-slate-200 text-slate-400"
                        )}
                      >
                        {isTrial ? 'Trial Active' : 'Enable Trial'}
                      </button>
                    </div>

                    {isTrial && (
                      <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Trial Duration (Days)</p>
                        <div className="flex gap-3">
                          {[3, 5, 7].map(days => (
                            <button
                              key={days}
                              onClick={() => setTrialDuration(days as any)}
                              className={cn(
                                "flex-1 py-3 rounded-xl font-black text-xs transition-all border",
                                trialDuration === days
                                  ? "bg-white border-indigo-600 text-indigo-600 shadow-sm"
                                  : "bg-transparent border-slate-200 text-slate-400 hover:bg-white"
                              )}
                            >
                              {days} Days
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="pt-8 border-t border-slate-100 space-y-6">
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-800">Feature Access Control</h4>
                        <p className="text-xs text-slate-500">Lock specific modules to restrict access for this client.</p>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { id: 'analytics', label: 'Analytics' },
                          { id: 'employee_records', label: 'Employee Records' },
                          { id: 'leave_management', label: 'Leave Management' },
                          { id: 'rostering', label: 'Rostering' },
                          { id: 'timesheets', label: 'Timesheets' },
                          { id: 'file_vault', label: 'File Vault' }
                        ].map(feature => (
                          <button
                            key={feature.id}
                            onClick={() => toggleFeatureLock(feature.id)}
                            className={cn(
                              "flex items-center justify-between p-4 rounded-2xl border transition-all text-left group",
                              lockedFeatures.includes(feature.id)
                                ? "bg-rose-50 border-rose-200 text-rose-700 shadow-sm"
                                : "bg-white border-slate-100 text-slate-500 hover:border-slate-200"
                            )}
                          >
                            <span className="text-[11px] font-bold">{feature.label}</span>
                            {lockedFeatures.includes(feature.id) ? (
                              <Lock className="w-3.5 h-3.5 text-rose-600" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <button 
                  onClick={async () => {
                    if (!selectedClient) return;
                    try {
                      await adminService.updateClient(selectedClient.id, {
                        name: selectedClient.name,
                        status: selectedClient.status,
                        fallbackImage: clientFallbackImage,
                        lockedFeatures,
                        enabledDefinitions,
                        rosterStartDay,
                        rosterDuration,
                        dashboardType,
                        isTrial,
                        trialDuration,
                        payrollEmail,
                        payrollCc,
                        payrollSubmissionDay,
                      });
                      await fetchClients();
                      setSelectedClient({
                        ...selectedClient,
                        fallbackImage: clientFallbackImage,
                        lockedFeatures,
                        enabledDefinitions,
                        rosterStartDay,
                        rosterDuration,
                        dashboardType,
                        isTrial,
                        trialDuration,
                        payrollEmail,
                        payrollCc,
                        payrollSubmissionDay,
                      });
                      toast.success('Client settings updated successfully');
                    } catch (error) {
                      console.error('Failed to update client settings:', error);
                      toast.error('Failed to update client settings');
                    }
                  }}
                  className="px-10 py-4 rounded-2xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95"
                >
                  Save All Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );

  return (
    <>
      {selectedClient ? renderClientDetail() : renderClientList()}

      {/* New Client Modal */}
      <AnimatePresence>
        {isNewClientModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNewClientModalOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-[40px] shadow-2xl z-[101] overflow-hidden"
            >
              <div className="p-10 space-y-8">
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">New Dashboard</h3>
                  <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Create a new client workspace</p>
                </div>

                <form onSubmit={handleCreateClient} className="space-y-6">
                  <div className="space-y-4 py-2">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative group">
                        <div className="w-24 h-24 rounded-[32px] bg-white border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-indigo-400">
                          {clientFallbackImage ? (
                            <img src={clientFallbackImage} alt="Preview" className="w-full h-full object-contain bg-white p-2" />
                          ) : (
                            <Building2 className="w-8 h-8 text-slate-300" />
                          )}
                        </div>
                        <Tooltip content="Upload Fallback Image" className="absolute inset-0">
                          <label className="absolute inset-0 flex items-center justify-center bg-slate-900/40 transition-opacity cursor-pointer rounded-[32px]">
                            <Plus className="w-6 h-6 text-white" />
                            <input 
                              type="file" 
                              accept="image/*" 
                              onChange={handleFallbackImageUpload} 
                              className="hidden" 
                            />
                          </label>
                        </Tooltip>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 cursor-pointer hover:border-indigo-300">
                          <Upload className="w-3.5 h-3.5" />
                          Upload Custom
                          <input type="file" accept="image/*" onChange={handleFallbackImageUpload} className="hidden" />
                        </label>
                        <button
                          type="button"
                          onClick={clearClientFallbackImage}
                          className="px-3 py-2 rounded-xl border border-rose-200 text-[10px] font-black text-rose-600 uppercase tracking-widest hover:bg-rose-50"
                        >
                          Clear
                        </button>
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Client Fallback Image</p>
                    </div>

                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Client Name</label>
                    <input name="name" required className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button 
                      type="button" 
                      onClick={() => setIsNewClientModalOpen(false)}
                      className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="flex-1 px-6 py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all"
                    >
                      Create
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* New User Modal */}
      <AnimatePresence>
        {isNewUserModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNewUserModalOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-[40px] shadow-2xl z-[101] overflow-hidden"
            >
              <div className="p-10 space-y-8">
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">{editingUser ? 'Edit User' : 'Add User'}</h3>
                  <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">{editingUser ? 'Update user details' : 'Add a new user to this dashboard'}</p>
                </div>

                <form onSubmit={handleAddUser} className="space-y-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Full Name</label>
                    <input name="name" defaultValue={editingUser?.name} required className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Email Address</label>
                    <input name="email" type="email" defaultValue={editingUser?.email} required className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Password</label>
                    <div className="relative">
                      <input 
                        name="password" 
                        type={showPassword ? "text" : "password"} 
                        defaultValue={generatedPassword || editingUser?.password} 
                        required={!editingUser}
                        placeholder={editingUser ? "Leave blank to keep current" : "Enter password"}
                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" 
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <Tooltip content="Generate Password">
                          <button
                            type="button"
                            onClick={generatePassword}
                            className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-indigo-600 transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        </Tooltip>
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-indigo-600 transition-colors"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Role</label>
                    <select name="role" defaultValue={editingUser?.role || 'User'} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm appearance-none bg-white">
                      <option value="Admin">Admin</option>
                      <option value="Manager">Manager</option>
                      <option value="User">User</option>
                    </select>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button 
                      type="button" 
                      onClick={() => setIsNewUserModalOpen(false)}
                      className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="flex-1 px-6 py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all"
                    >
                      {editingUser ? 'Save Changes' : 'Add User'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Upload File Modal */}
      <AnimatePresence>
        {isUploadFileModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsUploadFileModalOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-[40px] shadow-2xl z-[101] overflow-hidden"
            >
              <div className="p-10 space-y-8">
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">{editingFile ? 'Edit File' : 'Upload File'}</h3>
                  <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">{editingFile ? 'Rename this file' : 'Add a new file to this dashboard'}</p>
                </div>

                <form onSubmit={handleUploadFile} className="space-y-6">
                  {editingFile ? (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">File Name</label>
                        <input name="name" defaultValue={editingFile.name} required className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" />
                      </div>
                      {editingFile.type === 'folder' && (
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Folder Password (Optional)</label>
                          <input name="password" defaultValue={editingFile.password} placeholder="Set a password to lock this folder" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Type</label>
                        <select name="type" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm appearance-none bg-white">
                          <option value="file">File</option>
                          <option value="folder">Folder</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Name / Select File</label>
                        <input name="name" placeholder="Folder name (if folder selected)" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm mb-2" />
                        <input name="file" type="file" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Folder Password (Optional)</label>
                        <input name="password" placeholder="Set a password to lock this folder" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <button 
                      type="button" 
                      onClick={() => setIsUploadFileModalOpen(false)}
                      className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="flex-1 px-6 py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all"
                    >
                      {editingFile ? 'Save Changes' : 'Upload'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
