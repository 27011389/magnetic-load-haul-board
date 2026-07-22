import { access } from "node:fs/promises";
const workerPath = new URL("../dist/server/index.js", import.meta.url);

await access(workerPath);

const workerUrl = new URL(workerPath);
workerUrl.searchParams.set("validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);

if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js must export a Worker with a fetch function.");
}

console.log("Validated production Worker artifact.");
