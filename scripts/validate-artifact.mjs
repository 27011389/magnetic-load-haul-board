import { access } from "node:fs/promises";
const buildIdPath = new URL("../.next/BUILD_ID", import.meta.url);
const routesManifestPath = new URL("../.next/routes-manifest.json", import.meta.url);

await Promise.all([access(buildIdPath), access(routesManifestPath)]);

console.log("Validated production Next.js artifact.");
