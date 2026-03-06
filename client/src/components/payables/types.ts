export interface Payable {
  id: string;
  organizationId: string;
  contractId: string;
  paymentNumber: number;
  amount: string;
  retentionHeld: string | null;
  paymentDate: string | null;
  description: string | null;
  invoiceNumber: string | null;
  status: string;
  approvedById: string | null;
  approvedAt: string | null;
  rejectedById: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  paidById: string | null;
  paidAt: string | null;
  checkNumber: string | null;
  paymentMethod: string | null;
  autoCreated: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  contract: {
    id: string;
    contractNumber: string;
    scopeOfWork: string;
    contractAmount: string;
  };
  subcontractor: {
    id: string;
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
  };
  project: {
    id: string;
    name: string;
    code: string;
  };
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

export interface PayableSummary {
  pending: { count: number; total: number };
  approved: { count: number; total: number };
  paid: { count: number; total: number };
  rejected: { count: number; total: number };
  totalPayables: number;
}
