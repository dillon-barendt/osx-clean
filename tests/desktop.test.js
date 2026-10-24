import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { once } from "node:events";
import { isLocalURL, desktopWebPreferences } from "../dist/desktop/policy.js";
import { startDesktopService } from "../dist/desktop/service.js";

test("desktop renderer stays sandboxed with no Node or webview integration", () => {
  assert.equal(desktopWebPreferences.nodeIntegration, false);
  assert.equal(desktopWebPreferences.contextIsolation, true);
  assert.equal(desktopWebPreferences.sandbox, true);
  assert.equal(desktopWebPreferences.webviewTag, false);
  assert.equal(desktopWebPreferences.webSecurity, true);
});

test("desktop navigation permits only the actual local service origin", () => {
  const origin = "http://127.0.0.1:49152";
  assert.equal(isLocalURL(`${origin}/?token=example`, origin), true);
  assert.equal(isLocalURL(`${origin}/app.css`, origin), true);
  for (const url of [
    "https://example.com", "file:///etc/passwd", "javascript:alert(1)",
    "http://127.0.0.1:4280/", "http://localhost:49152/",
    "http://127.0.0.1:49152.example.com/", "invalid URL",
  ]) assert.equal(isLocalURL(url, origin), false, url);
});

test("desktop service reuses the authenticated API on an ephemeral loopback port", async () => {
  const service = await startDesktopService();
  const { server, url } = service;
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  assert.ok(address.port > 0);
  try {
    assert.equal((await fetch(`${url.origin}/api/categories`)).status, 401);
    const response = await fetch(`${url.origin}/api/categories${url.search}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).categories.length, 17);
    const html = await (await fetch(url)).text();
    assert.match(html, /<title>osx-clean<\/title>/);
    assert.ok(html.includes(url.searchParams.get("token")));
    // An unfinished HTTP request must not hold the local service open on Quit.
    const socket = connect(address.port, "127.0.0.1");
    await once(socket, "connect");
    // Closing an unfinished HTTP request can reset the TCP connection on macOS.
    socket.on("error", (error) => assert.equal(error.code, "ECONNRESET"));
    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    await service.close();
    await closed;
    assert.equal(server.listening, false);
    await assert.rejects(fetch(`${url.origin}/api/categories`));
  } finally {
    if (server.listening) await service.close();
  }
});

test("desktop packaging includes the real macOS Trash helper and both download formats", async () => {
  const config = JSON.parse(await readFile(new URL("../electron-builder.json", import.meta.url), "utf8"));
  // osascript needs an ordinary on-disk path; it cannot read an ASAR virtual path.
  assert.equal(config.asar, false);
  assert.ok(config.files.includes("scripts/trash-items.js"));
  assert.ok(config.files.includes("public/**/*"));
  assert.ok(config.files.includes("dist/**/*"));
  assert.deepEqual(config.mac.target, ["dmg", "zip"]);
});
