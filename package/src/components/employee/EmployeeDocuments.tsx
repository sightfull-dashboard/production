import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Download, Search, Eye, FileCode, FileType, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Employee, FileItem } from '../../types';
import { fileService } from '../../services/fileService';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { format } from 'date-fns';
import { BrandedState } from '../BrandedStates';

interface EmployeeDocumentsProps {
  employee: Employee;
}

export const EmployeeDocuments: React.FC<EmployeeDocumentsProps> = ({ employee }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'payslip' | 'contract' | 'policy'>('all');
  const [documents, setDocuments] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDocuments = async () => {
      try {
        const data = await fileService.list({ employee_id: employee.id });
        setDocuments(data.filter((item) => item.type === 'file'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load documents');
      } finally {
        setLoading(false);
      }
    };
    loadDocuments();
  }, [employee.id]);

  const inferType = (doc: FileItem): 'payslip' | 'contract' | 'policy' => {
    const name = doc.name.toLowerCase();
    if (name.includes('payslip')) return 'payslip';
    if (name.includes('contract')) return 'contract';
    return 'policy';
  };

  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      const inferredType = inferType(doc);
      const matchesFilter = filter === 'all' || inferredType === filter;
      const matchesSearch = doc.name.toLowerCase().includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [documents, filter, search]);

  const getDocIcon = (type: string) => {
    switch (type) {
      case 'payslip': return <FileText className="w-6 h-6 text-emerald-600" />;
      case 'contract': return <FileCode className="w-6 h-6 text-indigo-600" />;
      case 'policy': return <FileType className="w-6 h-6 text-amber-600" />;
      default: return <FileText className="w-6 h-6 text-slate-400" />;
    }
  };

  const getDocBg = (type: string) => {
    switch (type) {
      case 'payslip': return 'bg-emerald-100';
      case 'contract': return 'bg-indigo-100';
      case 'policy': return 'bg-amber-100';
      default: return 'bg-slate-100';
    }
  };

  const handleDownload = async (doc: FileItem) => {
    try {
      const data = await fileService.download(doc.id);
      if (!data.url) throw new Error('This document has no downloadable content yet.');
      const link = document.createElement('a');
      link.href = data.url;
      link.download = data.name || doc.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download document');
    }
  };

  const handlePreview = async (doc: FileItem) => {
    try {
      const data = await fileService.download(doc.id);
      if (!data.url) throw new Error('This document has no preview content yet.');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open document');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">My Documents</h2>
          <p className="text-slate-500 font-bold">Access your payslips, contracts, and company policies.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-12 pr-4 py-3 bg-white border border-slate-100 rounded-2xl font-bold text-slate-800 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all w-64 shadow-sm"
            />
          </div>
          <div className="flex p-1 bg-white border border-slate-100 rounded-2xl shadow-sm">
            {(['all', 'payslip', 'contract', 'policy'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  filter === s ? "bg-slate-800 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredDocs.map(doc => {
          const inferredType = inferType(doc);
          return (
            <motion.div 
              key={doc.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-[40px] p-8 shadow-xl shadow-slate-200/50 border border-slate-100 group hover:border-emerald-200 transition-all relative overflow-hidden"
            >
              <div className="relative z-10 space-y-6">
                <div className="flex items-center justify-between">
                  <div className={cn("w-16 h-16 rounded-[24px] flex items-center justify-center transition-transform group-hover:scale-110", getDocBg(inferredType))}>
                    {getDocIcon(inferredType)}
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-800 tracking-tight line-clamp-1">{doc.name}</h3>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{inferredType} • {doc.size || 'Unknown size'}</p>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                  <p className="text-xs text-slate-500 font-bold">Uploaded {format(new Date(doc.date), 'MMM d, yyyy')}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handlePreview(doc)} className="p-3 bg-slate-50 text-slate-400 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 transition-all">
                      <Eye className="w-5 h-5" />
                    </button>
                    <button onClick={() => handleDownload(doc)} className="p-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200">
                      <Download className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="absolute top-[-20px] right-[-20px] w-32 h-32 bg-slate-50 rounded-full group-hover:bg-emerald-50 transition-colors" />
            </motion.div>
          );
        })}
      </div>

      {filteredDocs.length === 0 && (
        <BrandedState 
          type="empty" 
          portal="employee" 
          title="No Documents Found" 
          message="Try searching for something else or upload documents from the admin side." 
        />
      )}
    </div>
  );
};

