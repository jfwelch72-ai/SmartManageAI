// @vitest-environment jsdom
/**
 * Task #2016 — UI contract tests for the synthetic `pool_health` job-card
 * surfaced on the Job Metrics dashboard (Task #2009).
 *
 * The dashboard is the first place Super Admins look during a
 * pool-starvation incident, so the per-counter tooltips, the header
 * badges that signal exhausted/saturated episodes, the gauge rendering
 * that hides meaningless rolled-up totals, and the description that
 * names the configured saturation-samples threshold all need a
 * regression net.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { JobCard } from "../JobMetricsDashboard";

afterEach(() => {
  cleanup();
});

interface PoolHealthFixtureOverrides {
  totals?: Record<string, number>;
  latest?: { timestamp: number; counters: Record<string, number> } | null;
  samples?: Array<{ timestamp: number; counters: Record<string, number> }>;
}

function poolHealthFixture(overrides: PoolHealthFixtureOverrides = {}) {
  const baseLatest = {
    timestamp: Date.now() - 60_000,
    counters: { sampled: 1, waiting: 2, active: 5, exhausted: 0, waitingSaturated: 0 },
  };
  return {
    job: "pool_health",
    windowMs: 24 * 60 * 60 * 1000,
    samples: overrides.samples ?? [],
    totals:
      overrides.totals ?? {
        exhausted: 4,
        waitingSaturated: 2,
        sampled: 12,
        waiting: 24,
        active: 60,
      },
    latest: overrides.latest === undefined ? baseLatest : overrides.latest,
  };
}

const SATURATION_SAMPLES_SENTINEL = Symbol("undefined");

interface RenderOpts {
  fixture?: PoolHealthFixtureOverrides;
  waitingSaturationSamples?: number | typeof SATURATION_SAMPLES_SENTINEL;
  activeAlerts?: number;
}

function renderCard(opts: RenderOpts = {}) {
  const samples =
    opts.waitingSaturationSamples === SATURATION_SAMPLES_SENTINEL
      ? undefined
      : opts.waitingSaturationSamples ?? 5;
  return render(
    <TooltipProvider>
      <JobCard
        job={poolHealthFixture(opts.fixture)}
        range="24h"
        activeAlerts={opts.activeAlerts ?? 0}
        waitingSaturationSamples={samples}
      />
    </TooltipProvider>,
  );
}

describe("JobCard — pool_health (Task #2016)", () => {
  it("renders an Info tooltip trigger for every pool_health counter", () => {
    renderCard();
    for (const counter of [
      "exhausted",
      "waitingSaturated",
      "sampled",
      "waiting",
      "active",
    ]) {
      expect(
        screen.getByTestId(`tooltip-trigger-counter-pool_health-${counter}`),
      ).toBeTruthy();
    }
  });

  it("shows the exhausted/saturated header badges when totals are non-zero", () => {
    renderCard();
    expect(
      screen.getByTestId("badge-pool-health-exhausted-pool_health").textContent,
    ).toContain("4 exhausted");
    expect(
      screen.getByTestId("badge-pool-health-saturated-pool_health").textContent,
    ).toContain("2 saturated");
  });

  it("hides both pool-health header badges when their totals are zero", () => {
    renderCard({
      fixture: {
        totals: {
          exhausted: 0,
          waitingSaturated: 0,
          sampled: 12,
          waiting: 0,
          active: 0,
        },
      },
    });
    expect(
      screen.queryByTestId("badge-pool-health-exhausted-pool_health"),
    ).toBeNull();
    expect(
      screen.queryByTestId("badge-pool-health-saturated-pool_health"),
    ).toBeNull();
  });

  it("only shows the exhausted badge when waitingSaturated is zero", () => {
    renderCard({
      fixture: {
        totals: {
          exhausted: 1,
          waitingSaturated: 0,
          sampled: 12,
          waiting: 0,
          active: 0,
        },
      },
    });
    expect(
      screen.getByTestId("badge-pool-health-exhausted-pool_health"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("badge-pool-health-saturated-pool_health"),
    ).toBeNull();
  });

  it("renders gauge totals as '—' and labels per-tick values as 'Last sample'", () => {
    renderCard();

    expect(screen.getByTestId("text-total-pool_health-waiting").textContent).toBe(
      "—",
    );
    expect(screen.getByTestId("text-total-pool_health-active").textContent).toBe(
      "—",
    );
    expect(
      screen.getByTestId("text-latest-pool_health-waiting").textContent,
    ).toContain("Last sample:");
    expect(
      screen.getByTestId("text-latest-pool_health-active").textContent,
    ).toContain("Last sample:");
    // Counter (non-gauge) values continue to show the rolled-up total
    // and the "Last tick:" prefix.
    expect(
      screen.getByTestId("text-total-pool_health-exhausted").textContent,
    ).toBe("4");
    expect(
      screen.getByTestId("text-latest-pool_health-exhausted").textContent,
    ).toContain("Last tick:");
  });

  it("tags gauge counters with a 'gauge' kind label", () => {
    renderCard();
    expect(
      screen.getByTestId("text-counter-kind-pool_health-waiting").textContent,
    ).toMatch(/gauge/i);
    expect(
      screen.getByTestId("text-counter-kind-pool_health-active").textContent,
    ).toMatch(/gauge/i);
    expect(
      screen.queryByTestId("text-counter-kind-pool_health-exhausted"),
    ).toBeNull();
  });

  it("names the configured saturation-samples threshold from /api/admin/metrics/pool", () => {
    renderCard({ waitingSaturationSamples: 7 });
    const desc = screen.getByTestId(
      "text-pool-health-saturation-config-pool_health",
    ).textContent ?? "";
    expect(desc).toContain("Saturated after 7");
    expect(desc).toContain("POOL_HEALTH_WAITING_SATURATION_SAMPLES");
  });

  it("falls back to the literal 'N' when waitingSaturationSamples is undefined", () => {
    renderCard({ waitingSaturationSamples: SATURATION_SAMPLES_SENTINEL });
    const desc = screen.getByTestId(
      "text-pool-health-saturation-config-pool_health",
    ).textContent ?? "";
    expect(desc).toContain("Saturated after N");
  });

  it("describes the latest sample as 'Last sampler heartbeat' rather than 'Last tick'", () => {
    renderCard();
    // The CardDescription contains both the heartbeat label and the
    // last-tick relative timestamp testid; the heartbeat wording is
    // the discriminator that distinguishes pool_health from regular
    // job-cards.
    expect(
      screen.getByTestId("text-last-tick-pool_health"),
    ).toBeTruthy();
    expect(document.body.textContent ?? "").toContain(
      "Last sampler heartbeat",
    );
  });
});
