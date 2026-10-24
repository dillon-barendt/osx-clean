import type { Server } from "node:http";
import { createServer, TOKEN } from "../server.js";

export interface DesktopService {
  server: Server;
  url: URL;
  close: () => Promise<void>;
}

/** Reuse the CLI service unchanged; let the OS choose an available local port. */
export async function startDesktopService(): Promise<DesktopService> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine the local service address.");
  }
  return {
    server,
    url: new URL(`http://127.0.0.1:${address.port}/?token=${TOKEN}`),
    close: () => new Promise<void>((resolve, reject) => {
      // SSE connections must be closed too, so quitting never waits for a scan.
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
