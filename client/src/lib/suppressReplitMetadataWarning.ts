/**
 * Dev-only suppressor for the React prop-types warning:
 *   "Warning: Invalid prop 'data-replit-metadata' supplied to
 *    'React.Fragment'. React.Fragment can only have 'key' and
 *    'children' props."
 *
 * Why this exists:
 *   The Replit IDE's JSX source-mapping plugin transforms every JSX
 *   opening element — including <> / <Fragment> / <Fragment key="..."> —
 *   to include a `data-replit-metadata` attribute for click-to-source
 *   navigation. React.Fragment only accepts `key` and `children`, so
 *   React's prop-type checker fires a console.error for every Fragment
 *   in the render tree.
 *
 *   In a file like CanvasStage.tsx (3 000+ lines, 30+ Fragments) a
 *   single render pass floods the console with dozens of identical
 *   warnings, drowning out real errors. Replacing every Fragment with
 *   a real DOM element would be a sweeping layout-risk refactor — and
 *   would need to be repeated for every future Fragment added by any
 *   developer. The warning is exclusively about the IDE's own injection,
 *   not about application logic.
 *
 * What this does:
 *   - Only active in development (`import.meta.env.DEV`).
 *   - Wraps `console.error` once (idempotent — safe if imported
 *     multiple times due to HMR).
 *   - Suppresses only calls whose first argument contains the exact
 *     string `data-replit-metadata`. Every other console.error passes
 *     through unchanged.
 *   - Logs a one-time `console.debug` so the suppressor is visible
 *     in Verbose mode for support sessions.
 *   - The wrapper is installed before React mounts (imported from
 *     main.tsx) so no warning can slip through before the guard.
 *
 * In production the function is a strict no-op — production builds
 * don't carry the Replit IDE transform.
 */

const REPLIT_META_RE = /data-replit-metadata/;
const INSTALL_KEY = "__suppress_replit_metadata_warning_installed_v2__";

export function installReplitMetadataWarningSuppressor(): void {
  if (typeof window === "undefined") return;
  if (!import.meta.env.DEV) return;
  if ((window as unknown as Record<string, unknown>)[INSTALL_KEY]) return;
  (window as unknown as Record<string, unknown>)[INSTALL_KEY] = true;

  const original = console.error.bind(console);

  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    // React logs prop-type warnings with printf-style substitution:
    //   console.error('Warning: Invalid prop %s supplied to %s...', 'data-replit-metadata', 'React.Fragment')
    // The prop name is in args[1], not args[0].  Check ALL string args.
    const isReplitMeta = args.some(
      (a) => typeof a === "string" && REPLIT_META_RE.test(a),
    );
    if (isReplitMeta) return;
    original(...args);
  };

  // eslint-disable-next-line no-console
  console.debug(
    "[Dev] Replit data-replit-metadata prop warning suppressed " +
      "(Replit IDE injects this onto every JSX element including " +
      "React.Fragment — not an application bug).",
  );
}

installReplitMetadataWarningSuppressor();
