import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const binary = process.argv[2] ?? path.join(
  "release", process.arch === "arm64" ? "mac-arm64" : "mac",
  "osx-clean.app", "Contents", "MacOS", "osx-clean",
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(path.resolve(binary), [...process.argv.slice(3), "--smoke-test"], { env: environment });
let output = "";
child.stdout.on("data", (data) => { output += data; process.stdout.write(data); });
child.stderr.on("data", (data) => process.stderr.write(data));
const timeout = setTimeout(() => {
  console.error("Desktop smoke test exceeded 90 seconds.");
  child.kill("SIGKILL");
}, 90_000);
child.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  clearTimeout(timeout);
  process.exitCode = code === 0 && output.includes("DESKTOP_SMOKE_OK:") ? 0 : 1;
});
