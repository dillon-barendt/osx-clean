/** The existing HTTP API is the renderer's only bridge to filesystem operations. */
export const desktopWebPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webviewTag: false,
  webSecurity: true,
} as const;

export function isLocalURL(raw: string, origin: string): boolean {
  try {
    return new URL(raw).origin === origin;
  } catch {
    return false;
  }
}
