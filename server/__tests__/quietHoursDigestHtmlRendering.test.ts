/**
 * Task #786 — Per-format structural snapshots of the quiet-hours digest
 * HTML body. Covers all three digest formats (summary, full, grouped)
 * and asserts that each one ships the dark-mode + mobile + a11y hooks
 * we rely on (the shared `<style>` block, prefers-color-scheme dark
 * overrides, max-width:600px mobile media query, role="article"
 * wrapper, aria-labelled `qh-card` lists, and a `qh-button` CTA).
 */
import { describe, it, expect } from "vitest";
import { buildDigestEmailBody } from "../utils/jobMetricAlerts";

const FORMATS = ["summary", "full", "grouped"] as const;

const windowStart = new Date("2026-04-21T02:00:00.000Z");
const windowEnd = new Date("2026-04-21T09:00:00.000Z");

const events = [
  {
    job: "ingest_worker",
    counter: "errors",
    kind: "spike" as const,
    triggeredAt: new Date("2026-04-21T02:15:00.000Z"),
    message: "errors spiked 12x baseline",
    emailed: false,
  },
  {
    job: "ingest_worker",
    counter: "queue_depth",
    kind: "stall" as const,
    triggeredAt: new Date("2026-04-21T03:42:00.000Z"),
    message: "queue_depth stalled below floor",
    emailed: false,
  },
  {
    job: "billing_runner",
    counter: null,
    kind: "spike" as const,
    triggeredAt: new Date("2026-04-21T04:05:00.000Z"),
    message: "latency spiked 7x baseline",
    emailed: false,
  },
];

describe("buildDigestEmailBody — dark-mode + mobile structural hooks", () => {
  for (const format of FORMATS) {
    describe(`format=${format}`, () => {
      const { html } = buildDigestEmailBody(events, windowStart, windowEnd, format);

      it("emits the shared <style> block with .qh-root", () => {
        expect(html).toMatch(/<style>[\s\S]*\.qh-root[\s\S]*<\/style>/);
      });

      it("includes a prefers-color-scheme: dark media query", () => {
        expect(html).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
      });

      it("includes Outlook dark-mode selectors", () => {
        expect(html).toContain("[data-ogsc]");
        expect(html).toContain("[data-ogsb]");
      });

      it("includes a max-width: 600px mobile breakpoint", () => {
        expect(html).toMatch(/@media\s+only\s+screen\s+and\s+\(max-width:\s*600px\)/);
      });

      it("wraps the body in a role=article container with aria hooks", () => {
        expect(html).toMatch(/role="article"/);
        expect(html).toMatch(/aria-roledescription="email"/);
        expect(html).toMatch(/aria-label="[^"]+"/);
      });

      it("renders at least one aria-labelled qh-card list", () => {
        expect(html).toMatch(/<ul[^>]*class="qh-card[^"]*"[^>]*role="list"[^>]*aria-label="[^"]+"/);
      });

      it("renders the dashboard CTA button with the qh-button class", () => {
        expect(html).toMatch(/class="qh-button"/);
        expect(html).toMatch(/href="[^"]*\/admin\/job-metrics"/);
      });

      it("hardens long ISO timestamps against horizontal overflow", () => {
        // Either via the .qh-code class or the inline word-break declaration.
        expect(html).toMatch(/word-break:\s*break-all/);
        expect(html).toMatch(/overflow-wrap:\s*anywhere/);
      });

      it("keeps a light-mode default background on the wrapper", () => {
        expect(html).toMatch(/background-color:#ffffff/);
      });

      it("keeps inline color fallbacks for clients that strip <style>", () => {
        // .qh-item nodes carry inline color so non-<style> clients still
        // render readable text.
        expect(html).toContain("color:#333333");
      });
    });
  }

  it("each format produces a structurally distinct body", () => {
    const summary = buildDigestEmailBody(events, windowStart, windowEnd, "summary").html;
    const full = buildDigestEmailBody(events, windowStart, windowEnd, "full").html;
    const grouped = buildDigestEmailBody(events, windowStart, windowEnd, "grouped").html;

    expect(summary).toContain("Quiet-hours digest (summary)");
    expect(full).toContain("Quiet-hours digest</h2>");
    expect(grouped).toContain("Quiet-hours digest (grouped by job)");

    // Grouped renders one heading per distinct job (here: 2).
    const headingCount = (grouped.match(/class="qh-heading"/g) ?? []).length;
    expect(headingCount).toBeGreaterThanOrEqual(2);
  });
});
