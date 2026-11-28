export type Lang = 'bn' | 'en';
export type ThemeMode = 'light' | 'dark';

export type NavKey =
  | 'dash'
  | 'students'
  | 'due'
  | 'inactive'
  | 'jobs'
  | 'outs'
  | 'staff'
  | 'companies'
  | 'store'
  | 'prices'
  | 'returns'
  | 'cash'
  | 'generalAccounts'
  | 'reports'
  | 'monthly'
  | 'admin'
  | 'settings'
  | 'docs';

export type OverseasStatus =
  | 'Not Applied'
  | 'Interview Attended'
  | 'Selected'
  | 'Visa Processing'
  | 'Flight Ready';

export interface CenterSettings {
  id: string;
  ownerId: string;
  name: string;
  subtitle: string;
  address: string;
  phone: string;
  slipFooter: string;
  accountsPass: string;
  generalAccountsPass?: string;
  adminUser: string;
  adminPass: string;
  navOrder: NavKey[];
}

export type JobVerificationMethod = 'biometric' | 'supervisor';

export interface Student {
  id: string;
  ownerId: string;
  date: string;
  name: string;
  code: string;
  fatherName: string;
  motherName: string;
  phone: string;
  guardianPhone: string;
  district: string;
  nid?: string;
  trade: string;
  passportSubmitted?: boolean;
  passportNo: string;
  passportCopyData?: string;
  photoData?: string;
  bioEnrolled?: boolean;
  companyName: string;
  interviewPassedCompany?: string;
  interviewDate?: string;
  overseasStatus: OverseasStatus;
  destination: string;
  contract: number;
  deposit: number;
  note: string;
}

export interface JobEntry {
  id: string;
  ownerId: string;
  date: string;
  no: string;
  sid: string;
  sname: string;
  cat: string;
  pay: number;
  discount: number;
  paid: number;
  verificationMethod?: JobVerificationMethod;
  note: string;
}

export interface OutStudentJob {
  id: string;
  ownerId: string;
  date: string;
  no: string;
  name: string;
  phone: string;
  agent: string;
  cat: string;
  price: number;
  paid: number;
  paidTo: string;
  payRef: string;
  note: string;
}

export interface StaffMember {
  id: string;
  ownerId: string;
  date: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  nid: string;
  address: string;
  joinDate: string;
  bio: string;
  salary: number;
  paid: number;
  month: string;
}

export interface StaffPayment {
  id: string;
  ownerId: string;
  date: string;
  staffId: string;
  staffName: string;
  month: string;
  amount: number;
  method: string;
  note: string;
}

export interface OverseasCompany {
  id: string;
  ownerId: string;
  date: string;
  name: string;
  country: string;
  contact: string;
  phone: string;
  address: string;
  demand: string;
  contractsCount: number;
  workersCount: number;
  note: string;
}

export interface AgencyContract {
  id: string;
  ownerId: string;
  date: string;
  companyName: string;
  country: string;
  trade: string;
  workersCount: number;
  status: 'Active' | 'Completed' | 'Pending';
  note: string;
}

export interface StoreItem {
  id: string;
  ownerId: string;
  date: string;
  code: string;
  item: string;
  category: string;
  shop: string;
  memo: string;
  qty: number;
  unit: string;
  min: number;
}

export interface StoreLog {
  id: string;
  ownerId: string;
  date: string;
  itemId: string;
  code: string;
  itemName: string;
  movement: 'IN' | 'OUT';
  qty: number;
  shop: string;
  memo: string;
  amount: number;
  remarks: string;
}

export interface JobPrice {
  id: string;
  ownerId: string;
  cat: string;
  price: number;
  limit: number;
  active: boolean;
}

export type ReturnTypeOption = 'Retrain' | 'Plate Return' | 'Failed / Rework';

export interface JobReturn {
  id: string;
  ownerId: string;
  date: string;
  no: string;
  code: string;
  sname: string;
  cat: string;
  reason: string;
  act: ReturnTypeOption;
  fee: number;
}

export interface CashEntry {
  id: string;
  ownerId: string;
  date: string;
  type: 'in' | 'out';
  category: string;
  amt: number;
  note: string;
}

export interface GeneralAccountRow {
  id: string;
  ownerId: string;
  rowOrder: number;
  isOpening: boolean;
  date: string;
  inDesc: string;
  inCash: string;
  inBank: string;
  outDesc: string;
  outCash: string;
}

export type PassportStatus = 'Original Held' | 'Copy Submitted' | 'Pending';
export type MedicalStatus = 'Fit' | 'Pending' | 'Unfit';
export type PoliceStatus = 'Received' | 'Applied' | 'Pending';
export type CertStatus = 'Issued' | 'In Progress' | 'Pending';
export type VisaStatus = 'Stamped' | 'Processing' | 'Pending';
export type FlightStatus = 'Scheduled' | 'Waiting' | 'Departed';

export interface DocItem {
  id: string;
  ownerId: string;
  date: string;
  code: string;
  title: string;
  docNo: string;
  expiry: string;
  who: string;
  trade: string;
  phone: string;
  status: PassportStatus;
  medical: MedicalStatus;
  policeClearance: PoliceStatus;
  certificate: CertStatus;
  bmetVisa: VisaStatus;
  flightStatus: FlightStatus;
  flightDate: string;
  agencyCountry: string;
  note: string;
}

export interface AuditLog {
  id: string;
  ownerId: string;
  date: string;
  time: string;
  action: string;
  module: string;
  detail: string;
}

export interface SlipData {
  kind: 'job' | 'out';
  date: string;
  no: string;
  name: string;
  code?: string;
  cat: string;
  amount: number;
  discount?: number;
  paid: number;
  verificationMethod?: JobVerificationMethod;
  note?: string;
  isDueEntry?: boolean;
  dueAmount?: number;
  paymentPromiseDate?: string;
  supervisorName?: string;
  tokenPaymentNote?: string;
}

export interface WorkspaceBackup {
  version?: string;
  exportedAt?: string;
  set: Partial<CenterSettings>;
  students: Partial<Student>[];
  jobs: Partial<JobEntry>[];
  outs: Partial<OutStudentJob>[];
  staff: Partial<StaffMember>[];
  staffPayments?: Partial<StaffPayment>[];
  companies: Partial<OverseasCompany>[];
  agencyContracts?: Partial<AgencyContract>[];
  store: Partial<StoreItem>[];
  storeLogs?: Partial<StoreLog>[];
  prices: Partial<JobPrice>[];
  returns: Partial<JobReturn>[];
  cash: Partial<CashEntry>[];
  generalAccounts?: Partial<GeneralAccountRow>[];
  docs: Partial<DocItem>[];
  auditLogs?: Partial<AuditLog>[];
}
