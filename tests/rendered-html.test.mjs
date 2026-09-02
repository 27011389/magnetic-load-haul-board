import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultMagneticBoard } from "../app/board-data.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("serves the standalone board and enforces multi-screen write safety", async () => {
  const testDirectory = await mkdtemp(path.join(tmpdir(), "shiftboard-next-test-"));
  const databasePath = path.join(testDirectory, "shiftboard.sqlite");
  const port = await getAvailablePort();
  let output = "";
  const server = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot,
      env: { ...process.env, SHIFTBOARD_DB_PATH: databasePath },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });

  const origin = `http://127.0.0.1:${port}`;
  try {
    let rootResponse;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Next.js exited before startup.\n${output}`);
      try {
        rootResponse = await fetch(origin);
        if (rootResponse.ok) break;
      } catch {
        // The production server is still starting.
      }
      await wait(250);
    }
    assert.ok(rootResponse?.ok, `Next.js did not start.\n${output}`);
    assert.match(rootResponse.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(rootResponse.headers.get("cache-control") ?? "", /no-store/i);
    const html = await rootResponse.text();
    assert.match(html, /<title>Magnetic Load and Haul Shiftboard<\/title>/i);
    assert.match(html, /Loading the latest shiftboard/i);
    assert.doesNotMatch(html, /20 JUL 2026/i);

    const initialResponse = await fetch(`${origin}/api/board`, { cache: "no-store" });
    assert.equal(initialResponse.status, 200);
    assert.match(initialResponse.headers.get("cache-control") ?? "", /no-store/i);
    const initial = await initialResponse.json();
    assert.equal(initial.version, 1);
    assert.equal(initial.board.layoutVersion, defaultMagneticBoard.layoutVersion);

    const unchangedResponse = await fetch(`${origin}/api/board?since=${initial.version}`, { cache: "no-store" });
    assert.equal(unchangedResponse.status, 204);
    assert.equal(await unchangedResponse.text(), "");

    const staleClientResponse = await fetch(`${origin}/api/board`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        board: { ...initial.board, layoutVersion: initial.board.layoutVersion - 1 },
      }),
    });
    assert.equal(staleClientResponse.status, 428);
    assert.match((await staleClientResponse.json()).error, /refresh/i);

    const updatedBoard = { ...initial.board, roster: "INTEGRATION TEST ROSTER" };
    const savedResponse = await fetch(`${origin}/api/board`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: updatedBoard, baseVersion: initial.version, actor: "TEST SCREEN A" }),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.version, 2);
    assert.equal(saved.board.roster, "INTEGRATION TEST ROSTER");

    const changedResponse = await fetch(`${origin}/api/board?since=${initial.version}`, { cache: "no-store" });
    assert.equal(changedResponse.status, 200);
    assert.equal((await changedResponse.json()).version, saved.version);

    const conflictingResponse = await fetch(`${origin}/api/board`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: initial.board, baseVersion: initial.version, actor: "TEST SCREEN B" }),
    });
    assert.equal(conflictingResponse.status, 409);
    const conflict = await conflictingResponse.json();
    assert.equal(conflict.version, 2);
    assert.equal(conflict.board.roster, "INTEGRATION TEST ROSTER");

    const incompatibleResponse = await fetch(`${origin}/api/board`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        board: { ...saved.board, layoutVersion: saved.board.layoutVersion - 1 },
        baseVersion: saved.version,
        actor: "OLD TEST SCREEN",
      }),
    });
    assert.equal(incompatibleResponse.status, 409);

    const finalResponse = await fetch(`${origin}/api/board`, { cache: "no-store" });
    const final = await finalResponse.json();
    assert.equal(final.version, 2);
    assert.equal(final.board.roster, "INTEGRATION TEST ROSTER");
  } finally {
    server.kill();
    if (server.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        wait(5_000),
      ]);
    }
    await rm(testDirectory, { recursive: true, force: true });
  }
});
