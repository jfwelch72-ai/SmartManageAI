/**
 * Task #2289 — Single source of truth for dev-only component
 * preview/harness routes. The dev preview index page (`/preview`)
 * reads from this registry so designers and QA can browse every
 * storybook-style surface without grepping `App.tsx`.
 *
 * To add a new preview, register the route here AND add the matching
 * `<Route>` in `App.tsx` (gated behind `import.meta.env.DEV`).
 */
export interface PreviewEntry {
  /** Route path the preview is mounted at. */
  path: string;
  /** Human-readable title shown on the index page. */
  title: string;
  /** One-line description of what the preview demonstrates. */
  description: string;
  /** Optional related task number for context (e.g. "#2270"). */
  task?: string;
}

export const PREVIEW_ROUTES: PreviewEntry[] = [
  {
    path: "/test/plan-pins-harness",
    title: "Plan Pins Harness",
    description:
      "Test surface for PlanPinLayer clustering, density chips, and zoom-to-cluster behavior on a synthetic plan page.",
    task: "#1670",
  },
  {
    path: "/preview/dim-input-badge",
    title: "Dim Input Cursor Badge",
    description:
      "Storybook-style preview for the locked-length cursor badge that floats below the takeoff cursor (Lock vs Chain variants).",
    task: "#2270",
  },
];
