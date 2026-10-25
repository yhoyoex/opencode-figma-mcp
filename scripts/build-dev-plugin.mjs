#!/usr/bin/env node
// Builds a Dev Mode variant of the Figma plugin into dist/opencode_mcp_plugin_dev/.
// Figma forbids "dev" and "figjam" in one manifest, so the main plugin
// (figma + figjam) stays untouched and this copy declares editorType ["dev"]
// with the "inspect" capability. code.js and ui.html are copied verbatim.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src/opencode_mcp_plugin");
const distDir = path.join(root, "dist");
const outDir = path.join(distDir, "opencode_mcp_plugin_dev");

// Guard the recursive delete: only ever remove the dedicated output folder.
if (path.dirname(outDir) !== distDir || path.basename(outDir) !== "opencode_mcp_plugin_dev") {
  throw new Error(`Refusing to clean unexpected output path: ${outDir}`);
}

const manifest = JSON.parse(readFileSync(path.join(srcDir, "manifest.json"), "utf8"));
for (const field of ["main", "ui"]) {
  if (typeof manifest[field] !== "string" || manifest[field].includes("..")) {
    throw new Error(`manifest.${field} must be a local file name, got: ${manifest[field]}`);
  }
}

const devManifest = {
  name: "OpenCode Figma MCP (Dev Mode)",
  id: "opencode-figma-mcp-dev",
  api: manifest.api,
  main: manifest.main,
  ui: manifest.ui,
  editorType: ["dev"],
  capabilities: ["inspect"],
  permissions: [],
  networkAccess: manifest.networkAccess,
  documentAccess: manifest.documentAccess,
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
copyFileSync(path.join(srcDir, manifest.main), path.join(outDir, manifest.main));
copyFileSync(path.join(srcDir, manifest.ui), path.join(outDir, manifest.ui));
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(devManifest, null, 2) + "\n");

console.log(`Dev Mode plugin written to ${path.relative(root, outDir)}/`);
