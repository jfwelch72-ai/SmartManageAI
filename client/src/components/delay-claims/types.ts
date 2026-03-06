import type { DelayClaim } from "@shared/schema";

export interface ClaimWithRelations extends DelayClaim {
  project?: {
    id: string;
    name: string;
    code: string;
  };
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  submittedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  reviewedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  approvedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}
