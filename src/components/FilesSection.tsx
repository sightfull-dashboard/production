import React, { useState, useEffect, useRef } from 'react';
import { Files, ChevronRight, Search, Plus, Upload, FileText, Folder, Download, Trash2, Loader2, Lock, ArrowLeft, ArrowRight, Home } from 'lucide-react';
import { FileItem } from '../types';
import { fileService } from '../services/fileService';
import { fileUploadService } from '../services/fileUploadService';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { ConfirmationModal } from './ConfirmationModal';
import { Tooltip } from './Tooltip';

interface FilesSectionProps {
  employeeId?: string;
  readOnly?: boolean;
  canLockFolders?: boolean;
}

export const FilesSection: React.FC<FilesSectionProps> = ({ employeeId, readOnly = false, canLockFolders = !readOnly }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [backHistory, setBackHistory] = useState<(string | null)[]>([]);
  const [forwardHistory, setForwardHistory] = useState<(string | null)[]>([]);
  const [search, setSearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordToVerify, setPasswordToVerify] = useState('');
  const [folderToOpen, setFolderToOpen] = useState<string | null>(null);
  const [enteredPassword, setEnteredPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchFiles();
  }, [employeeId]);

  const navigateToFolder = (nextFolderId: string | null, options?: { pushHistory?: boolean }) => {
    const pushHistory = options?.pushHistory !== false;
    setCurrentFolderId((prev) => {
      if (pushHistory && prev !== nextFolderId) {
        setBackHistory((history) => [...history, prev]);
        setForwardHistory([]);
      }
      return nextFolderId;
    });
  };

  const handleBackNavigation = () => {
    setBackHistory((history) => {
      if (history.length === 0) return history;
      const previous = history[history.length - 1];
      setForwardHistory((forward) => [currentFolderId, ...forward]);
      setCurrentFolderId(previous);
      return history.slice(0, -1);
    });
  };

  const handleForwardNavigation = () => {
    setForwardHistory((history) => {
      if (history.length === 0) return history;
      const [next, ...rest] = history;
      setBackHistory((back) => [...back, currentFolderId]);
      setCurrentFolderId(next);
      return rest;
    });
  };

  const buildFolderPath = (folderId: string | null) => {
    const path: FileItem[] = [];
    let cursor = folderId ? files.find((file) => file.id === folderId) || null : null;
    const visited = new Set<string>();

    while (cursor && !visited.has(cursor.id)) {
      path.unshift(cursor);
      visited.add(cursor.id);
      cursor = cursor.parent_id ? files.find((file) => file.id === cursor.parent_id) || null : null;
    }

    return path;
  };

  const handleFolderClick = (item: FileItem) => {
    if (item.type !== 'folder') return;
    
    if (item.password) {
      setFolderToOpen(item.id);
      setPasswordToVerify(item.password);
      setIsPasswordModalOpen(true);
      setEnteredPassword('');
    } else {
      navigateToFolder(item.id);
    }
  };

  const handleVerifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (enteredPassword === passwordToVerify) {
      navigateToFolder(folderToOpen);
      setIsPasswordModalOpen(false);
      setFolderToOpen(null);
      setPasswordToVerify('');
      setEnteredPassword('');
    } else {
      toast.error('Incorrect password');
    }
  };

  const fetchFiles = async () => {
    try {
      const data = await fileService.list({ employee_id: employeeId });
      setFiles(data);

      if (employeeId && !currentFolderId) {
        const rootFolder = data.find((f) => f.employee_id === employeeId && f.parent_id === null);
        if (rootFolder) {
          navigateToFolder(rootFolder.id, { pushHistory: false });
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const currentFolder = currentFolderId ? files.find(f => f.id === currentFolderId) : null;
  
  const items = files.filter(f => {
    const matchesParent = f.parent_id === currentFolderId;
    const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase());
    return matchesParent && matchesSearch;
  });

  const rootFolders = employeeId 
    ? files.filter(f => f.type === 'folder' && f.employee_id === employeeId && f.parent_id === null)
    : files.filter(f => f.type === 'folder' && f.parent_id === null);

  const handleDownload = async (item: FileItem) => {
    try {
      const data = await fileService.download(item.id);
      if (!data.url) throw new Error(item.type === 'folder' ? 'This folder has no downloadable content yet.' : 'This file has no downloadable content yet.');
      const link = document.createElement('a');
      link.href = data.url;
      link.download = data.name || item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Downloading ${item.name}...`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to download ${item.type === 'folder' ? 'folder' : 'file'}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fileService.remove(id);
      setFiles(prev => prev.filter(f => f.id !== id && f.parent_id !== id));
      toast.success('Deleted successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete');
    }
  };

  const confirmDelete = () => {
    if (itemToDelete) {
      handleDelete(itemToDelete);
      setItemToDelete(null);
    }
  };

  const handleCreateFolder = async () => {
    const name = prompt('Enter folder name:');
    if (!name) return;
    const wantsPassword = canLockFolders ? window.confirm('Would you like to password protect this folder?') : false;
    const password = wantsPassword ? window.prompt('Enter folder password:') || '' : '';

    try {
      const newFolder = await fileService.create({
        name,
        type: 'folder',
        parent_id: currentFolderId,
        employee_id: employeeId,
        password: password || undefined,
      });
      setFiles(prev => [...prev, newFolder]);
      toast.success('Folder created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create folder');
    }
  };

  const handleUpload = async () => {
    fileInputRef.current?.click();
  };


  const formatVaultDate = (value?: string) => {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    if (raw.includes('T')) {
      return raw.split('T')[0];
    }
    return raw;
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const newFile = await fileUploadService.uploadVaultFile({
        file,
        parentId: currentFolderId,
        employeeId,
      });
      setFiles(prev => [...prev, newFile]);
      toast.success('File uploaded successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload file');
    } finally {
      setIsUploading(false);
      if (event.target) event.target.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl sm:text-4xl font-black text-slate-800 tracking-tight">
          {employeeId ? 'My Documents' : 'Document Vault'}
        </h2>
        {!readOnly && (
          <div className="flex gap-3">
            <button 
              onClick={handleCreateFolder}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Folder
            </button>
            <button 
              onClick={handleUpload}
              disabled={isUploading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all disabled:opacity-50"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {isUploading ? 'Uploading...' : 'Upload File'}
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 p-5 space-y-6">
            <div className="space-y-2">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Categories</h4>
              <div className="space-y-1 overflow-x-auto no-scrollbar flex md:block gap-2 pb-2 md:pb-0">
                <button 
                  onClick={() => navigateToFolder(null)}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap",
                    currentFolderId === null ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-600"
                  )}
                >
                  <Files className="w-4 h-4" />
                  All Files
                </button>
                {rootFolders.map(f => (
                  <button 
                    key={f.id} 
                    onClick={() => handleFolderClick(f)}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap",
                      currentFolderId === f.id ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-600"
                    )}
                  >
                    {f.password ? <Lock className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
            {!readOnly && (
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Storage Status</h4>
                <div className="space-y-2">
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full w-2/3 bg-indigo-600 rounded-full" />
                  </div>
                  <p className="text-[10px] text-slate-500 font-black">1.2 GB of 2.0 GB used</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="md:col-span-3 bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden flex flex-col min-h-[600px]">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBackNavigation}
                  disabled={backHistory.length === 0}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleForwardNavigation}
                  disabled={forwardHistory.length === 0}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Forward"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex min-w-0 items-center gap-2 overflow-x-auto no-scrollbar">
                <button type="button" onClick={() => navigateToFolder(null)} className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-slate-500 transition hover:border-indigo-100 hover:bg-white hover:text-indigo-600">
                  <Home className="w-3.5 h-3.5" />
                  <span>Vault</span>
                </button>
                {buildFolderPath(currentFolderId).map((folder) => (
                  <React.Fragment key={folder.id}>
                    <ChevronRight className="w-3 h-3 shrink-0 text-slate-300" />
                    <button
                      type="button"
                      onClick={() => navigateToFolder(folder.id)}
                      className={cn("max-w-[180px] truncate rounded-lg border border-transparent px-2 py-1 transition hover:border-indigo-100 hover:bg-white", folder.id === currentFolderId ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-indigo-600")}
                      title={folder.name}
                    >
                      {folder.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search vault..." 
                className="pl-9 pr-4 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-600/20 outline-none w-48 transition-all focus:w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1">
            {items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                      <th className="px-6 py-4">Name</th>
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Size</th>
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map(item => (
                      <tr key={item.id} className="hover:bg-indigo-50/30 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {item.type === 'folder' ? (
                              item.password ? <Lock className="w-5 h-5 text-amber-500" /> : <Folder className="w-5 h-5 text-indigo-400" />
                            ) : (
                              <FileText className="w-5 h-5 text-slate-400" />
                            )}
                            <button 
                              type="button"
                              onClick={() => handleFolderClick(item)}
                              className={cn("text-sm font-bold text-slate-800", item.type === 'folder' && "hover:text-indigo-600")}
                            >
                              {item.name}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">{item.extension || 'Folder'}</td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-medium">{item.size || '—'}</td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-medium">{formatVaultDate(item.date)}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1 transition-all">
                            <Tooltip content={item.type === 'folder' ? 'Download Folder ZIP' : 'Download File'}>
                              <button 
                                onClick={() => handleDownload(item)}
                                className="p-2 hover:bg-indigo-50 rounded-xl text-indigo-400 hover:text-indigo-600 transition-colors"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </Tooltip>
                            {!readOnly && (
                              <Tooltip content="Delete File">
                                <button 
                                  onClick={() => {
                                    setItemToDelete(item.id);
                                    setIsConfirmOpen(true);
                                  }}
                                  className="p-2 hover:bg-rose-50 rounded-xl text-rose-400 hover:text-rose-600 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-20 space-y-6">
                <div className="w-24 h-24 bg-indigo-50 rounded-[40px] flex items-center justify-center shadow-inner">
                  <FileText className="w-10 h-10 text-indigo-400" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-slate-800">No documents found</h3>
                  <p className="text-sm text-slate-500 max-w-xs mx-auto font-medium leading-relaxed">This folder is currently empty.</p>
                </div>
                {!readOnly && (
                  <button 
                    onClick={handleUpload}
                    className="px-8 py-3 rounded-2xl font-black text-sm bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
                  >
                    Upload Now
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => {
          setIsConfirmOpen(false);
          setItemToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone and will also delete all contents if it's a folder."
        confirmText="Delete"
        variant="danger"
      />

      {/* Password Prompt Modal */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-10 space-y-8">
              <div className="space-y-2 text-center">
                <div className="w-20 h-20 bg-amber-50 rounded-[32px] flex items-center justify-center mx-auto mb-6">
                  <Lock className="w-10 h-10 text-amber-500" />
                </div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">Locked Folder</h3>
                <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Enter password to access contents</p>
              </div>

              <form onSubmit={handleVerifyPassword} className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Password</label>
                  <input 
                    type="password" 
                    value={enteredPassword}
                    onChange={(e) => setEnteredPassword(e.target.value)}
                    autoFocus
                    required 
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 outline-none font-bold text-sm" 
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsPasswordModalOpen(false);
                      setFolderToOpen(null);
                      setPasswordToVerify('');
                      setEnteredPassword('');
                    }}
                    className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 px-6 py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all"
                  >
                    Unlock
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
