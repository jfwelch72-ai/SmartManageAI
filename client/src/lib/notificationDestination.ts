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
      return "/time-clock-manager";

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
      return "/delay-claims";

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
      return "/submittals";

    case "TM_TICKET_SUBMITTED":
    case "TM_TICKET_APPROVED":
    case "TM_TICKET_REJECTED":
      return getProjectDestination();

    case "OVERTIME_REQUESTED":
    case "OVERTIME_APPROVED":
    case "OVERTIME_REJECTED":
      return "/time-clock-manager";

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

    case "GENERAL":
    default:
      return null;
  }
}
