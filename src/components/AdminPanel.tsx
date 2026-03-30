import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Plus, 
  Trash2, 
  Shield, 
  Mail, 
  CheckCircle, 
  Loader2, 
  UserPlus, 
  RefreshCw, 
  Edit2, 
  Search, 
  Eye, 
  EyeOff, 
  Building2, 
  ShieldCheck, 
  Lock, 
  ArrowLeft,
  Check,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { User, InternalPermission, UserRole, Client } from '../types';
import { cn } from '../lib/utils';
import { ConfirmationModal } from './ConfirmationModal';
import { BrandedState } from './BrandedStates';
import { Tooltip } from './Tooltip';
import { adminService } from '../services/adminService';

const PERMISSIONS: { id: InternalPermission; label: string; description: string }[] = [
  { id: 'view_clients', label: 'View Clients', description: 'Access to client list and profile overview' },
  { id: 'view_tickets', label: 'View Support Tickets', description: 'View and manage support tickets' },
  { id: 'view_global_logs', label: 'Super Admin Activity Logs', description: 'Access to platform-wide internal activity logs' },
  { id: 'view_client_logs', label: 'Client Activity Logs', description: 'Access to activity logs inside assigned client profiles' },
  { id: 'view_payroll', label: 'View Payroll', description: 'Access to payroll submissions and history' },
  { id: 'view_files', label: 'View Files', description: 'Access to client document storage' },
  { id: 'view_employees', label: 'View Employees', description: 'Access to client employee records' },
  { id: 'manage_client_users', label: 'Manage Client Users', description: 'Create and edit client portal users' },
  { id: 'view_analytics', label: 'View Analytics', description: 'Access to client data insights' },
  { id: 'edit_client_details', label: 'Edit Client Details', description: 'Modify client settings and profiles' },
  { id: 'submit_payroll', label: 'Submit Payroll', description: 'Process and submit payroll for clients' },
  { id: 'resolve_tickets', label: 'Resolve Support Tickets', description: 'Mark tickets as resolved' },
];

export const AdminPanel: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userImage, setUserImage] = useState<string | null>(null);

  // Form State
  const [formRole, setFormRole] = useState<UserRole>('staff');
  const [clientSearch, setClientSearch] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminService.getInternalUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch users';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const data = await adminService.getClients();
      setClients(data);
    } catch (err) {
      console.error('Failed to fetch clients:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchClients();
  }, []);

  useEffect(() => {
    if (editingUser) {
      setFormRole(editingUser.role || 'staff');
    } else {
      setFormRole('staff');
    }
  }, [editingUser, isModalOpen]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(formData.entries());
    
    data.role = formRole;
    
    if (!editingUser) {
      data.permissions = [];
      data.assigned_clients = [];
    }
    
    if (userImage) {
      data.image = userImage;
    }

    try {
      if (editingUser) {
        await adminService.updateInternalUser(editingUser.id, data);
        toast.success('User updated');
      } else {
        await adminService.createInternalUser(data);
        toast.success('User created');
      }
      setIsModalOpen(false);
      setEditingUser(null);
      setUserImage(null);
      fetchUsers();
    } catch (err) {
      console.error('Submit user error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyUser = async (id: string) => {
    try {
      await adminService.verifyInternalUser(id);
      toast.success('User verified');
      fetchUsers();
    } catch (err) {
      console.error('Failed to verify user:', err);
      toast.error('Failed to verify user');
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await adminService.deleteInternalUser(id);
      toast.success('User deleted');
      fetchUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
      toast.error('Failed to delete user');
    }
  };

  const handleDeactivateUser = async (id: string) => {
    try {
      await adminService.deactivateInternalUser(id);
      toast.success('User deactivated');
      fetchUsers();
    } catch (err) {
      console.error('Failed to deactivate user:', err);
      toast.error('Failed to deactivate user');
    }
  };

  const handleResetPassword = async (id: string) => {
    try {
      await adminService.resetInternalUserPassword(id);
      toast.success('Password reset email sent');
    } catch (err) {
      console.error('Failed to reset password:', err);
      toast.error('Failed to reset password');
    }
  };

  const handleReset2FA = async (id: string) => {
    try {
      await adminService.resetInternalUser2FA(id);
      toast.success('2FA reset successfully');
      fetchUsers();
    } catch (err) {
      console.error('Failed to reset 2FA:', err);
      toast.error('Failed to reset 2FA');
    }
  };

  const handleTogglePermission = async (perm: InternalPermission) => {
    if (!selectedUser) return;
    const currentPerms = selectedUser.permissions || [];
    const newPerms = currentPerms.includes(perm) 
      ? currentPerms.filter(p => p !== perm) 
      : [...currentPerms, perm];
    
    setSelectedUser({ ...selectedUser, permissions: newPerms });
    
    try {
      await adminService.updateInternalUser(selectedUser.id, { permissions: newPerms });
      toast.success('Permissions updated');
      fetchUsers();
    } catch (err) {
      toast.error('Failed to update permissions');
      setSelectedUser({ ...selectedUser, permissions: currentPerms });
    }
  };

  const handleToggleClient = async (clientId: string) => {
    if (!selectedUser) return;
    const currentClients = selectedUser.assigned_clients || [];
    const newClients = currentClients.includes(clientId) 
      ? currentClients.filter(id => id !== clientId) 
      : [...currentClients, clientId];
    
    setSelectedUser({ ...selectedUser, assigned_clients: newClients });
    
    try {
      await adminService.updateInternalUser(selectedUser.id, { assigned_clients: newClients });
      toast.success('Assigned clients updated');
      fetchUsers();
    } catch (err) {
      toast.error('Failed to update assigned clients');
      setSelectedUser({ ...selectedUser, assigned_clients: currentClients });
    }
  };

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.role || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.full_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUserImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  if (selectedUser) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setSelectedUser(null)}
            className="p-3 rounded-2xl bg-white border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-100 transition-all active:scale-95"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="space-y-1">
            <h2 className="text-4xl font-black text-slate-800 tracking-tight">{selectedUser.full_name || selectedUser.email}</h2>
            <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Internal User Details</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-8">
            <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-24 h-24 rounded-[32px] bg-slate-100 flex items-center justify-center text-slate-400 font-black text-2xl overflow-hidden border-4 border-white shadow-lg">
                  {selectedUser.image ? (
                    <img src={selectedUser.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (selectedUser.full_name || selectedUser.email).substring(0, 2).toUpperCase()
                  )}
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-800">{selectedUser.full_name || 'No Name'}</h3>
                  <p className="text-sm text-slate-500 font-bold">{selectedUser.email}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                    selectedUser.role === 'superadmin' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-600'
                  )}>
                    {selectedUser.role}
                  </span>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                    selectedUser.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                  )}>
                    {selectedUser.status || 'active'}
                  </span>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-slate-100 space-y-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Login</p>
                  <p className="text-sm font-bold text-slate-700">{selectedUser.lastLogin ? new Date(selectedUser.lastLogin).toLocaleString() : 'Never'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Assigned Clients</p>
                  <p className="text-sm font-bold text-slate-700">{selectedUser.assigned_clients?.length || 0} Clients</p>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-slate-100 flex flex-col gap-3">
                <button 
                  onClick={() => { 
                    setEditingUser(selectedUser); 
                    setIsModalOpen(true); 
                  }}
                  className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                >
                  Edit Profile
                </button>
                <button 
                  onClick={() => handleResetPassword(selectedUser.id)}
                  className="w-full py-3 rounded-2xl bg-slate-50 text-slate-600 font-black text-sm hover:bg-slate-100 transition-all"
                >
                  Reset Password
                </button>
                <button 
                  onClick={() => handleDeactivateUser(selectedUser.id)}
                  className="w-full py-3 rounded-2xl bg-rose-50 text-rose-600 font-black text-sm hover:bg-rose-100 transition-all"
                >
                  {selectedUser.status === 'deactivated' ? 'Activate Account' : 'Deactivate Account'}
                </button>
                {selectedUser.mfa_enabled && (
                  <button 
                    onClick={() => handleReset2FA(selectedUser.id)}
                    className="w-full py-3 rounded-2xl bg-amber-50 text-amber-600 font-black text-sm hover:bg-amber-100 transition-all"
                  >
                    Reset 2FA
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20">
              <h3 className="text-xl font-black text-slate-800 mb-6">Permissions</h3>
              {selectedUser.role === 'superadmin' ? (
                <div className="p-6 bg-indigo-50 rounded-3xl border border-indigo-100 flex items-center gap-4">
                  <ShieldCheck className="w-8 h-8 text-indigo-600" />
                  <div>
                    <p className="font-black text-indigo-900 uppercase tracking-widest text-xs">Full Platform Access</p>
                    <p className="text-sm text-indigo-600 font-medium">Super Admins have unrestricted access to all system features and client data.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {PERMISSIONS.map(perm => {
                    const hasPerm = selectedUser.permissions?.includes(perm.id);
                    return (
                      <button 
                        key={perm.id} 
                        onClick={() => handleTogglePermission(perm.id)}
                        className={cn(
                          "p-4 rounded-2xl border transition-all flex items-start gap-3 text-left hover:shadow-md",
                          hasPerm ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200 hover:border-indigo-200"
                        )}
                      >
                        <div className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                          hasPerm ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-300"
                        )}>
                          {hasPerm ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-800">{perm.label}</p>
                          <p className="text-[10px] text-slate-500 font-medium">{perm.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedUser.role === 'staff' && (
              <div className="bg-white rounded-[32px] p-8 shadow-xl shadow-indigo-100/20 border border-white/20">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-black text-slate-800">Assigned Clients</h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input 
                      type="text"
                      placeholder="Search clients..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="w-48 lg:w-64 pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-600/10"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {clients
                    .filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
                    .map(client => {
                      const isAssigned = selectedUser.assigned_clients?.includes(client.id);
                      return (
                        <button
                          key={client.id}
                          onClick={() => handleToggleClient(client.id)}
                          className={cn(
                            "p-4 rounded-2xl border transition-all flex items-center justify-between text-left hover:shadow-md",
                            isAssigned ? "bg-indigo-50 border-indigo-200" : "bg-white border-slate-200 hover:border-indigo-200"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-indigo-600 font-black text-xs">
                              {client.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-800">{client.name}</p>
                              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">ID: {client.id}</p>
                            </div>
                          </div>
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors",
                            isAssigned ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-300"
                          )}>
                            {isAssigned ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                          </div>
                        </button>
                      );
                  })}
                  {clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                    <div className="col-span-full py-12 text-center space-y-2">
                      <Building2 className="w-12 h-12 text-slate-200 mx-auto" />
                      <p className="text-slate-500 font-bold">No clients found.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-4xl font-black text-slate-800 tracking-tight">Internal Users</h2>
          <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Manage Staff & Super Admins</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search internal users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-11 pr-4 py-3 rounded-2xl bg-white border border-slate-200 text-sm font-bold focus:ring-4 focus:ring-indigo-600/10 outline-none w-64 transition-all"
            />
          </div>
          <button 
            onClick={fetchUsers}
            className="p-3 rounded-2xl bg-white border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-100 transition-all active:scale-95"
            title="Refresh Users"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
          <button 
            onClick={() => {
              setEditingUser(null);
              setUserImage(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95"
          >
            <UserPlus className="w-4 h-4" />
            Add Internal User
          </button>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
        {loading && users.length === 0 ? (
          <BrandedState 
            type="loading" 
            portal="superadmin" 
            title="Fetching Users" 
            message="Retrieving internal user accounts..." 
          />
        ) : error && users.length === 0 ? (
          <BrandedState 
            type="error" 
            portal="superadmin" 
            title="Failed to Load Users" 
            message={error} 
            action={{ label: 'Try Again', onClick: fetchUsers }} 
          />
        ) : filteredUsers.length === 0 ? (
          <BrandedState 
            type="empty" 
            portal="superadmin" 
            title="No Users Found" 
            message={searchTerm ? `No users matching "${searchTerm}"` : "No internal users have been created yet."} 
            action={!searchTerm ? { label: 'Add Internal User', onClick: () => setIsModalOpen(true) } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                  <th className="px-8 py-6">User</th>
                  <th className="px-8 py-6">Role</th>
                  <th className="px-8 py-6">Permissions</th>
                  <th className="px-8 py-6">Status</th>
                  <th className="px-8 py-6">Last Login</th>
                  <th className="px-8 py-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map(user => (
                  <tr key={user.id} className="hover:bg-indigo-50/30 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 font-black text-xs overflow-hidden">
                          {user.image ? (
                            <img src={user.image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            (user.full_name || user.email).substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-800">{user.full_name || 'No Name'}</span>
                          <span className="text-[10px] text-slate-400 font-black uppercase tracking-tighter">{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                        user.role === 'superadmin' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-600'
                      )}>
                        <Shield className="w-3 h-3" />
                        {user.role}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {user.role === 'superadmin' ? (
                          <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">All Permissions</span>
                        ) : (
                          user.permissions?.slice(0, 3).map(p => (
                            <span key={p} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-tighter">
                              {p.replace(/_/g, ' ')}
                            </span>
                          ))
                        )}
                        {user.role === 'staff' && (user.permissions?.length || 0) > 3 && (
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">+{user.permissions!.length - 3} more</span>
                        )}
                        {user.role === 'staff' && (!user.permissions || user.permissions.length === 0) && (
                          <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest">No Permissions</span>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                        user.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                      )}>
                        {user.status || 'active'}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-xs font-bold text-slate-600">
                        {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2 transition-all">
                        <Tooltip content="View Details">
                          <button 
                            onClick={() => setSelectedUser(user)}
                            className="p-2.5 hover:bg-white rounded-xl text-slate-400 hover:text-indigo-600 transition-colors shadow-sm"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </Tooltip>
                        <Tooltip content={user.status === 'deactivated' ? "Activate User" : "Deactivate User"}>
                          <button 
                            onClick={() => handleDeactivateUser(user.id)}
                            className={cn(
                              "p-2.5 hover:bg-white rounded-xl transition-colors shadow-sm",
                              user.status === 'deactivated' ? "text-emerald-400 hover:text-emerald-600" : "text-amber-400 hover:text-amber-600"
                            )}
                          >
                            {user.status === 'deactivated' ? <CheckCircle className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          </button>
                        </Tooltip>
                        <Tooltip content="Delete User">
                          <button 
                            onClick={() => { setUserToDelete(user.id); setIsConfirmOpen(true); }}
                            className="p-2.5 hover:bg-white rounded-xl text-rose-400 hover:text-rose-600 transition-colors shadow-sm"
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
        )}
      </div>

      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => { setIsConfirmOpen(false); setUserToDelete(null); }}
        onConfirm={() => userToDelete && handleDeleteUser(userToDelete)}
        title="Delete User"
        message="Are you sure you want to delete this internal user? This action cannot be undone."
        confirmText="Delete User"
      />

      <AnimatePresence>
        {isModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[90vh] bg-white rounded-[40px] shadow-2xl z-[101] overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">
                    {editingUser ? 'Edit Internal User' : 'Add Internal User'}
                  </h3>
                  <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">
                    {editingUser ? 'Update role and permissions' : 'Create new staff or admin access'}
                  </p>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-8">
                {error && (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold">
                    {error}
                  </div>
                )}

                <div className="space-y-6 max-w-md mx-auto">
                  <div className="flex flex-col items-center gap-4 py-2">
                    <div className="relative group">
                      <div className="w-24 h-24 rounded-[32px] bg-slate-100 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-indigo-400">
                        {userImage ? (
                          <img src={userImage} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <Users className="w-8 h-8 text-slate-300" />
                        )}
                      </div>
                      <label className="absolute inset-0 flex items-center justify-center bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-[32px]">
                        <Plus className="w-6 h-6 text-white" />
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleImageUpload} 
                          className="hidden" 
                        />
                      </label>
                    </div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profile Image</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Full Name</label>
                      <input 
                        name="full_name" 
                        type="text" 
                        required 
                        defaultValue={editingUser?.full_name}
                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" 
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Email Address</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          name="email" 
                          type="email" 
                          required 
                          defaultValue={editingUser?.email}
                          className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" 
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                        Password {editingUser && '(Leave blank to keep current)'}
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          name="password" 
                          type="password" 
                          required={!editingUser}
                          className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" 
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">User Role</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setFormRole('superadmin')}
                          className={cn(
                            "p-4 rounded-2xl border-2 transition-all text-left space-y-1",
                            formRole === 'superadmin' ? "border-indigo-600 bg-indigo-50" : "border-slate-100 bg-white hover:border-slate-200"
                          )}
                        >
                          <ShieldCheck className={cn("w-5 h-5", formRole === 'superadmin' ? "text-indigo-600" : "text-slate-400")} />
                          <p className="text-sm font-black text-slate-800">Super Admin</p>
                          <p className="text-[10px] text-slate-500 font-medium">Full system access</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormRole('staff')}
                          className={cn(
                            "p-4 rounded-2xl border-2 transition-all text-left space-y-1",
                            formRole === 'staff' ? "border-indigo-600 bg-indigo-50" : "border-slate-100 bg-white hover:border-slate-200"
                          )}
                        >
                          <Users className={cn("w-5 h-5", formRole === 'staff' ? "text-indigo-600" : "text-slate-400")} />
                          <p className="text-sm font-black text-slate-800">Staff</p>
                          <p className="text-[10px] text-slate-500 font-medium">Restricted access</p>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </form>

              <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={(e) => {
                    const form = (e.currentTarget as any).closest('div').previousElementSibling as HTMLFormElement;
                    form.requestSubmit();
                  }}
                  disabled={submitting}
                  className="flex-1 px-6 py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {editingUser ? 'Updating...' : 'Creating...'}
                    </>
                  ) : (
                    editingUser ? 'Update User' : 'Create User'
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
