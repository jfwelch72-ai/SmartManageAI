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
    case "CHANGE_ORDER_APPROVED":
    case "SOV_ITEM_COMPLETED":
      return getProjectDestination();

    case "PORTAL_CHAT_MESSAGE":
      return "/portal-chat";

    case "BID_AWARDED":
      if (relatedEntityType === "bid_request" && relatedEntityId) {
        return `/bid-inbox/${relatedEntityId}`;
      }
      return "/bid-inbox";

    case "GENERAL":
    default:
      return null;
  }
}
