export interface SovProject {
  id: string;
  code: string;
  name: string;
  clientName: string;
  contractAmount: string | null;
}

export interface SOVLineItem {
  id: string;
  sovId: string;
  itemNumber: number;
  description: string;
  scheduledValue: string;
  previouslyBilled: string;
  currentBilled: string;
  storedMaterials: string;
  totalCompleted: string;
  percentComplete: string;
  balanceToFinish: string;
  retainage: string;
  sortOrder: number;
  category: string | null;
  totalCompletedAndStored?: string | null;
  thisPeriodCompleted?: string | null;
  previouslyCompleted?: string | null;
}

export interface SOV {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  sovNumber: string;
  title: string;
  description: string | null;
  status: string;
  contractAmount: string;
  totalScheduledValue: string;
  totalPreviouslyBilled: string;
  totalCurrentBilled: string;
  totalStoredMaterials: string;
  totalCompleted: string;
  overallPercentComplete: string;
  totalBalanceToFinish: string;
  totalRetainage: string;
  lineItems: SOVLineItem[];
  createdAt: string;
  updatedAt: string | null;
  createdByName: string | null;
}
