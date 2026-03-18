export interface EventEnvelope {
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
    clientName: string;
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
    latitude: number | null;
    longitude: number | null;
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

export type DomainEvent =
  | ProjectCreatedEvent
  | ProjectStatusChangedEvent
  | BidSubmittedEvent
  | BidConvertedToProjectEvent
  | ChangeOrderApprovedEvent
  | ChangeOrderRejectedEvent
  | TimeclockCheckedInEvent
  | TimeclockCheckedOutEvent
  | PayrollRunCompletedEvent;

export type DomainEventType = DomainEvent["type"];
