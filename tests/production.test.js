import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createServer, TOKEN } from "../dist/server.js";

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      })
      .on("error", reject);
  });
}

function fetchJson(url, headers = {}) {
  return fetchText(url, headers).then(({ status, body }) => ({
    status,
    json: JSON.parse(body),
  }));
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            json: JSON.parse(data || "{}"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function readSSEUntil(url, predicate, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers["content-type"] ?? "", /text\/event-stream/);
      const events = [];
      let buffer = "";

      const timeout = setTimeout(() => {
        req.destroy();
        resolve(events);
      }, timeoutMs);

      res.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          let event = "message";
          let data = "";
          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) data = line.slice(6).trim();
          }
          const item = { event, data: data ? JSON.parse(data) : null };
          events.push(item);
          if (predicate(item, events)) {
            clearTimeout(timeout);
            req.destroy();
            resolve(events);
            return;
          }
        }
      });

      res.on("end", () => {
        clearTimeout(timeout);
        resolve(events);
      });
    });

    req.on("error", (err) => {
      if (req.destroyed) return;
      reject(err);
    });
  });
}

test("production server: serves static frontend assets with injected token", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Root HTML
    const htmlRes = await fetchText(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers["content-type"] ?? "", /text\/html/);
    assert.match(htmlRes.body, /<title>osx-clean<\/title>/);
    assert.match(htmlRes.body, new RegExp(TOKEN));

    // 2. CSS
    const cssRes = await fetchText(`${baseUrl}/app.css`);
    assert.equal(cssRes.status, 200);
    assert.match(cssRes.headers["content-type"] ?? "", /text\/css/);

    // 3. JS
    const jsRes = await fetchText(`${baseUrl}/app.js`);
    assert.equal(jsRes.status, 200);
    assert.match(jsRes.headers["content-type"] ?? "", /text\/javascript/);
  } finally {
    server.close();
  }
});

test("production server: enforces authentication and rejects unauthorized requests", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // No token
    const unauth1 = await fetchJson(`${baseUrl}/api/categories`);
    assert.equal(unauth1.status, 401);
    assert.equal(unauth1.json.error, "Unauthorized");

    // Invalid token
    const unauth2 = await fetchJson(`${baseUrl}/api/categories?token=invalid_token`);
    assert.equal(unauth2.status, 401);
    assert.equal(unauth2.json.error, "Unauthorized");

    // Valid token via header
    const authHeader = await fetchJson(`${baseUrl}/api/categories`, {
      "x-osx-clean-token": TOKEN,
    });
    assert.equal(authHeader.status, 200);
    assert.equal(Array.isArray(authHeader.json.categories), true);
    assert.equal(authHeader.json.categories.length, 17);

    // Valid token via query param
    const authQuery = await fetchJson(`${baseUrl}/api/categories?token=${TOKEN}`);
    assert.equal(authQuery.status, 200);
    assert.equal(authQuery.json.categories.length, 17);
  } finally {
    server.close();
  }
});

test("production server: streams storage overview via SSE", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    // Collect until disk stats event or first section arrives
    const events = await readSSEUntil(
      `http://127.0.0.1:${port}/api/overview?token=${TOKEN}`,
      (item) => item.event === "disk" || item.event === "done",
    );
    assert.equal(events.length > 0, true);

    const diskEvent = events.find((e) => e.event === "disk");
    if (diskEvent) {
      assert.equal(typeof diskEvent.data.total, "number");
      assert.equal(typeof diskEvent.data.used, "number");
      assert.equal(typeof diskEvent.data.free, "number");
    }
  } finally {
    server.close();
  }
});

test("production server: handles scan event stream, categories, and safety deletion verification", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Scan trash and tempFiles
    const events = await readSSEUntil(
      `${baseUrl}/api/scan?token=${TOKEN}&categories=trash,tempFiles&minItemMB=0`,
      (item) => item.event === "done",
    );
    const eventTypes = events.map((e) => e.event);
    assert.equal(eventTypes.includes("category-start"), true);
    assert.equal(eventTypes.includes("category-done"), true);
    assert.equal(eventTypes.includes("done"), true);

    // 2. Delete API safety check: unscanned path rejected
    const delUnscanned = await postJson(
      `${baseUrl}/api/delete?token=${TOKEN}`,
      { paths: ["/tmp/unscanned-nonexistent-file.txt"], mode: "delete" },
    );
    assert.equal(delUnscanned.status, 200);
    assert.equal(delUnscanned.json.results[0].ok, false);
    assert.match(delUnscanned.json.results[0].error, /scan result/i);

    // 3. Delete API safety check: protected root blocked
    const delProtected = await postJson(
      `${baseUrl}/api/delete?token=${TOKEN}`,
      { paths: ["/Applications"], mode: "trash" },
    );
    assert.equal(delProtected.status, 200);
    assert.equal(delProtected.json.results[0].ok, false);
    assert.match(delProtected.json.results[0].error, /Protected system area/i);

    // 4. Reveal API
    const revealRes = await postJson(`${baseUrl}/api/reveal?token=${TOKEN}`, {
      path: "/tmp",
    });
    assert.equal(revealRes.status, 200);
    assert.equal(revealRes.json.ok, true);

    // 5. Live scan + deletion of a scanned test file in /tmp
    const testFile = path.join("/tmp", `osx-clean-prod-test-${Date.now()}.txt`);
    await fs.writeFile(testFile, "disposable content for production test", "utf8");

    try {
      // Run scan so testFile is recorded in scannedPaths
      const scanEvents = await readSSEUntil(
        `${baseUrl}/api/scan?token=${TOKEN}&categories=temp-files&minItemMB=0`,
        (item) => item.event === "done",
      );
      const tempCategory = scanEvents.find(
        (e) => e.event === "category-done" && e.data.id === "temp-files",
      );
      assert.notEqual(tempCategory, null);
      const foundInScan = tempCategory.data.items.some((i) => i.path === testFile);
      assert.equal(foundInScan, true);

      // Now request permanent deletion of the verified scanned file
      const delSuccess = await postJson(
        `${baseUrl}/api/delete?token=${TOKEN}`,
        { paths: [testFile], mode: "delete" },
      );
      assert.equal(delSuccess.status, 200);
      assert.equal(delSuccess.json.results[0].ok, true);
      assert.equal(delSuccess.json.results[0].path, testFile);

      // Verify file is gone from disk
      const existsAfter = await fs
        .stat(testFile)
        .then(() => true)
        .catch(() => false);
      assert.equal(existsAfter, false);
    } finally {
      await fs.rm(testFile, { force: true });
    }
  } finally {
    server.close();
  }
});

test("production CLI: launches process, binds port, serves token, and exits cleanly", async () => {
  const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const testPort = 48291;

  const child = spawn(process.execPath, [cliPath, "--no-open", "--port", String(testPort)], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const stdout = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for CLI to start. Output: ${output}`));
      }, 5000);

      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
        if (output.includes("osx-clean is running.") && output.includes("http://127.0.0.1:")) {
          clearTimeout(timeout);
          resolve(output);
        }
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    assert.match(stdout, /osx-clean is running\./);
    const match = stdout.match(/http:\/\/127\.0\.0\.1:48291\/\?token=([a-f0-9]+)/);
    assert.notEqual(match, null);
    const cliToken = match[1];

    // Fetch categories using CLI token
    const res = await fetchJson(`http://127.0.0.1:${testPort}/api/categories?token=${cliToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.categories.length, 17);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));
  }
});
