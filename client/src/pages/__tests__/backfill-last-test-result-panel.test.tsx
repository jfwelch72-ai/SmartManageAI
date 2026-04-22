// @vitest-environment jsdom
/**
 * Task #1064 — covers the BackfillLastTestResultPanel inline health
 * indicator. The panel is what renders the persisted last-test-alert
 * outcome (Task #1045) on the settings card so admins coming back to
 * the page see whether their Slack / email destinations are healthy
 * without having to re-fire the test.
 *
 * The integration tests for the persistence + dismiss endpoints live in
 * `server/__tests__/crm-transcript-backfill-test-alert-persistence.test.ts`;
 * this file specifically pins the per-state UI rendering and the dismiss
 * button wiring so a regression in either is caught at the component
 * level.
 *
 * Coverage:
 *   - Healthy state — both channels configured + ok render the green
 *     "healthy" chips and no error lines.
 *   - Failed state — a configured-but-failing channel renders the
 *     destructive chip + the error message.
 *   - "No destinations" state — when neither channel was configured at
 *     test time, the panel renders the dedicated empty-state line and
 *     no per-channel chips.
 *   - Dismiss button invokes the onDismiss callback and disables itself
 *     while the dismiss mutation is pending.
 *
 * Uses bare DOM assertions (no `@testing-library/jest-dom`) to match the
 * existing component-test setup in this folder, which does not register
 * jest-dom matchers globally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BackfillLastTestResultPanel } from "../admin-transcript-backfill";

const TESTED_AT = "2026-04-22T15:30:00.000Z";

beforeEach(() => {
  cleanup();
});

describe("BackfillLastTestResultPanel — healthy state", () => {
  it("renders healthy chips for both configured channels and no error lines", () => {
    render(
      <BackfillLastTestResultPanel
        testedAt={TESTED_AT}
        onDismiss={vi.fn()}
        isDismissing={false}
        result={{
          slack: { configured: true, ok: true },
          email: {
            configured: true,
            ok: true,
            recipients: ["alerts@example.com"],
          },
          operatorDisplay: "Test Admin",
        }}
      />,
    );

    const slackChip = screen.getByTestId("chip-last-test-slack");
    const emailChip = screen.getByTestId("chip-last-test-email");
    expect(slackChip.textContent).toMatch(/Slack:\s*healthy/);
    expect(emailChip.textContent).toMatch(/Email:\s*healthy/);

    // No "no destinations" placeholder when at least one was configured.
    expect(screen.queryByTestId("text-last-test-no-destinations")).toBeNull();

    // No error rows on the happy path.
    expect(screen.queryByTestId("text-last-test-slack-error")).toBeNull();
    expect(screen.queryByTestId("text-last-test-email-error")).toBeNull();

    // Timestamp is surfaced so admins can correlate with logs.
    expect(screen.getByTestId("text-last-test-at")).toBeTruthy();
  });
});

describe("BackfillLastTestResultPanel — failed state", () => {
  it("renders a destructive chip + error line for a configured-but-failing channel", () => {
    render(
      <BackfillLastTestResultPanel
        testedAt={TESTED_AT}
        onDismiss={vi.fn()}
        isDismissing={false}
        result={{
          slack: {
            configured: true,
            ok: false,
            error: "Slack webhook returned 500: boom",
          },
          email: { configured: false, ok: false },
          operatorDisplay: "Test Admin",
        }}
      />,
    );

    const slackChip = screen.getByTestId("chip-last-test-slack");
    expect(slackChip.textContent).toMatch(/Slack:\s*failed/);

    const emailChip = screen.getByTestId("chip-last-test-email");
    expect(emailChip.textContent).toMatch(/Email:\s*not configured/);

    // The verbatim error string surfaces underneath the chips so the
    // admin can debug without checking server logs.
    const errLine = screen.getByTestId("text-last-test-slack-error");
    expect(errLine.textContent).toContain("Slack webhook returned 500: boom");

    // The not-configured email channel must NOT render an error row
    // (there is no error to show, and a stray row would be misleading).
    expect(screen.queryByTestId("text-last-test-email-error")).toBeNull();
  });
});

describe("BackfillLastTestResultPanel — no destinations state", () => {
  it("renders the dedicated empty-state line and no per-channel chips", () => {
    render(
      <BackfillLastTestResultPanel
        testedAt={TESTED_AT}
        onDismiss={vi.fn()}
        isDismissing={false}
        result={{
          slack: { configured: false, ok: false },
          email: { configured: false, ok: false },
          operatorDisplay: "Test Admin",
        }}
      />,
    );

    expect(screen.getByTestId("text-last-test-no-destinations")).toBeTruthy();

    // When no destinations were configured the chips are suppressed —
    // the panel collapses to just the timestamp + empty-state copy so
    // admins aren't shown a meaningless "not configured / not configured"
    // pair.
    expect(screen.queryByTestId("chip-last-test-slack")).toBeNull();
    expect(screen.queryByTestId("chip-last-test-email")).toBeNull();
  });
});

describe("BackfillLastTestResultPanel — dismiss button", () => {
  it("invokes onDismiss when clicked", async () => {
    const onDismiss = vi.fn();
    render(
      <BackfillLastTestResultPanel
        testedAt={TESTED_AT}
        onDismiss={onDismiss}
        isDismissing={false}
        result={{
          slack: { configured: true, ok: true },
          email: { configured: false, ok: false },
          operatorDisplay: "Test Admin",
        }}
      />,
    );

    await userEvent.click(screen.getByTestId("button-dismiss-last-test"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("disables the dismiss button while the dismiss mutation is pending", () => {
    const onDismiss = vi.fn();
    render(
      <BackfillLastTestResultPanel
        testedAt={TESTED_AT}
        onDismiss={onDismiss}
        isDismissing
        result={{
          slack: { configured: true, ok: true },
          email: { configured: false, ok: false },
          operatorDisplay: "Test Admin",
        }}
      />,
    );

    const button = screen.getByTestId(
      "button-dismiss-last-test",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
