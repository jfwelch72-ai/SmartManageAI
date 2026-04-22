/**
 * Task #1008 — covers the pure formatter that builds the Slack/email
 * payloads for the transcript-backfill run-completed alerts. The dispatcher
 * itself is a thin wrapper around the existing slack/email transports and
 * is exercised through the worker's finally block, so the unit tests focus
 * on the wording (operator name + email surfacing, deleted-user fallback,
 * retry detection, status verb).
 */
import { describe, it, expect } from "vitest";
import {
  formatBackfillCompletionNotification,
  describeBackfillOperator,
  type BackfillNotificationJob,
} from "../services/transcriptBackfillNotifications";

const baseJob: BackfillNotificationJob = {
  id: "backfill-123-abc",
  orgId: "org-1",
  status: "COMPLETED",
  total: 10,
  processed: 10,
  succeeded: 8,
  failed: 2,
  startedAt: "2026-04-22T12:00:00.000Z",
  completedAt: "2026-04-22T12:05:00.000Z",
  parentJobId: null,
};

describe("describeBackfillOperator", () => {
  it("uses first + last name when available", () => {
    expect(
      describeBackfillOperator({
        id: "u1",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
      }),
    ).toEqual({ display: "Jane Doe", email: "jane@example.com" });
  });

  it("falls back to single name, then email, then deleted label", () => {
    expect(
      describeBackfillOperator({ id: "u1", firstName: "Jane", lastName: null, email: null }),
    ).toEqual({ display: "Jane", email: "(no email on file)" });
    expect(
      describeBackfillOperator({ id: "u1", firstName: null, lastName: null, email: "x@y.co" }),
    ).toEqual({ display: "x@y.co", email: "x@y.co" });
    expect(
      describeBackfillOperator({ id: "u1", firstName: null, lastName: null, email: null }),
    ).toEqual({ display: "Unknown operator (deleted user)", email: "(no email on file)" });
  });

  it("renders the deleted-user fallback when the operator record is missing", () => {
    expect(describeBackfillOperator(null)).toEqual({
      display: "Unknown operator (deleted user)",
      email: "(no email on file)",
    });
  });
});

describe("formatBackfillCompletionNotification", () => {
  it("includes the operator display name and email in every channel", () => {
    const out = formatBackfillCompletionNotification(baseJob, {
      id: "u1",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
    });
    expect(out.title).toBe("Transcript backfill completed");
    expect(out.emailSubject).toBe(
      "[CRM] Transcript backfill completed — started by Jane Doe",
    );
    expect(out.slackBody).toContain("Jane Doe");
    expect(out.slackBody).toContain("jane@example.com");
    expect(out.emailText).toContain("Jane Doe");
    expect(out.emailText).toContain("jane@example.com");
    expect(out.emailHtml).toContain("Jane Doe");
    expect(out.emailHtml).toContain("jane@example.com");
  });

  it("falls back gracefully when the operator was deleted", () => {
    const out = formatBackfillCompletionNotification(baseJob, null);
    expect(out.operatorDisplay).toBe("Unknown operator (deleted user)");
    expect(out.operatorEmail).toBe("(no email on file)");
    expect(out.emailSubject).toContain("Unknown operator (deleted user)");
    expect(out.slackBody).toContain("Unknown operator (deleted user)");
    expect(out.slackBody).toContain("(no email on file)");
  });

  it("flips the verb to 'failed' when the job failed", () => {
    const out = formatBackfillCompletionNotification(
      { ...baseJob, status: "FAILED" },
      { id: "u1", firstName: "Sam", lastName: null, email: "sam@x.co" },
    );
    expect(out.title).toBe("Transcript backfill failed");
    expect(out.emailSubject).toContain("failed");
    expect(out.slackBody).toContain("FAILED");
  });

  it("labels retries distinctly and references the parent job id", () => {
    const out = formatBackfillCompletionNotification(
      { ...baseJob, parentJobId: "backfill-original-xyz" },
      { id: "u1", firstName: "Jane", lastName: "Doe", email: "jane@example.com" },
    );
    expect(out.title).toBe("Transcript backfill retry completed");
    expect(out.slackBody).toContain("backfill-original-xyz");
    expect(out.emailText).toContain("retry of backfill-original-xyz");
    expect(out.emailHtml).toContain("backfill-original-xyz");
  });

  it("escapes HTML special characters in the email body", () => {
    const out = formatBackfillCompletionNotification(baseJob, {
      id: "u1",
      firstName: "Ann <script>",
      lastName: "O'Toole & Co",
      email: "a&b@x.co",
    });
    expect(out.emailHtml).not.toContain("<script>");
    expect(out.emailHtml).toContain("Ann &lt;script&gt;");
    expect(out.emailHtml).toContain("a&amp;b@x.co");
  });
});
