import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./override-style.css";
import "./uppy-core.css";
import "./uppy-dashboard.css";
// Side-effect import: installs the takeoff "image source is detached"
// dev-overlay suppressor at module-load time, before React mounts and
// before any takeoff component can trigger a Konva draw. Production
// builds get a no-op. See module header for the full rationale.
import "./lib/takeoff/suppressDetachedBitmapOverlay";

// Fix for double-encoded URLs (e.g., /login%3Fredirect=%2Fdashboard)
// This happens when opening the app in a new tab with encoded query params
const currentPath = window.location.pathname;
if (currentPath.includes('%3F') || currentPath.includes('%2F')) {
  const decodedPath = decodeURIComponent(currentPath);
  // If the decoded path contains a query string that should be in search params
  const queryIndex = decodedPath.indexOf('?');
  if (queryIndex !== -1) {
    const newPath = decodedPath.substring(0, queryIndex);
    const newSearch = decodedPath.substring(queryIndex);
    window.history.replaceState(null, '', newPath + newSearch + window.location.hash);
  }
}

createRoot(document.getElementById("root")!).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[PWA] Service worker registered, scope:', registration.scope);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                console.log('[PWA] New service worker activated');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.error('[PWA] Service worker registration failed:', error);
      });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] New service worker controlling the page');
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'GET_CSRF_TOKEN' && event.ports?.[0]) {
        const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
        const csrfToken = match ? decodeURIComponent(match[1]) : null;
        event.ports[0].postMessage({ csrfToken });
      }
    });
  });
}
