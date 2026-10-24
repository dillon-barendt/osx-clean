import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import { fileURLToPath } from "node:url";
import { desktopWebPreferences, isLocalURL } from "./policy.js";
import { startDesktopService, type DesktopService } from "./service.js";

const smokeTest = process.argv.includes("--smoke-test");
let service: DesktopService | undefined;
let window: BrowserWindow | undefined;

function showWindow(): void {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
}

async function openWindow(): Promise<void> {
  if (!service) return;
  if (window && !window.isDestroyed()) {
    showWindow();
    return;
  }
  const { url } = service;
  // In-memory session: no authentication token or scan state persists to disk.
  const localSession = session.fromPartition("osx-clean-desktop");
  localSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === "clipboard-sanitized-write" && isLocalURL(contents.getURL(), url.origin));
  });
  localSession.setPermissionCheckHandler((_contents, permission, origin) => {
    return permission === "clipboard-sanitized-write" && isLocalURL(origin, url.origin);
  });
  localSession.webRequest.onBeforeRequest((details, callback) => {
    // Smoke tests load the real UI but avoid automatically scanning the user's Mac.
    const skipScan = smokeTest && /^\/api\/(overview|scan)$/.test(new URL(details.url).pathname);
    callback({ cancel: skipScan || !isLocalURL(details.url, url.origin) });
  });

  window = new BrowserWindow({
    title: "osx-clean",
    width: 1240,
    height: 860,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: "#171816",
    show: false,
    webPreferences: { ...desktopWebPreferences, session: localSession },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!isLocalURL(target, url.origin)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, target) => {
    if (!isLocalURL(target, url.origin)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.on("closed", () => { window = undefined; });
  window.once("ready-to-show", () => { if (!smokeTest) showWindow(); });
  await window.loadURL(url.href);

  if (smokeTest) {
    const { runDesktopSmoke } = await import("./smoke.js");
    await runDesktopSmoke(window, service);
    // Return from the async startup path before entering macOS window teardown.
    setTimeout(() => window?.close(), 0);
  }
}

function installMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "osx-clean", submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Full Disk Access…", click: () => {
        void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
      } },
      { type: "separator" },
      { role: "services" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { role: "quit" },
    ] },
    { role: "editMenu" },
    { label: "View", submenu: [
      { role: "reload" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      { type: "separator" }, { role: "togglefullscreen" },
    ] },
    { role: "windowMenu" },
    { label: "Help", submenu: [
      { label: "Desktop Guide", click: () => {
        void shell.openPath(fileURLToPath(new URL("../../docs/DESKTOP.md", import.meta.url)));
      } },
    ] },
  ]));
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (smokeTest) console.error(message);
  else dialog.showErrorBox("osx-clean could not start", message);
  service?.server.closeAllConnections();
  service?.server.close();
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { void openWindow().catch(fail); });
  app.on("activate", () => { void openWindow().catch(fail); });
  // Closing the window ends the session; no invisible scanner stays running.
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    // The server lives in this process. Close sockets without intercepting
    // Electron's quit sequence (a second asynchronous quit can stall on macOS).
    service?.server.closeAllConnections();
    service?.server.close();
  });
  void app.whenReady().then(async () => {
    app.setName("osx-clean");
    service = await startDesktopService();
    installMenu();
    await openWindow();
  }).catch(fail);
}
