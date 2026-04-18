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

export interface RiskStatusChangedEvent extends EventEnvelope {
  type: "risk.status_changed";
  payload: {
    riskId: string;
    projectId: string;
    title: string;
    oldStatus: string;
    newStatus: string;
    costImpactDollars: number | null;
    scheduleImpactDays: number | null;
    linkedCostCode: string | null;
    linkedChangeOrderId: string | null;
    autoCreateChangeOrder?: boolean;
  };
}

export interface TakeoffVersionSupersededEvent extends EventEnvelope {
  type: "takeoff.version_superseded";
  payload: {
    oldSheetId: string;
    newSheetId: string;
    projectId: string;
    organizationId: string;
    oldSheetName: string | null;
    newSheetName: string | null;
    revisionLabel: string | null;
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
  | CrmActivityCreatedEvent
  | DocumentRevisionCreatedEvent
  | SafetyIncidentCreatedEvent
  | CostLedgerPostedEvent
  | InspectionCompletedEvent
  | PoReceiptRecordedEvent
  | TmTicketApprovedEvent
  | SubcontractorPaymentMadeEvent
  | EquipmentActualLoggedEvent
  | ReceiptCreatedEvent
  | RiskStatusChangedEvent
  | TakeoffVersionSupersededEvent
  | HaulTicketCreatedEvent
  | HaulTicketApprovedEvent
  | HaulTicketVoidedEvent
  | DailyInspectorReportSubmittedEvent
  | DailyInspectorReportApprovedEvent
  | SwpppInspectionSubmittedEvent
  | MaterialCertificationUploadedEvent
  | MaterialCertificationVerifiedEvent
  | SuretyBondCreatedEvent
  | SuretyBondExpiringEvent
  | DbeGoalChangedEvent;

export interface PoReceiptRecordedEvent extends EventEnvelope {
  type: "po.receipt_recorded";
  payload: {
    receiptId: string;
    poId: string;
    projectId: string;
    items: Array<{ costCode: string | null; amount: number; description: string }>;
  };
}

export interface TmTicketApprovedEvent extends EventEnvelope {
  type: "tm_ticket.approved";
  payload: {
    ticketId: string;
    projectId: string;
    costCode: string | null;
    laborCost: number;
    equipmentCost: number;
    materialCost: number;
    grandTotal: number;
  };
}

export interface SubcontractorPaymentMadeEvent extends EventEnvelope {
  type: "subcontractor.payment_made";
  payload: {
    paymentId: string;
    contractId: string;
    projectId: string;
    costCode: string | null;
    amount: number;
  };
}

export interface EquipmentActualLoggedEvent extends EventEnvelope {
  type: "equipment.actual_logged";
  payload: {
    planId: string;
    projectId: string;
    costCode: string | null;
    actualCost: number;
  };
}

export interface ReceiptCreatedEvent extends EventEnvelope {
  type: "receipt.created";
  payload: {
    receiptId: string;
    projectId: string;
    costCode: string | null;
    amount: number;
    category: string | null;
  };
}

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

export interface DocumentRevisionCreatedEvent extends EventEnvelope {
  type: "document.revision_created";
  payload: {
    documentId: string;
    revisionId: string;
    revisionNumber: number;
    projectId: string;
    projectCode: string;
    documentTitle: string;
    sourceType: string;
    uploadedByUserId: string;
    uploadedByName: string | null;
  };
}

export interface SafetyIncidentCreatedEvent extends EventEnvelope {
  type: "safety.incident_created";
  payload: {
    incidentId: string;
    severity: string;
  };
}

export interface CostLedgerPostedEvent extends EventEnvelope {
  type: "cost_ledger.posted";
  payload: {
    projectId: string;
    totalAmount: string;
  };
}

export interface InspectionCompletedEvent extends EventEnvelope {
  type: "inspection.completed";
  payload: {
    projectId: string;
    inspectionId: string;
    status: string;
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
  "document.revision_created",
  "safety.incident_created",
  "cost_ledger.posted",
  "inspection.completed",
  "po.receipt_recorded",
  "tm_ticket.approved",
  "subcontractor.payment_made",
  "equipment.actual_logged",
  "receipt.created",
  "risk.status_changed",
  "takeoff.version_superseded",
  "haul_ticket.created",
  "haul_ticket.approved",
  "haul_ticket.voided",
  "daily_inspector_report.submitted",
  "daily_inspector_report.approved",
  "swppp_inspection.submitted",
  "material_certification.uploaded",
  "material_certification.verified",
  "surety_bond.created",
  "surety_bond.expiring",
  "dbe_goal.changed",
];

export interface HaulTicketCreatedEvent extends EventEnvelope {
  type: "haul_ticket.created";
  payload: {
    ticketId: string;
    projectId: string | null;
    materialClass: string | null;
    quantity: string | null;
    unit: string | null;
  };
}

export interface HaulTicketApprovedEvent extends EventEnvelope {
  type: "haul_ticket.approved";
  payload: {
    ticketId: string;
    projectId: string | null;
    approvedBy: string;
    totalCost: string | null;
  };
}

export interface HaulTicketVoidedEvent extends EventEnvelope {
  type: "haul_ticket.voided";
  payload: {
    ticketId: string;
    projectId: string | null;
    voidedBy: string;
    reason: string | null;
  };
}

export interface DailyInspectorReportSubmittedEvent extends EventEnvelope {
  type: "daily_inspector_report.submitted";
  payload: {
    reportId: string;
    projectId: string;
    reportDate: string;
    inspectorId: string;
  };
}

export interface DailyInspectorReportApprovedEvent extends EventEnvelope {
  type: "daily_inspector_report.approved";
  payload: {
    reportId: string;
    projectId: string;
    approvedBy: string;
  };
}

export interface SwpppInspectionSubmittedEvent extends EventEnvelope {
  type: "swppp_inspection.submitted";
  payload: {
    inspectionId: string;
    projectId: string;
    inspectionDate: string;
    deficienciesFound: boolean;
  };
}

export interface MaterialCertificationUploadedEvent extends EventEnvelope {
  type: "material_certification.uploaded";
  payload: {
    certificationId: string;
    projectId: string | null;
    materialType: string | null;
    isBuyAmericaCompliant: boolean | null;
  };
}

export interface MaterialCertificationVerifiedEvent extends EventEnvelope {
  type: "material_certification.verified";
  payload: {
    certificationId: string;
    projectId: string | null;
    verifiedBy: string;
    isCompliant: boolean | null;
  };
}

export interface SuretyBondCreatedEvent extends EventEnvelope {
  type: "surety_bond.created";
  payload: {
    bondId: string;
    projectId: string | null;
    bondType: string | null;
    bondAmount: string | null;
  };
}

export interface SuretyBondExpiringEvent extends EventEnvelope {
  type: "surety_bond.expiring";
  payload: {
    bondId: string;
    projectId: string | null;
    expirationDate: string;
    daysRemaining: number;
  };
}

export interface DbeGoalChangedEvent extends EventEnvelope {
  type: "dbe_goal.changed";
  payload: {
    goalId: string;
    projectId: string;
    certificationType: string | null;
    goalPercent: string | null;
    actualPercent: string | null;
  };
}
