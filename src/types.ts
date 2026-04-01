export type Shift = {
  id: string;
  client_id?: string | null;
  label: string;
  start: string; // HH:mm
  end: string;   // HH:mm
  lunch: number; // minutes
  crosses_saturday_into_sunday?: boolean;
  saturday_lunch_hours?: number;
  sunday_lunch_hours?: number;
};

export type Employee = {
  id: string;
  client_id?: string;
  emp_id: string;
  pin?: string;
  first_name: string;
  last_name: string;
  start_date: string;
  id_number?: string;
  passport?: string;
  dob: string;
  cell?: string;
  email?: string;
  job_title: string;
  department: string;
  address1?: string;
  address2?: string;
  address3?: string;
  address4?: string;
  street_number?: string;
  residency?: string;
  province?: string;
  country_of_issue?: string;
  postal_code?: string;
  tax_number?: string;
  bank_name?: string;
  portal_enabled?: 'yes' | 'no' | '';
  account_holder?: string;
  account_no?: string;
  account_type?: string;
  classification?: string;
  pay_rate: number;
  ismibco?: 'yes' | 'no' | '';
  isunion?: 'yes' | 'no' | '';
  union_name?: string;
  paye_credit?: string;
  annual_leave?: number;
  sick_leave?: number;
  family_leave?: number;
  status?: 'active' | 'offboarded';
  last_worked?: string;
  last_worked_date?: string;
  delete_reason?: string;
  image?: string; // base64 or URL
  fallbackImage?: string; // client fallback logo
};

export type RosterAssignment = {
  employee_id: string;
  day_date: string; // YYYY-MM-DD
  shift_id: string | null;
};

export type RosterDefinition = 
  | 'shortages'
  | 'uniform'
  | 'salary_advance'
  | 'staff_loan'
  | 'overthrows'
  | 'oil_spill'
  | 'stock_shortage'
  | 'unpaid_hours'
  | 'annual_bonus'
  | 'incentive_bonus'
  | 'data_allowance'
  | 'night_shift_allowance'
  | 'medical_allowance'
  | 'mibco_health_insurance'
  | 'health_insurance'
  | 'garnishee'
  | 'cell_phone_payment'
  | 'income_tax_registration'
  | 'performance_incentive'
  | 'commission'
  | 'sales_commission'
  | 'notes';

export type ClientSettings = {
  id: string;
  client_id: string;
  roster_start_day: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 1 = Monday, etc.
  roster_duration: '1_week' | '2_weeks' | '1_month';
  enabled_definitions: RosterDefinition[];
};

export type RosterMeta = {
  employee_id: string;
  week_start: string; // YYYY-MM-DD
} & {
  [key in RosterDefinition]?: string;
};

export type FileItem = {
  id: string;
  name: string;
  type: 'file' | 'folder';
  parent_id: string | null;
  employee_id?: string;
  size?: string;
  date: string;
  extension?: string;
  url?: string;
  password?: string;
};

export type OffboardReason = 
  | 'deceased' 
  | 'retired' 
  | 'dismissed' 
  | 'contract_expired' 
  | 'resigned' 
  | 'constructively_dismissed' 
  | 'employers_insolvency' 
  | 'maternity_leave' 
  | 'adoption_leave' 
  | 'illness_medically_boarded' 
  | 'retrenched_staff_reduction' 
  | 'transfer_branch' 
  | 'absconded' 
  | 'business_closed' 
  | 'voluntary_severance' 
  | 'reduced_working_time' 
  | 'parental_leave' 
  | 'other';

export type InternalPermission = 
  | 'view_clients'
  | 'view_tickets'
  | 'view_logs'
  | 'view_global_logs'
  | 'view_client_logs'
  | 'view_payroll'
  | 'view_files'
  | 'view_employees'
  | 'manage_client_users'
  | 'view_analytics'
  | 'edit_client_details'
  | 'submit_payroll'
  | 'resolve_tickets';

export type UserRole = 'admin' | 'user' | 'superadmin' | 'staff';

export type User = {
  id: string;
  email: string;
  role: UserRole;
  is_verified?: boolean;
  client_id?: string;
  image?: string; // base64 or URL
  fallbackImage?: string; // client fallback logo
  isTrial?: boolean;
  trialEndDate?: string;
  trialExpired?: boolean;
  trialDaysRemaining?: number;
  client_name?: string | null;
  lockedFeatures?: string[];
  enabledDefinitions?: RosterDefinition[];
  roster_start_day?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  roster_duration?: '1_week' | '2_weeks' | '1_month';
  mfa_required?: boolean;
  mfa_enabled?: boolean;
  mfaPending?: boolean;
  lastLogin?: string;
  permissions?: InternalPermission[];
  assigned_clients?: string[];
  full_name?: string;
  status?: 'active' | 'deactivated';
};

export type Client = {
  id: string;
  name: string;
  created_at: string;
  fallbackImage?: string; // base64 or URL
  lockedFeatures?: string[];
  dashboardType?: 'rostering' | 'non-rostering';
  isTrial?: boolean;
  trialDuration?: 3 | 5 | 7;
  enabledDefinitions?: RosterDefinition[];
  rosterStartDay?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  rosterDuration?: '1_week' | '2_weeks' | '1_month';
  trialStartedAt?: string | null;
  trialEndDate?: string | null;
  trialExpired?: boolean;
  trialDaysRemaining?: number;
};

export type ClientStats = {
  employeeCount: number;
  userCount: number;
  fileCount: number;
};

export type SuperUser = User & {
  client_name?: string;
};

export type ClientFile = {
  id: string;
  client_id: string;
  client_name?: string;
  name: string;
  type: 'file' | 'folder';
  size?: string;
  date: string;
  extension?: string;
  path?: string;
  parent_id?: string | null;
  password?: string;
};

export type AuthStatus = {
  user: User | null;
  loading: boolean;
};

export type LeaveType = 'annual' | 'sick' | 'family' | 'unpaid' | 'half_day';

export type LeaveStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export type LeaveRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  is_half_day?: boolean;
  status: LeaveStatus;
  notes?: string;
  attachment_url?: string;
  admin_notes?: string;
  created_at: string;
  updated_at?: string;
  days?: number;
  source?: 'manual' | 'roster';
};

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TicketComment = {
  id: string;
  ticket_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_image?: string;
  role: UserRole;
  message: string;
  created_at: string;
  tagged_users?: string[]; // Array of user IDs
};

export type SupportTicket = {
  id: string;
  client_id: string;
  client_name?: string;
  user_id: string;
  user_email: string;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  created_at: string;
  updated_at: string;
  admin_notes?: string;
  comments?: TicketComment[];
};


export type EmployeePayrollBreakdown = {
  employeeName: string;
  regularHours: number;
  overtimeHours: number;
  leaveHours: number;
  grossPay: number;
};

export type PayrollSubmissionStatus = 'pending' | 'processed' | 'archived';

export type PayrollSubmission = {
  id: string;
  clientId?: string;
  clientName: string;
  submittedBy: string;
  submittedAt: string;
  periodStart?: string;
  periodEnd?: string;
  period: string;
  employeeCount: number;
  status: PayrollSubmissionStatus;
  totalHours: number;
  totalPay: number;
  processedBy?: string;
  processedAt?: string;
  employeeBreakdown?: EmployeePayrollBreakdown[];
};

export type InternalNotificationType = 'support_tag' | 'support_comment' | 'support_resolved' | 'payroll_submission' | 'worker_failed' | 'system_alert' | 'general';

export type InternalNotification = {
  id: string;
  type: InternalNotificationType;
  title: string;
  message: string;
  created_at: string;
  updated_at?: string;
  read: boolean;
  read_at?: string | null;
  link?: string | null;
  actor_user_id?: string | null;
  client_id?: string | null;
  metadata?: {
    ticket_id?: string;
    client_id?: string;
    user_id?: string;
    comment_id?: string;
    [key: string]: unknown;
  };
};
