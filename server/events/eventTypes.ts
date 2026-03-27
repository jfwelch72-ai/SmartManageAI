export interface EventEnvelope {
  version: number;
  orgId: string;
  actorId: string;
  timestamp: Date;
}

export interface ProjectCreatedEvent extends EventEnvelope {
  type: "project.created";
  payload: {
    projectId: string;
    projectCode: string;
    name: string;
    projectStatus: string;
  };
}

export interface ProjectStatusChangedEvent extends EventEnvelope {
  type: "project.status_changed";
  payload: {
    projectId: string;
    projectCode: string;
    oldStatus: string;
    newStatus: string;
  };
}

export interface BidSubmittedEvent extends EventEnvelope {
  type: "bid.submitted";
  payload: {
    bidId: string;
    bidCode: string;
    title: string;
    clientName: string;
  };
}

export interface BidConvertedToProjectEvent extends EventEnvelope {
  type: "bid.converted_to_project";
  payload: {
    bidId: string;
    bidCode: string;
    projectId: string;
    projectCode: string;
  };
}

export interface ChangeOrderApprovedEvent extends EventEnvelope {
  type: "change_order.approved";
  payload: {
    changeOrderId: string;
    projectId: string;
    amount: number;
    approvedBy: string;
  };
}

export interface ChangeOrderRejectedEvent extends EventEnvelope {
  type: "change_order.rejected";
  payload: {
    changeOrderId: string;
    projectId: string;
    reason: string;
    rejectedBy: string;
  };
}

export interface TimeclockCheckedInEvent extends EventEnvelope {
  type: "timeclock.checked_in";
  payload: {
    shiftId: string;
    userId: string;
    projectId: string | null;
    lat: number | null;
    lng: number | null;
  };
}

export interface TimeclockCheckedOutEvent extends EventEnvelope {
  type: "timeclock.checked_out";
  payload: {
    shiftId: string;
    userId: string;
    totalHours: number;
    projectId: string | null;
  };
}

export interface PayrollRunCompletedEvent extends EventEnvelope {
  type: "payroll.run.completed";
  payload: {
    payRunId: string;
    periodStart: string;
    periodEnd: string;
    totalGross: number;
    employeeCount: number;
  };
}

export interface HiringJobPublishedEvent extends EventEnvelope {
  type: "hiring.job_published";
  payload: {
    jobId: string;
    title: string;
    employmentType: string | null;
  };
}

export interface HiringCandidateAppliedEvent extends EventEnvelope {
  type: "hiring.candidate_applied";
  payload: {
    candidateId: string;
    jobId: string | null;
    fullName: string;
  };
}

export interface HiringCandidateStageChangedEvent extends EventEnvelope {
  type: "hiring.candidate_stage_changed";
  payload: {
    candidateId: string;
    fullName: string;
    fromStage: string | null;
    toStage: string;
  };
}

export interface HiringCandidateHiredEvent extends EventEnvelope {
  type: "hiring.candidate_hired";
  payload: {
    candidateId: string;
    fullName: string;
    jobId: string | null;
  };
}

export interface HiringInterviewScheduledEvent extends EventEnvelope {
  type: "hiring.interview_scheduled";
  payload: {
    interviewId: string;
    candidateId: string | null;
    jobId: string | null;
    scheduledAt: string | null;
    interviewType: string | null;
  };
}

export interface HiringIntegrationConnectedEvent extends EventEnvelope {
  type: "hiring.integration_connected";
  payload: {
    integrationId: string;
    providerName: string;
  };
}

export interface BidStatusChangedEvent extends EventEnvelope {
  type: "bid.status_changed";
  payload: {
    bidId: string;
    bidCode: string;
    title: string;
    oldStatus: string;
    newStatus: string;
  };
}

export interface BidAssignedEvent extends EventEnvelope {
  type: "bid.assigned";
  payload: {
    bidId: string;
    bidCode: string;
    title: string;
    estimatorId: string;
    estimatorName: string | null;
  };
}

export interface BidDueDateApproachingEvent extends EventEnvelope {
  type: "bid.due_date_approaching";
  payload: {
    bidId: string;
    bidCode: string;
    title: string;
    dueDate: string;
    hoursRemaining: number;
    estimatorId: string | null;
  };
}

export type DomainEvent =
  | ProjectCreatedEvent
  | ProjectStatusChangedEvent
  | BidSubmittedEvent
  | BidConvertedToProjectEvent
  | ChangeOrderApprovedEvent
  | ChangeOrderRejectedEvent
  | TimeclockCheckedInEvent
  | TimeclockCheckedOutEvent
  | PayrollRunCompletedEvent
  | HiringJobPublishedEvent
  | HiringCandidateAppliedEvent
  | HiringCandidateStageChangedEvent
  | HiringCandidateHiredEvent
  | HiringInterviewScheduledEvent
  | HiringIntegrationConnectedEvent
  | BidStatusChangedEvent
  | BidAssignedEvent
  | BidDueDateApproachingEvent
  | BudgetAlertTriggeredEvent
  | CrmOpportunityCreatedEvent
  | CrmOpportunityStageChangedEvent
  | CrmActivityCreatedEvent;

export interface BudgetAlertTriggeredEvent extends EventEnvelope {
  type: "budget.alert_triggered";
  payload: {
    projectId: string;
    projectCode: string;
    costCode: string | null;
    alertLevel: string;
    thresholdPercent: number;
    currentPercent: number;
  };
}

export interface CrmOpportunityCreatedEvent extends EventEnvelope {
  type: "crm.opportunity_created";
  payload: {
    opportunityId: string;
    name: string;
    stage: string;
  };
}

export interface CrmOpportunityStageChangedEvent extends EventEnvelope {
  type: "crm.opportunity_stage_changed";
  payload: {
    opportunityId: string;
    name: string;
    oldStage: string;
    newStage: string;
  };
}

export interface CrmActivityCreatedEvent extends EventEnvelope {
  type: "crm.activity_created";
  payload: {
    opportunityId: string;
    activityType: string;
  };
}

export type DomainEventType = DomainEvent["type"];

export const ALL_DOMAIN_EVENT_TYPES: DomainEventType[] = [
  "project.created",
  "project.status_changed",
  "bid.submitted",
  "bid.converted_to_project",
  "bid.status_changed",
  "bid.assigned",
  "bid.due_date_approaching",
  "change_order.approved",
  "change_order.rejected",
  "timeclock.checked_in",
  "timeclock.checked_out",
  "payroll.run.completed",
  "hiring.job_published",
  "hiring.candidate_applied",
  "hiring.candidate_stage_changed",
  "hiring.candidate_hired",
  "hiring.interview_scheduled",
  "hiring.integration_connected",
  "budget.alert_triggered",
  "crm.opportunity_created",
  "crm.opportunity_stage_changed",
  "crm.activity_created",
];
