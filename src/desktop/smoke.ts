import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import type { BrowserWindow } from "electron";
import type { DesktopService } from "./service.js";

/** Explicit opt-in check for both development and the actual packaged app. */
export async function runDesktopSmoke(window: BrowserWindow, service: DesktopService): Promise<void> {
  await access(new URL("../../scripts/trash-items.js", import.meta.url));
  const result = await window.webContents.executeJavaScript(`(async () => {
    const unauthenticated = await fetch('/api/categories');
    const authenticated = await fetch('/api/categories', {
      headers: { 'x-osx-clean-token': window.OSX_CLEAN_TOKEN }
    });
    const categories = await authenticated.json();
    const unauthorizedDelete = await fetch('/api/delete', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['/'], mode: 'delete' })
    });
    const rejectedDelete = await fetch('/api/delete', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-osx-clean-token': window.OSX_CLEAN_TOKEN },
      body: JSON.stringify({ paths: ['/'], mode: 'delete' })
    });
    return {
      title: document.title,
      ready: document.documentElement.dataset.ready,
      hasOptions: Boolean(document.querySelector('#options-btn')),
      node: typeof process,
      require: typeof require,
      unauthenticated: unauthenticated.status,
      unauthorizedDelete: unauthorizedDelete.status,
      authenticated: authenticated.status,
      categoryCount: categories.categories.length,
      rootRejected: (await rejectedDelete.json()).results[0].ok === false
    };
  })()`);
  assert.deepEqual(result, {
    title: "osx-clean", ready: "true", hasOptions: true,
    node: "undefined", require: "undefined", unauthenticated: 401,
    unauthorizedDelete: 401, authenticated: 200, categoryCount: 17, rootRejected: true,
  });
  assert.equal(window.webContents.getURL(), service.url.href);
  console.log("DESKTOP_SMOKE_OK: packaged UI, assets, authenticated API, protected roots, and sandbox verified.");
}
