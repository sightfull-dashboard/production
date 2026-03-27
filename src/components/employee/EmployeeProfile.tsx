import React, { useState } from 'react';
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar, 
  Shield, 
  Lock, 
  Bell, 
  Camera,
  CheckCircle2,
  ChevronRight,
  LogOut,
  Briefcase,
  Building2,
  CreditCard
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Employee } from '../../types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

interface EmployeeProfileProps {
  employee: Employee;
  onLogout: () => void;
}

export const EmployeeProfile: React.FC<EmployeeProfileProps> = ({ employee, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'personal' | 'employment' | 'settings'>('personal');
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = () => {
    setIsEditing(false);
    toast.success('Profile updated successfully');
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="flex items-center gap-8">
          <div className="relative group">
            <div className="w-32 h-32 bg-emerald-100 rounded-[48px] flex items-center justify-center text-4xl font-black text-emerald-600 shadow-2xl shadow-emerald-100 border-4 border-white">
              {employee.first_name[0]}{employee.last_name[0]}
            </div>
            <button className="absolute bottom-0 right-0 w-10 h-10 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-slate-800 transition-all shadow-lg shadow-slate-200">
              <Camera className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-2">
            <h2 className="text-4xl font-black text-slate-800 tracking-tight">{employee.first_name} {employee.last_name}</h2>
            <div className="flex flex-wrap items-center gap-4">
              <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-black rounded-lg uppercase tracking-widest border border-emerald-200">
                {employee.role || 'Employee'}
              </span>
              <span className="text-slate-400 font-bold text-sm flex items-center gap-1.5">
                <Building2 className="w-4 h-4" />
                {employee.department || 'Operations'}
              </span>
              <span className="text-slate-400 font-bold text-sm flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                Joined {employee.hire_date || 'Jan 2024'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsEditing(!isEditing)}
            className={cn(
              "px-8 py-4 rounded-2xl font-black transition-all shadow-xl shadow-slate-200",
              isEditing ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-slate-900 text-white hover:bg-slate-800"
            )}
          >
            {isEditing ? 'Cancel Editing' : 'Edit Profile'}
          </button>
          {isEditing && (
            <button 
              onClick={handleSave}
              className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-black hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-200"
            >
              Save Changes
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
        {/* Sidebar Tabs */}
        <div className="lg:col-span-1 space-y-2">
          {[
            { id: 'personal', label: 'Personal Details', icon: User },
            { id: 'employment', label: 'Employment Info', icon: Briefcase },
            { id: 'settings', label: 'Account Settings', icon: Shield },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "w-full flex items-center justify-between p-5 rounded-[24px] transition-all group",
                activeTab === tab.id 
                  ? "bg-white text-slate-800 shadow-xl shadow-slate-200/50 border border-slate-100" 
                  : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              )}
            >
              <div className="flex items-center gap-4">
                <tab.icon className={cn(
                  "w-6 h-6 transition-colors",
                  activeTab === tab.id ? "text-emerald-600" : "text-slate-300 group-hover:text-slate-400"
                )} />
                <span className="font-black text-sm uppercase tracking-widest">{tab.label}</span>
              </div>
              <ChevronRight className={cn(
                "w-5 h-5 transition-transform",
                activeTab === tab.id ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"
              )} />
            </button>
          ))}
          
          <div className="pt-8">
            <button 
              onClick={onLogout}
              className="w-full flex items-center gap-4 p-5 text-rose-500 hover:bg-rose-50 rounded-[24px] transition-all group"
            >
              <LogOut className="w-6 h-6" />
              <span className="font-black text-sm uppercase tracking-widest">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          <AnimatePresence mode="wait">
            {activeTab === 'personal' && (
              <motion.div
                key="personal"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-white rounded-[40px] p-10 shadow-xl shadow-slate-200/50 border border-slate-100 space-y-10"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">First Name</label>
                    <input 
                      type="text" 
                      defaultValue={employee.first_name}
                      disabled={!isEditing}
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800 disabled:opacity-60 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Last Name</label>
                    <input 
                      type="text" 
                      defaultValue={employee.last_name}
                      disabled={!isEditing}
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800 disabled:opacity-60 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input 
                        type="email" 
                        defaultValue={employee.email}
                        disabled={!isEditing}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800 disabled:opacity-60 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Phone Number</label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input 
                        type="tel" 
                        defaultValue="+27 82 123 4567"
                        disabled={!isEditing}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800 disabled:opacity-60 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Residential Address</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input 
                      type="text" 
                      defaultValue="123 Main Road, Cape Town, 8001"
                      disabled={!isEditing}
                      className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800 disabled:opacity-60 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'employment' && (
              <motion.div
                key="employment"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-white rounded-[40px] p-10 shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
                    <div className="w-16 h-16 bg-indigo-100 rounded-[24px] flex items-center justify-center">
                      <Briefcase className="w-8 h-8 text-indigo-600" />
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-2xl font-black text-slate-800 tracking-tight">Job Details</h3>
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Position</p>
                          <p className="font-black text-slate-800 text-lg">{employee.role || 'Senior Operations Specialist'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Department</p>
                          <p className="font-black text-slate-800 text-lg">{employee.department || 'Operations'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Employment Type</p>
                          <p className="font-black text-slate-800 text-lg">Full-Time Permanent</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-[40px] p-10 shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
                    <div className="w-16 h-16 bg-emerald-100 rounded-[24px] flex items-center justify-center">
                      <CreditCard className="w-8 h-8 text-emerald-600" />
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-2xl font-black text-slate-800 tracking-tight">Payroll Info</h3>
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Bank Name</p>
                          <p className="font-black text-slate-800 text-lg">Standard Bank</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Account Number</p>
                          <p className="font-black text-slate-800 text-lg">**** 4567</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tax Number</p>
                          <p className="font-black text-slate-800 text-lg">9876543210</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-white rounded-[40px] p-10 shadow-xl shadow-slate-200/50 border border-slate-100 space-y-10"
              >
                <div className="space-y-6">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">Security & Notifications</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                          <Bell className="w-6 h-6 text-slate-400" />
                        </div>
                        <div>
                          <p className="font-black text-slate-800">Email Notifications</p>
                          <p className="text-xs text-slate-500 font-bold">Receive updates about leave requests and shifts.</p>
                        </div>
                      </div>
                      <button className="w-12 h-6 bg-emerald-600 rounded-full relative">
                        <div className="absolute top-1 right-1 w-4 h-4 bg-white rounded-full" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                          <Lock className="w-6 h-6 text-slate-400" />
                        </div>
                        <div>
                          <p className="font-black text-slate-800">Two-Factor Authentication</p>
                          <p className="text-xs text-slate-500 font-bold">Add an extra layer of security to your account.</p>
                        </div>
                      </div>
                      <button className="px-6 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all">
                        Enable
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-10 border-t border-slate-50 space-y-6">
                  <h3 className="text-2xl font-black text-rose-600 tracking-tight">Danger Zone</h3>
                  <div className="p-8 bg-rose-50 rounded-[32px] border border-rose-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-1">
                      <p className="font-black text-rose-800">Deactivate Account</p>
                      <p className="text-xs text-rose-600 font-bold">This will disable your access to the portal. Contact HR to reactivate.</p>
                    </div>
                    <button className="px-8 py-4 bg-rose-600 text-white rounded-2xl font-black hover:bg-rose-700 transition-all shadow-xl shadow-rose-100">
                      Deactivate
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
