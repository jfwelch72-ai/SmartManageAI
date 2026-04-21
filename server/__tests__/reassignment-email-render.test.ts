/**
 * Task #733: snapshot the rendered email subject + body and the deep-link
 * URL for the new owner-reassignment notification types added in Task #723
 * (`CRM_OPPORTUNITY_REASSIGNED` and `PROJECT_REASSIGNED`).
 *
 * `server/__tests__/contact-reassignment-coalesce.test.ts` covers the
 * coalescing logic, but nothing exercises the email render path end-to-end,
 * so a regression in tone, links, or required fields would only surface
 * when a real user got the email. These tests pin the user-visible copy
 * for both the immediate (first-in-window) and summary (coalesced) variants
 * and assert that the email "View" button URL matches the deep link the
 * in-app notification list uses (`client/src/lib/notificationDestination.ts`).
 *
 * The DB is not touched: `composeEmailContent` is a pure function over a
 * `NotificationRecord`, so we feed it records shaped exactly like the ones
 * the queue helper inserts and check the rendered output.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { composeEmailContent, type NotificationRecord } from "../services/notificationDelivery";
import { getNotificationDestination } from "../../client/src/lib/notificationDestination";

const BASE_URL = "https://app.example.test";

let originalBaseUrl: string | undefined;

beforeAll(() => {
  originalBaseUrl = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = BASE_URL;
});

afterAll(() => {
  if (originalBaseUrl === undefined) {
    delete process.env.APP_BASE_URL;
  } else {
    process.env.APP_BASE_URL = originalBaseUrl;
  }
});

function makeRecord(partial: Partial<NotificationRecord> & Pick<NotificationRecord, "type" | "title" | "message">): NotificationRecord {
  return {
    id: "notif-1",
    userId: "user-1",
    relatedEntityId: null,
    relatedEntityType: null,
    ...partial,
  };
}

describe("reassignment email rendering (Task #733)", () => {
  describe("CRM_OPPORTUNITY_REASSIGNED", () => {
    it("renders the immediate email with a deep link to the specific opportunity", () => {
      const notif = makeRecord({
        type: "CRM_OPPORTUNITY_REASSIGNED",
        title: "A CRM opportunity was assigned to you",
        message: "Alice assigned Acme HQ Renovation to you.",
        relatedEntityId: "opp-123",
        relatedEntityType: "CRM_OPPORTUNITY",
      });

      const rendered = composeEmailContent(notif);

      expect(rendered.subject).toBe("A CRM opportunity was assigned to you — SmartManageAI");
      expect(rendered.body).toBe("Alice assigned Acme HQ Renovation to you.");
      expect(rendered.actionText).toBe("View Opportunity");
      expect(rendered.actionUrl).toBe(`${BASE_URL}/crm?tab=opportunities&opportunityId=opp-123`);

      // Email deep link must match the in-app notification destination.
      const inAppPath = getNotificationDestination(notif as { type: string; relatedEntityId?: string | null });
      expect(rendered.actionUrl).toBe(`${BASE_URL}${inAppPath}`);
    });

    it("renders the coalesced summary email with a deep link to the first opportunity", () => {
      // After the 5-minute window flushes, the summary notification is
      // inserted with relatedEntityId = first additional opportunity id.
      const notif = makeRecord({
        type: "CRM_OPPORTUNITY_REASSIGNED",
        title: "9 more CRM opportunities assigned to you",
        message: "Alice assigned 9 more CRM opportunities to you.",
        relatedEntityId: "opp-456",
        relatedEntityType: "CRM_OPPORTUNITY",
      });

      const rendered = composeEmailContent(notif);

      expect(rendered.subject).toBe("9 more CRM opportunities assigned to you — SmartManageAI");
      expect(rendered.body).toBe("Alice assigned 9 more CRM opportunities to you.");
      expect(rendered.actionText).toBe("View Opportunity");
      expect(rendered.actionUrl).toBe(`${BASE_URL}/crm?tab=opportunities&opportunityId=opp-456`);

      const inAppPath = getNotificationDestination(notif as { type: string; relatedEntityId?: string | null });
      expect(rendered.actionUrl).toBe(`${BASE_URL}${inAppPath}`);
    });

    it("falls back to the filtered opportunity list when no related entity id is present", () => {
      const notif = makeRecord({
        type: "CRM_OPPORTUNITY_REASSIGNED",
        title: "A CRM opportunity was assigned to you",
        message: "Alice assigned an opportunity to you.",
      });

      const rendered = composeEmailContent(notif);

      expect(rendered.actionUrl).toBe(`${BASE_URL}/crm?tab=opportunities&assignedFilter=me`);

      const inAppPath = getNotificationDestination(notif as { type: string; relatedEntityId?: string | null });
      expect(rendered.actionUrl).toBe(`${BASE_URL}${inAppPath}`);
    });
  });

  describe("PROJECT_REASSIGNED", () => {
    it("renders the immediate email with a deep link to the specific project", () => {
      const notif = makeRecord({
        type: "PROJECT_REASSIGNED",
        title: "A project was assigned to you",
        message: "Alice assigned Downtown Library Build to you.",
        relatedEntityId: "proj-789",
        relatedEntityType: "PROJECT",
      });

      const rendered = composeEmailContent(notif);

      expect(rendered.subject).toBe("A project was assigned to you — SmartManageAI");
      expect(rendered.body).toBe("Alice assigned Downtown Library Build to you.");
      expect(rendered.actionText).toBe("View Project");
      expect(rendered.actionUrl).toBe(`${BASE_URL}/projects/proj-789`);

      const inAppPath = getNotificationDestination(notif as { type: string; relatedEntityId?: string | null; relatedEntityType?: string | null });
      expect(rendered.actionUrl).toBe(`${BASE_URL}${inAppPath}`);
    });

    it("renders the coalesced summary email with a deep link to the first project", () => {
      const notif = makeRecord({
        type: "PROJECT_REASSIGNED",
        title: "4 more projects assigned to you",
        message: "Alice assigned 4 more projects to you.",
        relatedEntityId: "proj-001",
        relatedEntityType: "PROJECT",
      });

      const rendered = composeEmailContent(notif);

      expect(rendered.subject).toBe("4 more projects assigned to you — SmartManageAI");
      expect(rendered.body).toBe("Alice assigned 4 more projects to you.");
      expect(rendered.actionText).toBe("View Project");
      expect(rendered.actionUrl).toBe(`${BASE_URL}/projects/proj-001`);

      const inAppPath = getNotificationDestination(notif as { type: string; relatedEntityId?: string | null; relatedEntityType?: string | null });
      expect(rendered.actionUrl).toBe(`${BASE_URL}${inAppPath}`);
    });

    it("falls back to the projects list when no related entity id is present", () => {
      const notif = makeRecord({
        type: "PROJECT_REASSIGNED",
        title: "A project was assigned to you",
        message: "Alice assigned a project to you.",
      });

      const rendered = composeEmailContent(notif);

      expect(rendered.actionUrl).toBe(`${BASE_URL}/projects`);

      const inAppPath = getNotificationDestination(notif as { type: string; relatedEntityId?: string | null; relatedEntityType?: string | null });
      expect(rendered.actionUrl).toBe(`${BASE_URL}${inAppPath}`);
    });
  });
});
