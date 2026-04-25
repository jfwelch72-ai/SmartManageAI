export function getNotificationDestination(notification: {
  type: string;
  relatedEntityId?: string | null;
  relatedEntityType?: string | null;
  message?: string;
}): string | null {
  const { type, relatedEntityId, relatedEntityType, message } = notification;

  const projectCodeMatch = message?.match(/project\s+(\d+)/i);
  const projectCode = projectCodeMatch ? projectCodeMatch[1] : null;

  const getProjectDestination = () => {
    if ((relatedEntityType === "project" || relatedEntityType === "PROJECT") && relatedEntityId) {
      return `/projects/${relatedEntityId}`;
    }
    if (projectCode) {
      return `/projects/${projectCode}`;
    }
    return "/projects";
  };

  switch (type) {
    case "BILLING_READY":
      return getProjectDestination();

    case "CHANGE_ORDER_PENDING":
    case "CHANGE_ORDER_APPROVED":
    case "CHANGE_ORDER_REJECTED":
      if (relatedEntityType === "changeOrder" && relatedEntityId) {
        return projectCode ? `/projects/${projectCode}` : "/projects";
      }
      return getProjectDestination();

    case "TIME_OFF_REQUEST":
      return "/leave-management";

    case "MATERIAL_OVERAGE":
    case "PROJECT_ASSIGNMENT":
      return getProjectDestination();

    case "MAINTENANCE_REQUEST":
    case "REPAIR_REQUEST":
      if (relatedEntityType === "equipment" && relatedEntityId) {
        return `/equipment/${relatedEntityId}`;
      }
      return "/equipment";

    case "DELAY_SUBMITTED":
    case "DELAY_ACKNOWLEDGED":
    case "DELAY_CHANGE_ORDER_NEEDED":
      return getProjectDestination();

    case "PORTAL_ACTIVITY":
    case "PROGRESS_MILESTONE":
    case "DAILY_PROGRESS_LOGGED":
    case "SOV_ITEM_COMPLETED":
      return getProjectDestination();

    case "PORTAL_CHAT_MESSAGE":
      return "/portal-chat";

    case "BID_AWARDED":
      if (relatedEntityType === "bid_request" && relatedEntityId) {
        return `/bid-inbox/${relatedEntityId}`;
      }
      return "/bid-inbox";

    case "SUBMITTAL_SUBMITTED":
    case "SUBMITTAL_APPROVED":
    case "SUBMITTAL_REJECTED":
    case "SUBMITTAL_REVISION_REQUESTED":
      return getProjectDestination();

    case "TM_TICKET_SUBMITTED":
    case "TM_TICKET_APPROVED":
    case "TM_TICKET_REJECTED":
      return getProjectDestination();

    case "OVERTIME_REQUESTED":
    case "OVERTIME_APPROVED":
    case "OVERTIME_REJECTED":
      return "/time-clock-manager?tab=overtime";

    case "PAYABLE_SUBMITTED":
    case "PAYABLE_CREATED":
    case "PAYABLE_APPROVED":
    case "PAYABLE_REJECTED":
      return "/subcontractor-payables";

    case "APPROVAL_REQUEST_NEW":
    case "APPROVAL_REQUEST_APPROVED":
    case "APPROVAL_REQUEST_REJECTED":
      return "/approvals";

    case "CRM_STAGE_CHANGE":
    case "CRM_IDLE_OPPORTUNITY":
      return "/crm";

    case "CRM_CONTACT_REASSIGNED":
      return "/crm?tab=contacts&ownerFilter=me";

    case "CRM_OPPORTUNITY_REASSIGNED":
      if (relatedEntityId) {
        return `/crm?tab=opportunities&opportunityId=${relatedEntityId}`;
      }
      return "/crm?tab=opportunities&assignedFilter=me";

    case "CRM_ORGANIZATION_REASSIGNED":
      // Task #731: deep-link from the immediate notification opens the
      // assigned organisation's detail dialog; the bundled summary (no
      // entityId) lands on the orgs tab so the new owner can review them.
      if (relatedEntityId) {
        return `/crm?tab=orgs&organisationId=${relatedEntityId}`;
      }
      return "/crm?tab=orgs";

    case "PROJECT_REASSIGNED":
      if (relatedEntityId) {
        return `/projects/${relatedEntityId}`;
      }
      return "/projects";

    case "TASK_MENTIONED":
      if (relatedEntityId) {
        return `/projects?taskId=${relatedEntityId}`;
      }
      return "/projects";

    case "DOCUMENT_REVISION_CREATED":
      if (relatedEntityType === "drawingRevision" && relatedEntityId) {
        const parts = relatedEntityId.split(":");
        if (parts.length === 2) {
          return `/projects/${parts[0]}?tab=plans&documentId=${parts[1]}`;
        }
        return `/projects/${relatedEntityId}`;
      }
      return getProjectDestination();

    case "BID_ASSIGNED":
      if (relatedEntityType === "bid" && relatedEntityId) {
        return `/bids/${relatedEntityId}`;
      }
      return "/bids";

    case "BID_SUBMITTED":
    case "BID_STATUS_CHANGED":
    case "BID_DUE_DATE_APPROACHING":
      if (relatedEntityType === "bid" && relatedEntityId) {
        return `/bids/${relatedEntityId}`;
      }
      return "/bids";

    case "CRM_TRANSCRIPT_BACKFILL_REAPED":
      // Task #1005: clicking the "your backfill was reaped" notification
      // takes the admin straight to the page where they can kick off a
      // fresh backfill. relatedEntityId is the reaped job id but the page
      // is org-scoped, so we don't need to thread it through the URL.
      return "/admin/transcript-backfill";

    case "PROJECT_LOG_EMAIL_FAILED":
      // Task #1637 — clicking the failure notification opens the
      // project detail page, where the "Scheduled log emails" card on
      // the overview tab surfaces the "Last send failed" badge and
      // lets the editor fix recipients / re-trigger the cadence.
      // relatedEntityId is the project's human-readable `code`
      // (matching /api/projects/:code), so the wouter route at
      // /projects/:code resolves directly.
      if (relatedEntityType === "PROJECT_LOG_EMAIL_SCHEDULE" && relatedEntityId) {
        return `/projects/${relatedEntityId}`;
      }
      return getProjectDestination();

    case "PROJECT_LOG_EMAIL_FAILURES_DIGEST":
      // Task #1715 — daily digest summarises every failing schedule
      // across the org. Always deep-link to the org-wide failures
      // dashboard regardless of relatedEntityId/Type so admins land
      // exactly where the digest's row contents are mirrored.
      return "/admin/log-email-failures";

    case "GENERAL":
      if (relatedEntityType === "gantt_pdf_health") {
        return "/admin/gantt-pdf";
      }
      // Task #2010 — bell-row deep link for the job-metric alert
      // pages fired by `evaluateJobMetricAlerts`. The notifications
      // widget renders inline snooze buttons, but the global bell
      // dropdown needs a destination so a Super Admin can land on the
      // dashboard's active-alert banner with one click.
      if (relatedEntityType === "job_metric_alert") {
        return "/admin/job-metrics";
      }
      return null;
    default:
      return null;
  }
}
