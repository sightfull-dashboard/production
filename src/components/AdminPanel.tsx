import React, { useState, useEffect } from 'react';
import { Users, Plus, Trash2, Shield, Mail, CheckCircle, XCircle, Loader2, UserPlus, RefreshCw, Edit2, Search, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { User } from '../types';
import { cn } from '../lib/utils';
import { ConfirmationModal } from './ConfirmationModal';
import { BrandedState } from './BrandedStates';
import { Tooltip } from './Tooltip';

export const AdminPanel: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userImage, setUserImage] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
      }

      if (res.ok) {
        setUsers(data);
      } else {
        throw new Error(data.error || 'Failed to fetch users');
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch users';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    
    // Add image if present
    if (userImage) {
      data.image = userImage;
    }

    try {
      const url = editingUser ? `/api/admin/users/${editingUser.id}` : '/api/admin/users';
      const method = editingUser ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include'
      });

      const text = await res.text();
      let resData;
      try {
        resData = JSON.parse(text);
      } catch (e) {
        // Not JSON, but we might still have a status
      }

      if (res.ok) {
        toast.success(editingUser ? 'User updated' : 'User created');
        setIsModalOpen(false);
        setEditingUser(null);
        setUserImage(null);
        fetchUsers();
      } else {
        let errorMsg = editingUser ? 'Failed to update user' : 'Failed to create user';
        if (resData && resData.error) {
          errorMsg = resData.error;
        } else if (!resData) {
          errorMsg = `Server error: ${res.status} ${res.statusText}`;
        }
        setError(errorMsg);
      }
    } catch (err) {
      console.error('Submit user fetch error:', err);
      setError('Network error or server unreachable. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyUser = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/users/${id}/verify`, { 
        method: 'PATCH',
        credentials: 'include'
      });
      if (res.ok) {
        toast.success('User verified');
        fetchUsers();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to verify user');
      }
    } catch (err) {
      console.error('Failed to verify user:', err);
      toast.error('Network error');
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/users/${id}`, { 
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        toast.success('User deleted');
        fetchUsers();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to delete user');
      }
    } catch (err) {
      console.error('Failed to delete user:', err);
      toast.error('Network error');
    }
  };

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.role || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    ((u as any).name || '').toLowerCase().includes(searchTerm.toLowerCase())
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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-4xl font-black text-slate-800 tracking-tight">Super Panel Users</h2>
          <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Internal Super Panel Access</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search super panel users..."
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
            Add New User
          </button>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
        {loading && users.length === 0 ? (
          <BrandedState 
            type="loading" 
            portal="superadmin" 
            title="Fetching Users" 
            message="Retrieving system user accounts..." 
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
            message={searchTerm ? `No users matching "${searchTerm}"` : "No system users have been created yet."} 
            action={!searchTerm ? { label: 'Add New User', onClick: () => setIsModalOpen(true) } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                  <th className="px-8 py-6">User</th>
                  <th className="px-8 py-6">Role</th>
                  <th className="px-8 py-6">Status</th>
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
                            user.email.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-800">{user.email}</span>
                          <span className="text-[10px] text-slate-400 font-black uppercase tracking-tighter">ID: {user.id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                        user.role === 'admin' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-600'
                      )}>
                        <Shield className="w-3 h-3" />
                        {user.role}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      {user.is_verified ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-black uppercase tracking-widest">
                          <CheckCircle className="w-3 h-3" />
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-black uppercase tracking-widest">
                          <XCircle className="w-3 h-3" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2 transition-all">
                        {!user.is_verified && (
                          <Tooltip content="Verify User">
                            <button 
                              onClick={() => handleVerifyUser(user.id)}
                              className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all"
                            >
                              Verify
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip content="Edit User">
                          <button 
                            onClick={() => { 
                              setEditingUser(user); 
                              setUserImage(user.image || null);
                              setIsModalOpen(true); 
                            }}
                            className="p-2.5 hover:bg-indigo-50 rounded-xl text-slate-400 hover:text-indigo-600 transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </Tooltip>
                        <Tooltip content="Delete User">
                          <button 
                            onClick={() => { setUserToDelete(user.id); setIsConfirmOpen(true); }}
                            className="p-2.5 hover:bg-rose-50 rounded-xl text-rose-400 hover:text-rose-600 transition-colors"
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
        message="Are you sure you want to delete this user? This action cannot be undone."
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
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-[40px] shadow-2xl z-[101] overflow-hidden"
            >
              <div className="p-10 space-y-8">
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">
                    {editingUser ? 'Edit User' : 'Add New User'}
                  </h3>
                  <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">
                    {editingUser ? 'Update user permissions' : 'Create verified access'}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {error && (
                    <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold">
                      {error}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-4 py-2">
                      <div className="relative group">
                        <div className="w-24 h-24 rounded-[32px] bg-slate-100 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-indigo-400">
                          {userImage ? (
                            <img src={userImage} alt="Preview" className="w-full h-full object-cover" />
                          ) : (
                            <Users className="w-8 h-8 text-slate-300" />
                          )}
                        </div>
                        <Tooltip content="Upload Profile Image" className="absolute inset-0">
                          <label className="absolute inset-0 flex items-center justify-center bg-slate-900/40 transition-opacity cursor-pointer rounded-[32px]">
                            <Plus className="w-6 h-6 text-white" />
                            <input 
                              type="file" 
                              accept="image/*" 
                              onChange={handleImageUpload} 
                              className="hidden" 
                            />
                          </label>
                        </Tooltip>
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">User Profile Image</p>
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
                      <input 
                        name="password" 
                        type="password" 
                        required={!editingUser}
                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" 
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Role</label>
                      <select 
                        name="role" 
                        required 
                        defaultValue={editingUser?.role || 'user'}
                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm appearance-none bg-white"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button 
                      type="button" 
                      onClick={() => { 
                        setIsModalOpen(false); 
                        setEditingUser(null); 
                        setUserImage(null);
                      }}
                      className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
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
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
