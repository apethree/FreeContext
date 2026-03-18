import { createWebAppShell } from "@/web/createWebAppShell";

/**
 * Browser app-shell adapter for `npm run dev:web` and static web builds.
 * In Electron, preload provides `window.appShell` and this file is a no-op.
 */
if (typeof window !== "undefined" && !window.appShell) {
  (window as Window & { appShell: Window["appShell"] }).appShell = createWebAppShell();
}
