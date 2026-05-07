import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Filter out the transient "image source is detached" error that
// Konva can throw between an `ImageBitmap` cache eviction and the
// next batchDraw RAF in the takeoff workspace. The cache already
// defers every `bitmap.close()` past Konva's draw cycle (1.5s
// wall-clock, see `client/src/lib/takeoff/tileCache.ts`) and
// `<TileLayer>` skips bitmaps that report `width === 0` — but rare
// browser/HMR/timing races can still leak a single transient throw
// into the dev runtime overlay, blocking the entire workspace until
// the user dismisses the popup. Konva redraws cleanly on the next
// frame, so the visual outcome is fine; we only need to silence the
// disruptive overlay. This server-side filter runs after the error
// arrives via WebSocket but before the overlay HMR message is
// dispatched, so it cannot lose any client-side listener race.
const DETACHED_BITMAP_RE = /image source is detached/i;
const isTransientDetachedBitmap = (err: { message?: string }) =>
  typeof err?.message === "string" && DETACHED_BITMAP_RE.test(err.message);

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay({
      filter: (err) => !isTransientDetachedBitmap(err),
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Emit hidden source maps so Sentry can symbolicate frontend
    // stack traces without exposing the unminified source to end users
    // via the browser devtools "Sources" panel. See
    // docs/ops/runbook.md and docs/runbooks/observability.md.
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes("commonjsHelpers") ||
            id.includes("commonjs-dynamic-modules")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules")) {
            if (
              id.match(/[\\/]node_modules[\\/](react|react-dom|scheduler|react-reconciler|react-is|use-sync-external-store)[\\/]/)
            ) return "vendor-react";
            if (id.includes("@tanstack")) return "vendor-tanstack";
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
            if (id.includes("konva") || id.includes("react-konva")) return "vendor-canvas";
            if (id.includes("pdfjs-dist")) return "vendor-pdf";
            if (id.includes("xlsx")) return "vendor-xlsx";
            if (id.includes("lucide-react")) return "vendor-icons";
          }
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
