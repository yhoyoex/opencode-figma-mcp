#!/usr/bin/env node

// src/opencode_figma_mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

// src/opencode_figma_mcp/design/simplify.ts
var VECTOR_TYPES = /* @__PURE__ */ new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "REGULAR_POLYGON"
]);
var SHAPE_TYPES = /* @__PURE__ */ new Set(["ELLIPSE", "LINE", "RECTANGLE"]);
function round(n, digits = 2) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
function colorToCss(color, paintOpacity = 1) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = round((color.a ?? 1) * paintOpacity, 3);
  if (a >= 1) {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function gradientToCss(paint) {
  const stops = (paint.gradientStops || []).map(
    (s) => `${colorToCss(s.color, paint.opacity ?? 1)} ${round(s.position * 100, 1)}%`
  ).join(", ");
  const handles = paint.gradientHandlePositions;
  if (paint.type === "GRADIENT_LINEAR") {
    let angle = 180;
    if (handles && handles.length >= 2) {
      const dx = handles[1].x - handles[0].x;
      const dy = handles[1].y - handles[0].y;
      angle = round(Math.atan2(dy, dx) * 180 / Math.PI + 90, 1);
    }
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  if (paint.type === "GRADIENT_RADIAL") {
    return `radial-gradient(circle, ${stops})`;
  }
  if (paint.type === "GRADIENT_ANGULAR") {
    return `conic-gradient(${stops})`;
  }
  return `/* ${paint.type} */ linear-gradient(${stops})`;
}
function simplifyPaint(paint) {
  if (paint.type === "SOLID") {
    return colorToCss(paint.color, paint.opacity ?? 1);
  }
  if (paint.type && paint.type.startsWith("GRADIENT_")) {
    return gradientToCss(paint);
  }
  if (paint.type === "IMAGE") {
    const img = { type: "IMAGE", imageRef: paint.imageRef ?? paint.imageHash };
    if (paint.scaleMode) img.scaleMode = paint.scaleMode;
    if (paint.opacity !== void 0 && paint.opacity < 1) img.opacity = paint.opacity;
    return img;
  }
  return { type: paint.type };
}
function visiblePaints(paints) {
  if (!Array.isArray(paints)) return [];
  return paints.filter((p) => p && p.visible !== false);
}
function padding(node) {
  const t = node.paddingTop || 0;
  const r = node.paddingRight || 0;
  const b = node.paddingBottom || 0;
  const l = node.paddingLeft || 0;
  if (!t && !r && !b && !l) return void 0;
  if (t === b && l === r) return t === l ? `${t}px` : `${t}px ${r}px`;
  return `${t}px ${r}px ${b}px ${l}px`;
}
var JUSTIFY = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  SPACE_BETWEEN: "space-between"
};
var ALIGN = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  BASELINE: "baseline"
};
function sizingOf(node, axis) {
  const v = node[`layoutSizing${axis}`];
  if (!v) return void 0;
  return v.toLowerCase();
}
function buildLayout(node, parent) {
  const layout = {};
  const mode = node.layoutMode;
  if (mode === "HORIZONTAL" || mode === "VERTICAL") {
    layout.display = "flex";
    layout.flexDirection = mode === "HORIZONTAL" ? "row" : "column";
    if (node.layoutWrap === "WRAP") layout.flexWrap = "wrap";
    const justify = JUSTIFY[node.primaryAxisAlignItems || "MIN"];
    if (justify && justify !== "flex-start") layout.justifyContent = justify;
    const align = ALIGN[node.counterAxisAlignItems || "MIN"];
    if (align && align !== "flex-start") layout.alignItems = align;
    if (node.itemSpacing && node.primaryAxisAlignItems !== "SPACE_BETWEEN") {
      layout.gap = `${node.itemSpacing}px`;
    }
    if (node.layoutWrap === "WRAP" && node.counterAxisSpacing) {
      layout.rowGap = `${node.counterAxisSpacing}px`;
    }
    const pad = padding(node);
    if (pad) layout.padding = pad;
  } else if (mode === "GRID") {
    layout.display = "grid";
    const pad = padding(node);
    if (pad) layout.padding = pad;
  }
  const parentIsAutoLayout = parent && (parent.layoutMode === "HORIZONTAL" || parent.layoutMode === "VERTICAL" || parent.layoutMode === "GRID");
  if (parentIsAutoLayout && node.layoutPositioning !== "ABSOLUTE") {
    const h = sizingOf(node, "Horizontal");
    const v = sizingOf(node, "Vertical");
    if (h || v) layout.sizing = { horizontal: h, vertical: v };
    if (node.layoutGrow === 1) layout.flexGrow = 1;
    if (node.layoutAlign === "STRETCH") layout.alignSelf = "stretch";
  } else if (parent) {
    layout.position = "absolute";
    const box = node.absoluteBoundingBox;
    const pbox = parent.absoluteBoundingBox;
    if (box && pbox) {
      layout.left = round(box.x - pbox.x);
      layout.top = round(box.y - pbox.y);
    }
    if (node.constraints) {
      layout.constraints = {
        horizontal: node.constraints.horizontal,
        vertical: node.constraints.vertical
      };
    }
  } else {
    const h = sizingOf(node, "Horizontal");
    const v = sizingOf(node, "Vertical");
    if (h || v) layout.sizing = { horizontal: h, vertical: v };
  }
  if (node.clipsContent) layout.overflow = "hidden";
  if (node.minWidth) layout.minWidth = node.minWidth;
  if (node.maxWidth) layout.maxWidth = node.maxWidth;
  if (node.minHeight) layout.minHeight = node.minHeight;
  if (node.maxHeight) layout.maxHeight = node.maxHeight;
  return Object.keys(layout).length ? layout : void 0;
}
function buildTextStyle(style) {
  if (!style) return void 0;
  const ts = {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize
  };
  if (style.italic) ts.fontStyle = "italic";
  if (style.lineHeightUnit === "PIXELS" && style.lineHeightPx) {
    ts.lineHeight = `${round(style.lineHeightPx)}px`;
  } else if (style.lineHeightUnit === "FONT_SIZE_%" && style.lineHeightPercentFontSize) {
    ts.lineHeight = round(style.lineHeightPercentFontSize / 100, 3);
  } else if (style.lineHeightPx && style.fontSize) {
    ts.lineHeight = round(style.lineHeightPx / style.fontSize, 3);
  }
  if (style.letterSpacing) ts.letterSpacing = `${round(style.letterSpacing)}px`;
  if (style.textAlignHorizontal && style.textAlignHorizontal !== "LEFT") {
    ts.textAlign = style.textAlignHorizontal.toLowerCase();
  }
  if (style.textCase && style.textCase !== "ORIGINAL") {
    ts.textTransform = style.textCase === "UPPER" ? "uppercase" : style.textCase === "LOWER" ? "lowercase" : style.textCase === "TITLE" ? "capitalize" : style.textCase.toLowerCase();
  }
  if (style.textDecoration && style.textDecoration !== "NONE") {
    ts.textDecoration = style.textDecoration === "STRIKETHROUGH" ? "line-through" : "underline";
  }
  if (style.paragraphSpacing) ts.paragraphSpacing = style.paragraphSpacing;
  return ts;
}
function buildEffects(effects) {
  const list = Array.isArray(effects) ? effects.filter((e) => e.visible !== false) : [];
  if (!list.length) return void 0;
  const out = {};
  const shadows = list.filter((e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW").map(
    (e) => `${e.type === "INNER_SHADOW" ? "inset " : ""}${round(e.offset?.x || 0)}px ${round(e.offset?.y || 0)}px ${round(e.radius || 0)}px ${round(e.spread || 0)}px ${colorToCss(e.color || { r: 0, g: 0, b: 0, a: 0.25 })}`
  );
  if (shadows.length) out.boxShadow = shadows.join(", ");
  const blur = list.find((e) => e.type === "LAYER_BLUR");
  if (blur) out.filter = `blur(${round(blur.radius)}px)`;
  const bgBlur = list.find((e) => e.type === "BACKGROUND_BLUR");
  if (bgBlur) out.backdropFilter = `blur(${round(bgBlur.radius)}px)`;
  return out;
}
function buildStroke(node) {
  const paints = visiblePaints(node.strokes);
  if (!paints.length) return void 0;
  const stroke = { colors: paints.map(simplifyPaint) };
  if (node.individualStrokeWeights) {
    const w = node.individualStrokeWeights;
    stroke.width = `${w.top}px ${w.right}px ${w.bottom}px ${w.left}px`;
  } else if (node.strokeWeight !== void 0) {
    stroke.width = `${node.strokeWeight}px`;
  }
  if (node.strokeAlign) stroke.align = node.strokeAlign.toLowerCase();
  if (Array.isArray(node.strokeDashes) && node.strokeDashes.length) stroke.dashes = node.strokeDashes;
  return stroke;
}
function isVectorOnly(node) {
  if (VECTOR_TYPES.has(node.type)) return true;
  if (SHAPE_TYPES.has(node.type)) {
    return !visiblePaints(node.fills).some((p) => p.type === "IMAGE");
  }
  if (["GROUP", "FRAME", "INSTANCE", "COMPONENT"].includes(node.type)) {
    const children = (node.children || []).filter((c) => c.visible !== false);
    if (!children.length) return false;
    if (node.layoutMode && node.layoutMode !== "NONE") return false;
    return children.every(isVectorOnly);
  }
  return false;
}
function containsVector(node) {
  if (VECTOR_TYPES.has(node.type)) return true;
  return (node.children || []).some(containsVector);
}
var StyleRegistry = class {
  byKey = /* @__PURE__ */ new Map();
  styles = {};
  counters = {};
  ref(prefix, value) {
    if (value === void 0) return void 0;
    const key = `${prefix}:${JSON.stringify(value)}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    this.counters[prefix] = (this.counters[prefix] || 0) + 1;
    const id = `${prefix}${this.counters[prefix]}`;
    this.byKey.set(key, id);
    this.styles[id] = value;
    return id;
  }
};
function collectBoundVariables(bound, ctx) {
  if (!bound || typeof bound !== "object") return void 0;
  const out = {};
  for (const [field, value] of Object.entries(bound)) {
    const list = Array.isArray(value) ? value : [value];
    const ids = list.filter((v) => v && v.type === "VARIABLE_ALIAS" && v.id).map((v) => v.id);
    if (!ids.length) continue;
    ids.forEach((id) => ctx.variableIds.add(id));
    const names = ids.map((id) => ctx.options.variables?.[id]?.name ?? id);
    out[field] = names.length === 1 ? names[0] : names;
  }
  return Object.keys(out).length ? out : void 0;
}
function simplifyNode(node, parent, depth, ctx) {
  if (!node) return null;
  if (node.visible === false && !ctx.options.includeHidden) return null;
  const out = { id: node.id, name: node.name, type: node.type };
  const box = node.absoluteBoundingBox;
  if (box) out.size = { width: round(box.width), height: round(box.height) };
  if (node.type === "INSTANCE" && node.componentId) {
    const comp = ctx.components[node.componentId];
    out.component = { id: node.componentId, name: comp?.name };
    if (node.componentProperties) {
      const props = {};
      for (const [k, v] of Object.entries(node.componentProperties)) {
        props[k.replace(/#\d+:\d+$/, "")] = v.value;
      }
      out.component.properties = props;
    }
  }
  const layout = buildLayout(node, parent);
  if (layout) out.layout = ctx.registry.ref("layout", layout);
  const fills = visiblePaints(node.fills);
  if (fills.length && node.type !== "TEXT") {
    out.fills = ctx.registry.ref("fill", fills.map(simplifyPaint));
  } else if (fills.length && node.type === "TEXT") {
    out.color = ctx.registry.ref("fill", fills.map(simplifyPaint));
  }
  for (const f of fills) {
    if (f.type === "IMAGE") {
      ctx.assets.images.push({ nodeId: node.id, name: node.name, imageRef: f.imageRef ?? f.imageHash });
    }
  }
  const stroke = buildStroke(node);
  if (stroke) out.stroke = ctx.registry.ref("stroke", stroke);
  const effects = buildEffects(node.effects);
  if (effects) out.effects = ctx.registry.ref("effect", effects);
  if (node.opacity !== void 0 && node.opacity < 1) out.opacity = round(node.opacity, 3);
  if (node.blendMode && !["PASS_THROUGH", "NORMAL"].includes(node.blendMode)) {
    out.blendMode = node.blendMode.toLowerCase();
  }
  if (Array.isArray(node.rectangleCornerRadii)) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    out.borderRadius = tl === tr && tr === br && br === bl ? `${tl}px` : `${tl}px ${tr}px ${br}px ${bl}px`;
  } else if (node.cornerRadius) {
    out.borderRadius = `${node.cornerRadius}px`;
  }
  if (node.type === "ELLIPSE") out.borderRadius = "50%";
  if (node.type === "TEXT") {
    out.text = node.characters;
    out.textStyle = ctx.registry.ref("text", buildTextStyle(node.style));
    const overrides = node.characterStyleOverrides || [];
    const table = node.styleOverrideTable || {};
    if (overrides.some((o) => o) && node.characters) {
      const segments = [];
      let current = overrides[0] || 0;
      let start = 0;
      const chars = node.characters;
      for (let i = 1; i <= chars.length; i++) {
        const o = i < overrides.length ? overrides[i] || 0 : 0;
        if (i === chars.length || o !== current) {
          const seg = { text: chars.slice(start, i) };
          const ov = table[current];
          if (current && ov) {
            seg.style = ctx.registry.ref("text", buildTextStyle({ ...node.style, ...ov }));
            const ovFills = visiblePaints(ov.fills);
            if (ovFills.length) seg.color = ctx.registry.ref("fill", ovFills.map(simplifyPaint));
          }
          segments.push(seg);
          start = i;
          current = o;
        }
      }
      out.richText = segments;
    }
  }
  if (node.styles && typeof node.styles === "object") {
    const named = {};
    for (const [kind, styleId] of Object.entries(node.styles)) {
      const meta = ctx.styleMeta[styleId];
      named[kind] = meta?.name ?? styleId;
    }
    out.designStyles = named;
  }
  const vars = collectBoundVariables(node.boundVariables, ctx);
  if (vars) out.variables = vars;
  if (node.children && node.children.length && isVectorOnly(node) && containsVector(node)) {
    out.exportAs = "svg";
    ctx.assets.icons.push({ nodeId: node.id, name: node.name, suggestedFormat: "svg" });
    return out;
  }
  if (VECTOR_TYPES.has(node.type)) {
    out.exportAs = "svg";
    if (!parent || !isVectorOnly(parent)) {
      ctx.assets.icons.push({ nodeId: node.id, name: node.name, suggestedFormat: "svg" });
    }
    return out;
  }
  if (Array.isArray(node.children) && node.children.length) {
    const maxDepth = ctx.options.maxDepth;
    if (maxDepth !== void 0 && depth >= maxDepth) {
      out.childrenTruncated = node.children.length;
    } else {
      const children = node.children.map((c) => simplifyNode(c, node, depth + 1, ctx)).filter((c) => c !== null);
      if (children.length) out.children = children;
    }
  }
  return out;
}
function simplifyBundles(bundles, options = {}) {
  const registry = new StyleRegistry();
  const styleMeta = {};
  const components = {};
  const componentSets = {};
  for (const b of bundles) {
    Object.assign(styleMeta, b.styles || {});
    Object.assign(components, b.components || {});
    Object.assign(componentSets, b.componentSets || {});
  }
  const ctx = {
    registry,
    styleMeta,
    components,
    options,
    assets: { icons: [], images: [] },
    variableIds: /* @__PURE__ */ new Set()
  };
  const nodes = bundles.map((b) => simplifyNode(b.document, null, 0, ctx)).filter((n) => n !== null);
  const spec = { nodes, styles: registry.styles, assets: ctx.assets };
  if (Object.keys(components).length) {
    spec.components = Object.fromEntries(
      Object.entries(components).map(([id, c]) => [
        id,
        {
          name: c.name,
          description: c.description || void 0,
          componentSetId: c.componentSetId || void 0,
          remote: c.remote || void 0
        }
      ])
    );
  }
  if (Object.keys(componentSets).length) {
    spec.componentSets = Object.fromEntries(
      Object.entries(componentSets).map(([id, c]) => [id, { name: c.name, description: c.description || void 0 }])
    );
  }
  if (ctx.variableIds.size) {
    const vars = {};
    for (const id of ctx.variableIds) {
      vars[id] = options.variables?.[id] ?? { name: id };
    }
    spec.variables = vars;
  }
  const seen = /* @__PURE__ */ new Set();
  spec.assets.images = spec.assets.images.filter((img) => {
    if (!img.imageRef || seen.has(img.imageRef)) return false;
    seen.add(img.imageRef);
    return true;
  });
  return spec;
}

// src/opencode_figma_mcp/design/figma_rest.ts
var API_BASE = "https://api.figma.com/v1";
function getFigmaToken() {
  return process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_API_KEY || process.env.FIGMA_TOKEN || void 0;
}
function parseFigmaUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid Figma URL: ${input}`);
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) {
    throw new Error(`Not a figma.com URL: ${input}`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const kindIndex = parts.findIndex(
    (p) => ["design", "file", "proto", "board"].includes(p)
  );
  if (kindIndex === -1 || !parts[kindIndex + 1]) {
    throw new Error(`Could not find a file key in URL: ${input}`);
  }
  let fileKey = parts[kindIndex + 1];
  const branchIndex = parts.indexOf("branch");
  if (branchIndex !== -1 && parts[branchIndex + 1]) {
    fileKey = parts[branchIndex + 1];
  }
  const rawNodeId = url.searchParams.get("node-id");
  return {
    fileKey,
    nodeId: rawNodeId ? normalizeNodeId(rawNodeId) : void 0
  };
}
function normalizeNodeId(nodeId) {
  return nodeId.includes(":") ? nodeId : nodeId.replace("-", ":");
}
async function figmaGet(path2, token) {
  return figmaRequest("GET", path2, token);
}
async function figmaRequest(method, path2, token, body) {
  const headers = { "X-Figma-Token": token };
  if (body !== void 0) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path2}`, {
    method,
    headers,
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.err || parsed.message || text;
    } catch {
    }
    const hint = res.status === 403 ? " (check that FIGMA_ACCESS_TOKEN is valid and has access to this file)" : res.status === 429 ? " (Figma rate limit reached, try again later)" : "";
    const shortDetail = String(detail).length > 500 ? `${String(detail).slice(0, 500)}\u2026` : detail;
    throw new Error(`Figma API ${res.status}: ${shortDetail}${hint}`);
  }
  return text ? JSON.parse(text) : {};
}
async function getFileNodes(token, fileKey, nodeIds, depth) {
  const params = new URLSearchParams({ ids: nodeIds.join(",") });
  if (depth !== void 0) params.set("depth", String(depth));
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/nodes?${params}`, token);
}
async function getFileOutline(token, fileKey, depth = 2) {
  return figmaGet(`/files/${encodeURIComponent(fileKey)}?depth=${depth}`, token);
}
async function getImageRenderUrls(token, fileKey, nodeIds, format, scale = 1) {
  const params = new URLSearchParams({ ids: nodeIds.join(","), format });
  if (format !== "svg") params.set("scale", String(scale));
  const data = await figmaGet(`/images/${encodeURIComponent(fileKey)}?${params}`, token);
  if (data.err) throw new Error(`Figma image render error: ${data.err}`);
  return data.images || {};
}
async function getImageFillUrls(token, fileKey) {
  const data = await figmaGet(`/files/${encodeURIComponent(fileKey)}/images`, token);
  return data.meta?.images || {};
}
async function getLocalVariables(token, fileKey) {
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/variables/local`, token);
}
async function getFileComments(token, fileKey) {
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/comments`, token);
}
async function postFileComment(token, fileKey, body) {
  return figmaRequest("POST", `/files/${encodeURIComponent(fileKey)}/comments`, token, body);
}
async function getFileVersions(token, fileKey, page = {}) {
  const params = new URLSearchParams();
  if (page.pageSize !== void 0) params.set("page_size", String(page.pageSize));
  if (page.before !== void 0) params.set("before", String(page.before));
  if (page.after !== void 0) params.set("after", String(page.after));
  const query = params.toString();
  return figmaGet(
    `/files/${encodeURIComponent(fileKey)}/versions${query ? `?${query}` : ""}`,
    token
  );
}
function teamLibraryQuery(page) {
  const params = new URLSearchParams();
  if (page.pageSize !== void 0) params.set("page_size", String(page.pageSize));
  if (page.after !== void 0) params.set("after", String(page.after));
  const query = params.toString();
  return query ? `?${query}` : "";
}
async function getTeamComponents(token, teamId, page = {}) {
  return figmaGet(
    `/teams/${encodeURIComponent(teamId)}/components${teamLibraryQuery(page)}`,
    token
  );
}
async function getTeamStyles(token, teamId, page = {}) {
  return figmaGet(`/teams/${encodeURIComponent(teamId)}/styles${teamLibraryQuery(page)}`, token);
}
async function getTeamProjects(token, teamId) {
  return figmaGet(`/teams/${encodeURIComponent(teamId)}/projects`, token);
}
async function getProjectFiles(token, projectId, branchData = false) {
  const query = branchData ? "?branch_data=true" : "";
  return figmaGet(`/projects/${encodeURIComponent(projectId)}/files${query}`, token);
}
async function getDevResources(token, fileKey, nodeIds = []) {
  const query = nodeIds.length ? `?${new URLSearchParams({ node_ids: nodeIds.join(",") })}` : "";
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/dev_resources${query}`, token);
}
async function createDevResources(token, devResources) {
  return figmaRequest("POST", "/dev_resources", token, { dev_resources: devResources });
}
async function deleteDevResource(token, fileKey, devResourceId) {
  return figmaRequest(
    "DELETE",
    `/files/${encodeURIComponent(fileKey)}/dev_resources/${encodeURIComponent(devResourceId)}`,
    token
  );
}
var DOWNLOAD_HOST_SUFFIXES = ["figma.com", "figmausercontent.com", "amazonaws.com"];
function assertAllowedDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Download rejected: invalid URL ${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = DOWNLOAD_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
  if (parsed.protocol !== "https:" || !allowed) {
    throw new Error(
      `Download rejected: ${url} is not an https URL on ${DOWNLOAD_HOST_SUFFIXES.join(", ")}`
    );
  }
}
async function downloadBytes(url) {
  assertAllowedDownloadUrl(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// src/opencode_figma_mcp/server.ts
var logger = {
  info: (message) => process.stderr.write(`[INFO] ${message}
`),
  debug: (message) => process.stderr.write(`[DEBUG] ${message}
`),
  warn: (message) => process.stderr.write(`[WARN] ${message}
`),
  error: (message) => process.stderr.write(`[ERROR] ${message}
`),
  log: (message) => process.stderr.write(`[LOG] ${message}
`)
};
var ws = null;
var pendingRequests = /* @__PURE__ */ new Map();
var currentChannel = null;
var lastJoinedChannel = null;
var server = new McpServer({
  name: "opencode-figma-mcp",
  version: "1.1.1"
});
var args = process.argv.slice(2);
var serverArg = args.find((arg) => arg.startsWith("--server="));
var serverUrl = serverArg ? serverArg.split("=")[1] : "localhost";
var WS_URL = serverUrl === "localhost" ? `ws://${serverUrl}` : `wss://${serverUrl}`;
server.tool(
  "get_document_info",
  "Get detailed information about the current Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_document_info");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting document info: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "get_selection",
  "Get information about the current selection in Figma",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_selection");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting selection: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "read_my_design",
  "Get detailed information about the current selection in Figma, including all node details",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("read_my_design", {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node info: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
var nodeDetailSchema = z.enum(["basic", "full"]).optional().describe(
  'Level of detail (default "basic"). "full" adds visibility/lock/opacity/rotation/blendMode/isMask, constraints, effects, style ids, boundVariables, explicitVariableModes, component properties, auto-layout & sizing fields, stroke weight/align/dash, and includes VECTOR nodes with a summary of vectorPaths. figma.mixed values are returned as "mixed"'
);
server.tool(
  "get_node_info",
  "Get detailed information about a specific node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to get information about"),
    detail: nodeDetailSchema
  },
  async ({ nodeId, detail }) => {
    try {
      const result = await sendCommandToFigma("get_node_info", {
        nodeId,
        detail
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filterFigmaNode(result, detail))
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node info: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
function rgbaToHex(color) {
  if (color.startsWith("#")) {
    return color;
  }
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a === 255 ? "" : a.toString(16).padStart(2, "0")}`;
}
function filterFigmaNode(node, detail = "basic") {
  const full = detail === "full";
  if (node.type === "VECTOR" && !full) {
    return null;
  }
  const filtered = {
    id: node.id,
    name: node.name,
    type: node.type
  };
  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      const processedFill = { ...fill };
      if (!full) delete processedFill.boundVariables;
      delete processedFill.imageRef;
      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map(
          (stop) => {
            const processedStop = { ...stop };
            if (processedStop.color) {
              processedStop.color = rgbaToHex(processedStop.color);
            }
            if (!full) delete processedStop.boundVariables;
            return processedStop;
          }
        );
      }
      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }
      return processedFill;
    });
  }
  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke) => {
      const processedStroke = { ...stroke };
      if (!full) delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }
  if (node.cornerRadius !== void 0) {
    filtered.cornerRadius = node.cornerRadius;
  }
  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }
  if (node.characters) {
    filtered.characters = node.characters;
  }
  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx
    };
  }
  if (full) {
    for (const key of Object.keys(node)) {
      if (!(key in filtered) && key !== "children") {
        filtered[key] = node[key];
      }
    }
  }
  if (node.children) {
    filtered.children = node.children.map((child) => filterFigmaNode(child, detail)).filter((child) => child !== null);
  }
  return filtered;
}
server.tool(
  "get_nodes_info",
  "Get detailed information about multiple nodes in Figma",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to get information about"),
    detail: nodeDetailSchema
  },
  async ({ nodeIds, detail }) => {
    try {
      const infos = nodeIds.length ? await getNodesInfoBatch(nodeIds, detail) : [];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              infos.map((info) => filterFigmaNode(info, detail))
            )
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting nodes info: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
var BATCH_NODES_ERROR_PREFIX = "Error getting nodes info: ";
async function getNodesInfoBatch(nodeIds, detail) {
  let responses;
  try {
    responses = await sendCommandToFigma("get_nodes_info", { nodeIds, detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      message.startsWith(BATCH_NODES_ERROR_PREFIX) ? message.slice(BATCH_NODES_ERROR_PREFIX.length) : message
    );
  }
  const found = Array.isArray(responses) ? responses : [];
  let next = 0;
  return nodeIds.map((nodeId) => {
    const response = found[next];
    if (!response || response.nodeId !== nodeId) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    next++;
    return response.document;
  });
}
server.tool(
  "create_rectangle",
  "Create a new rectangle in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the rectangle"),
    height: z.number().describe("Height of the rectangle"),
    name: z.string().optional().describe("Optional name for the rectangle"),
    parentId: z.string().optional().describe("Optional parent node ID to append the rectangle to")
  },
  async ({ x, y, width, height, name, parentId }) => {
    try {
      const result = await sendCommandToFigma("create_rectangle", {
        x,
        y,
        width,
        height,
        name: name || "Rectangle",
        parentId
      });
      return {
        content: [
          {
            type: "text",
            text: `Created rectangle "${JSON.stringify(result)}"`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating rectangle: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "create_frame",
  "Create a new frame in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the frame"),
    height: z.number().describe("Height of the frame"),
    name: z.string().optional().describe("Optional name for the frame"),
    parentId: z.string().optional().describe("Optional parent node ID to append the frame to"),
    fillColor: z.object({
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)")
    }).optional().describe("Fill color in RGBA format"),
    strokeColor: z.object({
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)")
    }).optional().describe("Stroke color in RGBA format"),
    strokeWeight: z.number().positive().optional().describe("Stroke weight"),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional().describe("Auto-layout mode for the frame"),
    layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether the auto-layout frame wraps its children"),
    paddingTop: z.number().optional().describe("Top padding for auto-layout frame"),
    paddingRight: z.number().optional().describe("Right padding for auto-layout frame"),
    paddingBottom: z.number().optional().describe("Bottom padding for auto-layout frame"),
    paddingLeft: z.number().optional().describe("Left padding for auto-layout frame"),
    primaryAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"]).optional().describe(
      "Primary axis alignment for auto-layout frame. Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."
    ),
    counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Counter axis alignment for auto-layout frame"),
    layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode for auto-layout frame"),
    layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode for auto-layout frame"),
    itemSpacing: z.number().optional().describe(
      "Distance between children in auto-layout frame. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN."
    )
  },
  async ({
    x,
    y,
    width,
    height,
    name,
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode,
    layoutWrap,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    primaryAxisAlignItems,
    counterAxisAlignItems,
    layoutSizingHorizontal,
    layoutSizingVertical,
    itemSpacing
  }) => {
    try {
      const result = await sendCommandToFigma("create_frame", {
        x,
        y,
        width,
        height,
        name: name || "Frame",
        parentId,
        fillColor: fillColor || { r: 1, g: 1, b: 1, a: 1 },
        strokeColor,
        strokeWeight,
        layoutMode,
        layoutWrap,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
        primaryAxisAlignItems,
        counterAxisAlignItems,
        layoutSizingHorizontal,
        layoutSizingVertical,
        itemSpacing
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Created frame "${typedResult.name}" with ID: ${typedResult.id}. Use the ID as the parentId to appendChild inside this frame.`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating frame: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "create_text",
  "Create a new text element in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    text: z.string().describe("Text content"),
    fontSize: z.number().optional().describe("Font size (default: 14)"),
    fontWeight: z.number().optional().describe("Font weight (e.g., 400 for Regular, 700 for Bold)"),
    fontFamily: z.string().min(1).optional().describe(
      "Font family (default: Inter). Use get_available_fonts to list installed fonts"
    ),
    fontStyle: z.string().min(1).optional().describe(
      'Font style name as shown in Figma, e.g. "Regular", "Semi Bold", "Bold Italic". Takes precedence over fontWeight'
    ),
    fontColor: z.object({
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)")
    }).optional().describe("Font color in RGBA format"),
    name: z.string().optional().describe("Semantic layer name for the text node"),
    parentId: z.string().optional().describe("Optional parent node ID to append the text to")
  },
  async ({
    x,
    y,
    text,
    fontSize,
    fontWeight,
    fontFamily,
    fontStyle,
    fontColor,
    name,
    parentId
  }) => {
    try {
      const result = await sendCommandToFigma("create_text", {
        x,
        y,
        text,
        fontSize: fontSize || 14,
        fontWeight: fontWeight || 400,
        fontFamily,
        fontStyle,
        fontColor: fontColor || { r: 0, g: 0, b: 0, a: 1 },
        name: name || "Text",
        parentId
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Created text "${typedResult.name}" with ID: ${typedResult.id}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating text: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "create_node_from_svg",
  "Create vector nodes from SVG markup (e.g. to replace raster PNG icons with editable vectors). Figma wraps the result in a FRAME containing the vector paths.",
  {
    svg: z.string().min(1).describe(
      "Full SVG markup, starting with an <svg> element (include viewBox/width/height for correct sizing)"
    ),
    name: z.string().optional().describe("Optional name for the created node"),
    parentId: z.string().optional().describe(
      "Optional parent node ID (must support children, e.g. a frame, group or section; default: current page)"
    ),
    x: z.number().optional().describe("Optional X position (relative to the parent)"),
    y: z.number().optional().describe("Optional Y position (relative to the parent)")
  },
  async ({ svg, name, parentId, x, y }) => {
    try {
      const result = await sendCommandToFigma("create_node_from_svg", {
        svg,
        name,
        parentId,
        x,
        y
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating node from SVG", error);
    }
  }
);
server.tool(
  "set_fill_color",
  "Set the fill color of a node in Figma can be TextNode or FrameNode",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    r: z.number().min(0).max(1).describe("Red component (0-1)"),
    g: z.number().min(0).max(1).describe("Green component (0-1)"),
    b: z.number().min(0).max(1).describe("Blue component (0-1)"),
    a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)")
  },
  async ({ nodeId, r, g, b, a }) => {
    try {
      const result = await sendCommandToFigma("set_fill_color", {
        nodeId,
        color: { r, g, b, a: a || 1 }
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Set fill color of node "${typedResult.name}" to RGBA(${r}, ${g}, ${b}, ${a || 1})`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting fill color: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_stroke_color",
  "Set the stroke color of a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    r: z.number().min(0).max(1).describe("Red component (0-1)"),
    g: z.number().min(0).max(1).describe("Green component (0-1)"),
    b: z.number().min(0).max(1).describe("Blue component (0-1)"),
    a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
    weight: z.number().positive().optional().describe("Stroke weight")
  },
  async ({ nodeId, r, g, b, a, weight }) => {
    try {
      const result = await sendCommandToFigma("set_stroke_color", {
        nodeId,
        color: { r, g, b, a: a || 1 },
        weight: weight || 1
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Set stroke color of node "${typedResult.name}" to RGBA(${r}, ${g}, ${b}, ${a || 1}) with weight ${weight || 1}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting stroke color: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "move_node",
  "Move a node to a new position in Figma",
  {
    nodeId: z.string().describe("The ID of the node to move"),
    x: z.number().describe("New X position"),
    y: z.number().describe("New Y position")
  },
  async ({ nodeId, x, y }) => {
    try {
      const result = await sendCommandToFigma("move_node", { nodeId, x, y });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Moved node "${typedResult.name}" to position (${x}, ${y})`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error moving node: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "clone_node",
  "Clone an existing node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to clone"),
    x: z.number().optional().describe("New X position for the clone"),
    y: z.number().optional().describe("New Y position for the clone")
  },
  async ({ nodeId, x, y }) => {
    try {
      const result = await sendCommandToFigma("clone_node", { nodeId, x, y });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Cloned node "${typedResult.name}" with new ID: ${typedResult.id}${x !== void 0 && y !== void 0 ? ` at position (${x}, ${y})` : ""}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error cloning node: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "resize_node",
  "Resize a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to resize"),
    width: z.number().positive().describe("New width"),
    height: z.number().positive().describe("New height")
  },
  async ({ nodeId, width, height }) => {
    try {
      const result = await sendCommandToFigma("resize_node", {
        nodeId,
        width,
        height
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Resized node "${typedResult.name}" to width ${width} and height ${height}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error resizing node: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "delete_node",
  "Delete a node from Figma",
  {
    nodeId: z.string().describe("The ID of the node to delete")
  },
  async ({ nodeId }) => {
    try {
      await sendCommandToFigma("delete_node", { nodeId });
      return {
        content: [
          {
            type: "text",
            text: `Deleted node with ID: ${nodeId}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting node: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "delete_multiple_nodes",
  "Delete multiple nodes from Figma at once",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to delete")
  },
  async ({ nodeIds }) => {
    try {
      const result = await sendCommandToFigma("delete_multiple_nodes", {
        nodeIds
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting multiple nodes: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "export_node_as_image",
  "Export a node as an image from Figma",
  {
    nodeId: z.string().describe("The ID of the node to export"),
    format: z.enum(["PNG", "JPG", "SVG", "PDF"]).optional().describe("Export format"),
    scale: z.number().positive().optional().describe("Export scale")
  },
  async ({ nodeId, format, scale }) => {
    try {
      const result = await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: format || "PNG",
        scale: scale || 1
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "image",
            data: typedResult.imageData,
            mimeType: typedResult.mimeType || "image/png"
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error exporting node as image: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_text_content",
  "Set the text content of an existing text node in Figma",
  {
    nodeId: z.string().describe("The ID of the text node to modify"),
    text: z.string().describe("New text content")
  },
  async ({ nodeId, text }) => {
    try {
      const result = await sendCommandToFigma("set_text_content", {
        nodeId,
        text
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Updated text content of node "${typedResult.name}" to "${text}"`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting text content: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "get_styles",
  "Get all styles from the current Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_styles");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting styles: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "get_local_components",
  "Get all local components from the Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_local_components");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting local components: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "get_annotations",
  "Get all annotations in the current document or specific node",
  {
    nodeId: z.string().describe("node ID to get annotations for specific node"),
    includeCategories: z.boolean().optional().default(true).describe("Whether to include category information")
  },
  async ({ nodeId, includeCategories }) => {
    try {
      const result = await sendCommandToFigma("get_annotations", {
        nodeId,
        includeCategories
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting annotations: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_annotation",
  "Create or update an annotation",
  {
    nodeId: z.string().describe("The ID of the node to annotate"),
    annotationId: z.string().optional().describe(
      "The ID of the annotation to update (if updating existing annotation)"
    ),
    labelMarkdown: z.string().describe("The annotation text in markdown format"),
    categoryId: z.string().optional().describe("The ID of the annotation category"),
    properties: z.array(
      z.object({
        type: z.string()
      })
    ).optional().describe("Additional properties for the annotation")
  },
  async ({
    nodeId,
    annotationId,
    labelMarkdown,
    categoryId,
    properties
  }) => {
    try {
      const result = await sendCommandToFigma("set_annotation", {
        nodeId,
        annotationId,
        labelMarkdown,
        categoryId,
        properties
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting annotation: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_multiple_annotations",
  "Set multiple annotations parallelly in a node",
  {
    nodeId: z.string().describe("The ID of the node containing the elements to annotate"),
    annotations: z.array(
      z.object({
        nodeId: z.string().describe("The ID of the node to annotate"),
        labelMarkdown: z.string().describe("The annotation text in markdown format"),
        categoryId: z.string().optional().describe("The ID of the annotation category"),
        annotationId: z.string().optional().describe(
          "The ID of the annotation to update (if updating existing annotation)"
        ),
        properties: z.array(
          z.object({
            type: z.string()
          })
        ).optional().describe("Additional properties for the annotation")
      })
    ).describe("Array of annotations to apply")
  },
  async ({ nodeId, annotations }) => {
    try {
      if (!annotations || annotations.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No annotations provided"
            }
          ]
        };
      }
      const initialStatus = {
        type: "text",
        text: `Starting annotation process for ${annotations.length} nodes. This will be processed in batches of 5...`
      };
      let totalProcessed = 0;
      const totalToProcess = annotations.length;
      const result = await sendCommandToFigma("set_multiple_annotations", {
        nodeId,
        annotations
      });
      const typedResult = result;
      const success = typedResult.annotationsApplied && typedResult.annotationsApplied > 0;
      const progressText = `
      Annotation process completed:
      - ${typedResult.annotationsApplied || 0} of ${totalToProcess} successfully applied
      - ${typedResult.annotationsFailed || 0} failed
      - Processed in ${typedResult.completedInChunks || 1} batches
      `;
      const detailedResults = typedResult.results || [];
      const failedResults = detailedResults.filter((item) => !item.success);
      let detailedResponse = "";
      if (failedResults.length > 0) {
        detailedResponse = `

Nodes that failed:
${failedResults.map((item) => `- ${item.nodeId}: ${item.error || "Unknown error"}`).join("\n")}`;
      }
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: progressText + detailedResponse
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting multiple annotations: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "create_component_instance",
  "Create an instance of a component in Figma. For LOCAL components (from get_local_components), use componentId with the id field. For published LIBRARY components, use componentKey with the publishedKey field.",
  {
    componentId: z.string().optional().describe(
      "ID of a local component (use the id field from get_local_components result). Use this for unpublished/local components."
    ),
    componentKey: z.string().optional().describe(
      "Key of a published library component to instantiate (use the publishedKey field from get_local_components result). Only works for published components."
    ),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    parentId: z.string().optional().describe("Optional parent node ID to place the instance into")
  },
  async ({ componentId, componentKey, x, y, parentId }) => {
    try {
      const result = await sendCommandToFigma("create_component_instance", {
        componentId,
        componentKey,
        x,
        y,
        parentId
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(typedResult)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating component instance: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "get_instance_overrides",
  "Get all override properties from a selected component instance. These overrides can be applied to other instances, which will swap them to match the source component.",
  {
    nodeId: z.string().optional().describe(
      "Optional ID of the component instance to get overrides from. If not provided, currently selected instance will be used."
    )
  },
  async ({ nodeId }) => {
    try {
      const result = await sendCommandToFigma("get_instance_overrides", {
        instanceNodeId: nodeId || null
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: typedResult.success ? `Successfully got instance overrides: ${typedResult.message}` : `Failed to get instance overrides: ${typedResult.message}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error copying instance overrides: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_instance_overrides",
  "Apply previously copied overrides to selected component instances. Target instances will be swapped to the source component and all copied override properties will be applied.",
  {
    sourceInstanceId: z.string().describe("ID of the source component instance"),
    targetNodeIds: z.array(z.string()).describe(
      "Array of target instance IDs. Currently selected instances will be used."
    )
  },
  async ({ sourceInstanceId, targetNodeIds }) => {
    try {
      const result = await sendCommandToFigma("set_instance_overrides", {
        sourceInstanceId,
        targetNodeIds: targetNodeIds || []
      });
      const typedResult = result;
      if (typedResult.success) {
        const successCount = typedResult.results?.filter((r) => r.success).length || 0;
        return {
          content: [
            {
              type: "text",
              text: `Successfully applied ${typedResult.totalCount || 0} overrides to ${successCount} instances.`
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Failed to set instance overrides: ${typedResult.message}`
            }
          ]
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting instance overrides: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_corner_radius",
  "Set the corner radius of a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    radius: z.number().min(0).describe("Corner radius value"),
    corners: z.array(z.boolean()).length(4).optional().describe(
      "Optional array of 4 booleans to specify which corners to round [topLeft, topRight, bottomRight, bottomLeft]"
    )
  },
  async ({ nodeId, radius, corners }) => {
    try {
      const result = await sendCommandToFigma("set_corner_radius", {
        nodeId,
        radius,
        corners: corners || [true, true, true, true]
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Set corner radius of node "${typedResult.name}" to ${radius}px`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting corner radius: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.prompt(
  "design_strategy",
  "Best practices for working with Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When working with Figma designs, follow these best practices:

1. Start with Document Structure:
   - First use get_document_info() to understand the current document
   - Plan your layout hierarchy before creating elements
   - Create a main container frame for each screen/section

2. Naming Conventions:
   - Use descriptive, semantic names for all elements
   - Follow a consistent naming pattern (e.g., "Login Screen", "Logo Container", "Email Input")
   - Group related elements with meaningful names

3. Layout Hierarchy:
   - Create parent frames first, then add child elements
   - For forms/login screens:
     * Start with the main screen container frame
     * Create a logo container at the top
     * Group input fields in their own containers
     * Place action buttons (login, submit) after inputs
     * Add secondary elements (forgot password, signup links) last

4. Input Fields Structure:
   - Create a container frame for each input field
   - Include a label text above or inside the input
   - Group related inputs (e.g., username/password) together

5. Element Creation:
   - Use create_frame() for containers and input fields
   - Use create_text() for labels, buttons text, and links
   - Set appropriate colors and styles:
     * Use fillColor for backgrounds
     * Use strokeColor for borders
     * Set proper fontWeight for different text elements

6. Mofifying existing elements:
  - use set_text_content() to modify text content.

7. Visual Hierarchy:
   - Position elements in logical reading order (top to bottom)
   - Maintain consistent spacing between elements
   - Use appropriate font sizes for different text types:
     * Larger for headings/welcome text
     * Medium for input labels
     * Standard for button text
     * Smaller for helper text/links

8. Best Practices:
   - Verify each creation with get_node_info()
   - Use parentId to maintain proper hierarchy
   - Group related elements together in frames
   - Keep consistent spacing and alignment

Example Login Screen Structure:
- Login Screen (main frame)
  - Logo Container (frame)
    - Logo (image/text)
  - Welcome Text (text)
  - Input Container (frame)
    - Email Input (frame)
      - Email Label (text)
      - Email Field (frame)
    - Password Input (frame)
      - Password Label (text)
      - Password Field (frame)
  - Login Button (frame)
    - Button Text (text)
  - Helper Links (frame)
    - Forgot Password (text)
    - Don't have account (text)`
          }
        }
      ],
      description: "Best practices for working with Figma designs"
    };
  }
);
server.prompt(
  "read_design_strategy",
  "Best practices for reading Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When reading Figma designs, follow these best practices:

1. Start with selection:
   - First use read_my_design() to understand the current selection
   - If no selection ask user to select single or multiple nodes
`
          }
        }
      ],
      description: "Best practices for reading Figma designs"
    };
  }
);
server.tool(
  "scan_text_nodes",
  "Scan all text nodes in the selected Figma node",
  {
    nodeId: z.string().describe("ID of the node to scan")
  },
  async ({ nodeId }) => {
    try {
      const initialStatus = {
        type: "text",
        text: "Starting text node scanning. This may take a moment for large designs..."
      };
      const result = await sendCommandToFigma("scan_text_nodes", {
        nodeId,
        useChunking: true,
        // Enable chunking on the plugin side
        chunkSize: 10
        // Process 10 nodes at a time
      });
      if (result && typeof result === "object" && "chunks" in result) {
        const typedResult = result;
        const summaryText = `
        Scan completed:
        - Found ${typedResult.totalNodes} text nodes
        - Processed in ${typedResult.chunks} chunks
        `;
        return {
          content: [
            initialStatus,
            {
              type: "text",
              text: summaryText
            },
            {
              type: "text",
              text: JSON.stringify(typedResult.textNodes, null, 2)
            }
          ]
        };
      }
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error scanning text nodes: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "scan_nodes_by_types",
  "Scan for child nodes with specific types in the selected Figma node",
  {
    nodeId: z.string().describe("ID of the node to scan"),
    types: z.array(z.string()).describe(
      "Array of node types to find in the child nodes (e.g. ['COMPONENT', 'FRAME'])"
    )
  },
  async ({ nodeId, types }) => {
    try {
      const initialStatus = {
        type: "text",
        text: `Starting node type scanning for types: ${types.join(", ")}...`
      };
      const result = await sendCommandToFigma("scan_nodes_by_types", {
        nodeId,
        types
      });
      if (result && typeof result === "object" && "matchingNodes" in result) {
        const typedResult = result;
        const summaryText = `Scan completed: Found ${typedResult.count} nodes matching types: ${typedResult.searchedTypes.join(", ")}`;
        return {
          content: [
            initialStatus,
            {
              type: "text",
              text: summaryText
            },
            {
              type: "text",
              text: JSON.stringify(typedResult.matchingNodes, null, 2)
            }
          ]
        };
      }
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error scanning nodes by types: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.prompt(
  "text_replacement_strategy",
  "Systematic approach for replacing text in Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Intelligent Text Replacement Strategy

## 1. Analyze Design & Identify Structure
- Scan text nodes to understand the overall structure of the design
- Use AI pattern recognition to identify logical groupings:
  * Tables (rows, columns, headers, cells)
  * Lists (items, headers, nested lists)
  * Card groups (similar cards with recurring text fields)
  * Forms (labels, input fields, validation text)
  * Navigation (menu items, breadcrumbs)
\`\`\`
scan_text_nodes(nodeId: "node-id")
get_node_info(nodeId: "node-id")  // optional
\`\`\`

## 2. Strategic Chunking for Complex Designs
- Divide replacement tasks into logical content chunks based on design structure
- Use one of these chunking strategies that best fits the design:
  * **Structural Chunking**: Table rows/columns, list sections, card groups
  * **Spatial Chunking**: Top-to-bottom, left-to-right in screen areas
  * **Semantic Chunking**: Content related to the same topic or functionality
  * **Component-Based Chunking**: Process similar component instances together

## 3. Progressive Replacement with Verification
- Create a safe copy of the node for text replacement
- Replace text chunk by chunk with continuous progress updates
- After each chunk is processed:
  * Export that section as a small, manageable image
  * Verify text fits properly and maintain design integrity
  * Fix issues before proceeding to the next chunk

\`\`\`
// Clone the node to create a safe copy
clone_node(nodeId: "selected-node-id", x: [new-x], y: [new-y])

// Replace text chunk by chunk
set_multiple_text_contents(
  nodeId: "parent-node-id", 
  text: [
    { nodeId: "node-id-1", text: "New text 1" },
    // More nodes in this chunk...
  ]
)

// Verify chunk with small, targeted image exports
export_node_as_image(nodeId: "chunk-node-id", format: "PNG", scale: 0.5)
\`\`\`

## 4. Intelligent Handling for Table Data
- For tabular content:
  * Process one row or column at a time
  * Maintain alignment and spacing between cells
  * Consider conditional formatting based on cell content
  * Preserve header/data relationships

## 5. Smart Text Adaptation
- Adaptively handle text based on container constraints:
  * Auto-detect space constraints and adjust text length
  * Apply line breaks at appropriate linguistic points
  * Maintain text hierarchy and emphasis
  * Consider font scaling for critical content that must fit

## 6. Progressive Feedback Loop
- Establish a continuous feedback loop during replacement:
  * Real-time progress updates (0-100%)
  * Small image exports after each chunk for verification
  * Issues identified early and resolved incrementally
  * Quick adjustments applied to subsequent chunks

## 7. Final Verification & Context-Aware QA
- After all chunks are processed:
  * Export the entire design at reduced scale for final verification
  * Check for cross-chunk consistency issues
  * Verify proper text flow between different sections
  * Ensure design harmony across the full composition

## 8. Chunk-Specific Export Scale Guidelines
- Scale exports appropriately based on chunk size:
  * Small chunks (1-5 elements): scale 1.0
  * Medium chunks (6-20 elements): scale 0.7
  * Large chunks (21-50 elements): scale 0.5
  * Very large chunks (50+ elements): scale 0.3
  * Full design verification: scale 0.2

## Sample Chunking Strategy for Common Design Types

### Tables
- Process by logical rows (5-10 rows per chunk)
- Alternative: Process by column for columnar analysis
- Tip: Always include header row in first chunk for reference

### Card Lists
- Group 3-5 similar cards per chunk
- Process entire cards to maintain internal consistency
- Verify text-to-image ratio within cards after each chunk

### Forms
- Group related fields (e.g., "Personal Information", "Payment Details")
- Process labels and input fields together
- Ensure validation messages and hints are updated with their fields

### Navigation & Menus
- Process hierarchical levels together (main menu, submenu)
- Respect information architecture relationships
- Verify menu fit and alignment after replacement

## Best Practices
- **Preserve Design Intent**: Always prioritize design integrity
- **Structural Consistency**: Maintain alignment, spacing, and hierarchy
- **Visual Feedback**: Verify each chunk visually before proceeding
- **Incremental Improvement**: Learn from each chunk to improve subsequent ones
- **Balance Automation & Control**: Let AI handle repetitive replacements but maintain oversight
- **Respect Content Relationships**: Keep related content consistent across chunks

Remember that text is never just text\u2014it's a core design element that must work harmoniously with the overall composition. This chunk-based strategy allows you to methodically transform text while maintaining design integrity.`
          }
        }
      ],
      description: "Systematic approach for replacing text in Figma designs"
    };
  }
);
server.tool(
  "set_multiple_text_contents",
  "Set multiple text contents parallelly in a node",
  {
    nodeId: z.string().describe("The ID of the node containing the text nodes to replace"),
    text: z.array(
      z.object({
        nodeId: z.string().describe("The ID of the text node"),
        text: z.string().describe("The replacement text")
      })
    ).describe("Array of text node IDs and their replacement texts")
  },
  async ({ nodeId, text }) => {
    try {
      if (!text || text.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No text provided"
            }
          ]
        };
      }
      const initialStatus = {
        type: "text",
        text: `Starting text replacement for ${text.length} nodes. This will be processed in batches of 5...`
      };
      let totalProcessed = 0;
      const totalToProcess = text.length;
      const result = await sendCommandToFigma("set_multiple_text_contents", {
        nodeId,
        text
      });
      const typedResult = result;
      const success = typedResult.replacementsApplied && typedResult.replacementsApplied > 0;
      const progressText = `
      Text replacement completed:
      - ${typedResult.replacementsApplied || 0} of ${totalToProcess} successfully updated
      - ${typedResult.replacementsFailed || 0} failed
      - Processed in ${typedResult.completedInChunks || 1} batches
      `;
      const detailedResults = typedResult.results || [];
      const failedResults = detailedResults.filter((item) => !item.success);
      let detailedResponse = "";
      if (failedResults.length > 0) {
        detailedResponse = `

Nodes that failed:
${failedResults.map((item) => `- ${item.nodeId}: ${item.error || "Unknown error"}`).join("\n")}`;
      }
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: progressText + detailedResponse
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting multiple text contents: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.prompt(
  "annotation_conversion_strategy",
  "Strategy for converting manual annotations to Figma's native annotations",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Automatic Annotation Conversion
            
## Process Overview

The process of converting manual annotations (numbered/alphabetical indicators with connected descriptions) to Figma's native annotations:

1. Get selected frame/component information
2. Scan and collect all annotation text nodes
3. Scan target UI elements (components, instances, frames)
4. Match annotations to appropriate UI elements
5. Apply native Figma annotations

## Step 1: Get Selection and Initial Setup

First, get the selected frame or component that contains annotations:

\`\`\`typescript
// Get the selected frame/component
const selection = await get_selection();
const selectedNodeId = selection[0].id

// Get available annotation categories for later use
const annotationData = await get_annotations({
  nodeId: selectedNodeId,
  includeCategories: true
});
const categories = annotationData.categories;
\`\`\`

## Step 2: Scan Annotation Text Nodes

Scan all text nodes to identify annotations and their descriptions:

\`\`\`typescript
// Get all text nodes in the selection
const textNodes = await scan_text_nodes({
  nodeId: selectedNodeId
});

// Filter and group annotation markers and descriptions

// Markers typically have these characteristics:
// - Short text content (usually single digit/letter)
// - Specific font styles (often bold)
// - Located in a container with "Marker" or "Dot" in the name
// - Have a clear naming pattern (e.g., "1", "2", "3" or "A", "B", "C")


// Identify description nodes
// Usually longer text nodes near markers or with matching numbers in path
  
\`\`\`

## Step 3: Scan Target UI Elements

Get all potential target elements that annotations might refer to:

\`\`\`typescript
// Scan for all UI elements that could be annotation targets
const targetNodes = await scan_nodes_by_types({
  nodeId: selectedNodeId,
  types: [
    "COMPONENT",
    "INSTANCE",
    "FRAME"
  ]
});
\`\`\`

## Step 4: Match Annotations to Targets

Match each annotation to its target UI element using these strategies in order of priority:

1. **Path-Based Matching**:
   - Look at the marker's parent container name in the Figma layer hierarchy
   - Remove any "Marker:" or "Annotation:" prefixes from the parent name
   - Find UI elements that share the same parent name or have it in their path
   - This works well when markers are grouped with their target elements

2. **Name-Based Matching**:
   - Extract key terms from the annotation description
   - Look for UI elements whose names contain these key terms
   - Consider both exact matches and semantic similarities
   - Particularly effective for form fields, buttons, and labeled components

3. **Proximity-Based Matching** (fallback):
   - Calculate the center point of the marker
   - Find the closest UI element by measuring distances to element centers
   - Consider the marker's position relative to nearby elements
   - Use this method when other matching strategies fail

Additional Matching Considerations:
- Give higher priority to matches found through path-based matching
- Consider the type of UI element when evaluating matches
- Take into account the annotation's context and content
- Use a combination of strategies for more accurate matching

## Step 5: Apply Native Annotations

Convert matched annotations to Figma's native annotations using batch processing:

\`\`\`typescript
// Prepare annotations array for batch processing
const annotationsToApply = Object.values(annotations).map(({ marker, description }) => {
  // Find target using multiple strategies
  const target = 
    findTargetByPath(marker, targetNodes) ||
    findTargetByName(description, targetNodes) ||
    findTargetByProximity(marker, targetNodes);
  
  if (target) {
    // Determine appropriate category based on content
    const category = determineCategory(description.characters, categories);

    // Determine appropriate additional annotationProperty based on content
    const annotationProperty = determineProperties(description.characters, target.type);
    
    return {
      nodeId: target.id,
      labelMarkdown: description.characters,
      categoryId: category.id,
      properties: annotationProperty
    };
  }
  return null;
}).filter(Boolean); // Remove null entries

// Apply annotations in batches using set_multiple_annotations
if (annotationsToApply.length > 0) {
  await set_multiple_annotations({
    nodeId: selectedNodeId,
    annotations: annotationsToApply
  });
}
\`\`\`


This strategy focuses on practical implementation based on real-world usage patterns, emphasizing the importance of handling various UI elements as annotation targets, not just text nodes.`
          }
        }
      ],
      description: "Strategy for converting manual annotations to Figma's native annotations"
    };
  }
);
server.prompt(
  "swap_overrides_instances",
  "Guide to swap instance overrides between instances",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Swap Component Instance and Override Strategy

## Overview
This strategy enables transferring content and property overrides from a source instance to one or more target instances in Figma, maintaining design consistency while reducing manual work.

## Step-by-Step Process

### 1. Selection Analysis
- Use \`get_selection()\` to identify the parent component or selected instances
- For parent components, scan for instances with \`scan_nodes_by_types({ nodeId: "parent-id", types: ["INSTANCE"] })\`
- Identify custom slots by name patterns (e.g. "Custom Slot*" or "Instance Slot") or by examining text content
- Determine which is the source instance (with content to copy) and which are targets (where to apply content)

### 2. Extract Source Overrides
- Use \`get_instance_overrides()\` to extract customizations from the source instance
- This captures text content, property values, and style overrides
- Command syntax: \`get_instance_overrides({ nodeId: "source-instance-id" })\`
- Look for successful response like "Got component information from [instance name]"

### 3. Apply Overrides to Targets
- Apply captured overrides using \`set_instance_overrides()\`
- Command syntax:
  \`\`\`
  set_instance_overrides({
    sourceInstanceId: "source-instance-id", 
    targetNodeIds: ["target-id-1", "target-id-2", ...]
  })
  \`\`\`

### 4. Verification
- Verify results with \`get_node_info()\` or \`read_my_design()\`
- Confirm text content and style overrides have transferred successfully

## Key Tips
- Always join the appropriate channel first with \`join_channel()\`
- When working with multiple targets, check the full selection with \`get_selection()\`
- Preserve component relationships by using instance overrides rather than direct text manipulation`
          }
        }
      ],
      description: "Strategy for transferring overrides between component instances in Figma"
    };
  }
);
var gridTrackSizesSchema = z.array(
  z.object({
    type: z.enum(["FLEX", "FIXED", "HUG"]).describe("FLEX = fr unit, FIXED = pixels, HUG = fit content"),
    value: z.number().positive().optional().describe("Pixels for FIXED (required), fr value for FLEX (optional)")
  })
).min(1);
server.tool(
  "set_layout_mode",
  "Set the layout mode and wrap behavior of a frame in Figma. HORIZONTAL/VERTICAL = flex auto-layout (optionally WRAP + counterAxisAlignContent); GRID = grid auto-layout with row/column count, gaps and track sizes. Position grid children with set_layout_child.",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"]).describe("Layout mode for the frame"),
    layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe(
      "Whether the auto-layout frame wraps its children (HORIZONTAL/VERTICAL only)"
    ),
    counterAxisAlignContent: z.enum(["AUTO", "SPACE_BETWEEN"]).optional().describe(
      "How wrapped tracks are spaced (requires layoutWrap WRAP), like CSS align-content"
    ),
    strokesIncludedInLayout: z.boolean().optional().describe("Whether strokes count toward layout size (like border-box)"),
    gridRowCount: z.number().int().min(1).optional().describe("GRID only: number of rows"),
    gridColumnCount: z.number().int().min(1).optional().describe("GRID only: number of columns"),
    gridRowGap: z.number().min(0).optional().describe("GRID only: row gap in pixels"),
    gridColumnGap: z.number().min(0).optional().describe("GRID only: column gap in pixels"),
    gridRowSizes: gridTrackSizesSchema.optional().describe(
      "GRID only: size per row, top to bottom; its length sets the row count when gridRowCount is omitted"
    ),
    gridColumnSizes: gridTrackSizesSchema.optional().describe(
      "GRID only: size per column, left to right; its length sets the column count when gridColumnCount is omitted"
    ),
    gridAutoTracks: z.enum(["NONE", "ROWS"]).optional().describe(
      "GRID only: ROWS adds/removes rows automatically as children change (then gridRowCount/gridRowSizes cannot be set); NONE = fixed row count"
    )
  },
  async ({ nodeId, layoutMode, layoutWrap, ...rest }) => {
    try {
      const result = await sendCommandToFigma("set_layout_mode", {
        nodeId,
        layoutMode,
        layoutWrap: layoutWrap || "NO_WRAP",
        ...rest
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Set layout mode of frame "${typedResult.name}" to ${layoutMode}${layoutWrap ? ` with ${layoutWrap}` : ""}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting layout mode: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_padding",
  "Set padding values for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    paddingTop: z.number().optional().describe("Top padding value"),
    paddingRight: z.number().optional().describe("Right padding value"),
    paddingBottom: z.number().optional().describe("Bottom padding value"),
    paddingLeft: z.number().optional().describe("Left padding value")
  },
  async ({
    nodeId,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft
  }) => {
    try {
      const result = await sendCommandToFigma("set_padding", {
        nodeId,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft
      });
      const typedResult = result;
      const paddingMessages = [];
      if (paddingTop !== void 0) paddingMessages.push(`top: ${paddingTop}`);
      if (paddingRight !== void 0)
        paddingMessages.push(`right: ${paddingRight}`);
      if (paddingBottom !== void 0)
        paddingMessages.push(`bottom: ${paddingBottom}`);
      if (paddingLeft !== void 0)
        paddingMessages.push(`left: ${paddingLeft}`);
      const paddingText = paddingMessages.length > 0 ? `padding (${paddingMessages.join(", ")})` : "padding";
      return {
        content: [
          {
            type: "text",
            text: `Set ${paddingText} for frame "${typedResult.name}"`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting padding: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_axis_align",
  "Set primary and counter axis alignment for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    primaryAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"]).optional().describe(
      "Primary axis alignment (MIN/MAX = left/right in horizontal, top/bottom in vertical). Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."
    ),
    counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe(
      "Counter axis alignment (MIN/MAX = top/bottom in horizontal, left/right in vertical)"
    )
  },
  async ({ nodeId, primaryAxisAlignItems, counterAxisAlignItems }) => {
    try {
      const result = await sendCommandToFigma("set_axis_align", {
        nodeId,
        primaryAxisAlignItems,
        counterAxisAlignItems
      });
      const typedResult = result;
      const alignMessages = [];
      if (primaryAxisAlignItems !== void 0)
        alignMessages.push(`primary: ${primaryAxisAlignItems}`);
      if (counterAxisAlignItems !== void 0)
        alignMessages.push(`counter: ${counterAxisAlignItems}`);
      const alignText = alignMessages.length > 0 ? `axis alignment (${alignMessages.join(", ")})` : "axis alignment";
      return {
        content: [
          {
            type: "text",
            text: `Set ${alignText} for frame "${typedResult.name}"`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting axis alignment: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_layout_sizing",
  "Set horizontal and vertical sizing modes for a frame, component, component set, instance or text node in Figma",
  {
    nodeId: z.string().describe(
      "The ID of the frame, component, component set, instance or text node to modify"
    ),
    layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe(
      "Horizontal sizing mode (HUG for auto-layout frames/components/instances and text, FILL for auto-layout children only)"
    ),
    layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe(
      "Vertical sizing mode (HUG for auto-layout frames/components/instances and text, FILL for auto-layout children only)"
    )
  },
  async ({ nodeId, layoutSizingHorizontal, layoutSizingVertical }) => {
    try {
      const result = await sendCommandToFigma("set_layout_sizing", {
        nodeId,
        layoutSizingHorizontal,
        layoutSizingVertical
      });
      const typedResult = result;
      const sizingMessages = [];
      if (layoutSizingHorizontal !== void 0)
        sizingMessages.push(`horizontal: ${layoutSizingHorizontal}`);
      if (layoutSizingVertical !== void 0)
        sizingMessages.push(`vertical: ${layoutSizingVertical}`);
      const sizingText = sizingMessages.length > 0 ? `layout sizing (${sizingMessages.join(", ")})` : "layout sizing";
      return {
        content: [
          {
            type: "text",
            text: `Set ${sizingText} for frame "${typedResult.name}"`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting layout sizing: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_item_spacing",
  "Set distance between children in an auto-layout frame",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    itemSpacing: z.number().optional().describe(
      "Distance between children. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN."
    ),
    counterAxisSpacing: z.number().optional().describe(
      "Distance between wrapped rows/columns. Only works when layoutWrap is set to WRAP."
    )
  },
  async ({ nodeId, itemSpacing, counterAxisSpacing }) => {
    try {
      const params = { nodeId };
      if (itemSpacing !== void 0) params.itemSpacing = itemSpacing;
      if (counterAxisSpacing !== void 0)
        params.counterAxisSpacing = counterAxisSpacing;
      const result = await sendCommandToFigma("set_item_spacing", params);
      const typedResult = result;
      let message = `Updated spacing for frame "${typedResult.name}":`;
      if (itemSpacing !== void 0) message += ` itemSpacing=${itemSpacing}`;
      if (counterAxisSpacing !== void 0)
        message += ` counterAxisSpacing=${counterAxisSpacing}`;
      return {
        content: [
          {
            type: "text",
            text: message
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting spacing: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "get_reactions",
  "Get Figma Prototyping Reactions from multiple nodes. CRITICAL: The output MUST be processed using the 'reaction_to_connector_strategy' prompt IMMEDIATELY to generate parameters for connector lines via the 'create_connections' tool.",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to get reactions from")
  },
  async ({ nodeIds }) => {
    try {
      const result = await sendCommandToFigma("get_reactions", { nodeIds });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          },
          {
            type: "text",
            text: "IMPORTANT: You MUST now use the reaction data above and follow the `reaction_to_connector_strategy` prompt to prepare the parameters for the `create_connections` tool call. This is a required next step."
          }
        ],
        followUp: {
          type: "prompt",
          prompt: "reaction_to_connector_strategy"
        }
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting reactions: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_default_connector",
  "Set a copied connector node as the default connector",
  {
    connectorId: z.string().optional().describe("The ID of the connector node to set as default")
  },
  async ({ connectorId }) => {
    try {
      const result = await sendCommandToFigma("set_default_connector", {
        connectorId
      });
      return {
        content: [
          {
            type: "text",
            text: `Default connector set: ${JSON.stringify(result)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting default connector: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "create_connections",
  "Create connections between nodes using the default connector style",
  {
    connections: z.array(
      z.object({
        startNodeId: z.string().describe("ID of the starting node"),
        endNodeId: z.string().describe("ID of the ending node"),
        text: z.string().optional().describe("Optional text to display on the connector")
      })
    ).describe("Array of node connections to create")
  },
  async ({ connections }) => {
    try {
      if (!connections || connections.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No connections provided"
            }
          ]
        };
      }
      const result = await sendCommandToFigma("create_connections", {
        connections
      });
      return {
        content: [
          {
            type: "text",
            text: `Created ${connections.length} connections: ${JSON.stringify(result)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating connections: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_focus",
  "Set focus on a specific node in Figma by selecting it and scrolling viewport to it",
  {
    nodeId: z.string().describe("The ID of the node to focus on")
  },
  async ({ nodeId }) => {
    try {
      const result = await sendCommandToFigma("set_focus", { nodeId });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Focused on node "${typedResult.name}" (ID: ${typedResult.id})`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting focus: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_selections",
  "Set selection to multiple nodes in Figma and scroll viewport to show them",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to select")
  },
  async ({ nodeIds }) => {
    try {
      const result = await sendCommandToFigma("set_selections", { nodeIds });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Selected ${typedResult.count} nodes: ${typedResult.selectedNodes.map((node) => `"${node.name}" (${node.id})`).join(", ")}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting selections: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.prompt(
  "reaction_to_connector_strategy",
  "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Strategy: Convert Figma Prototype Reactions to Connector Lines

## Goal
Process the JSON output from the \`get_reactions\` tool to generate an array of connection objects suitable for the \`create_connections\` tool. This visually represents prototype flows as connector lines on the Figma canvas.

## Input Data
You will receive JSON data from the \`get_reactions\` tool. This data contains an array of nodes, each with potential reactions. A typical reaction object looks like this:
\`\`\`json
{
  "trigger": { "type": "ON_CLICK" },
  "action": {
    "type": "NAVIGATE",
    "destinationId": "destination-node-id",
    "navigationTransition": { ... },
    "preserveScrollPosition": false
  }
}
\`\`\`

## Step-by-Step Process

### 1. Preparation & Context Gathering
   - **Action:** Call \`read_my_design\` on the relevant node(s) to get context about the nodes involved (names, types, etc.). This helps in generating meaningful connector labels later.
   - **Action:** Call \`set_default_connector\` **without** the \`connectorId\` parameter.
   - **Check Result:** Analyze the response from \`set_default_connector\`.
     - If it confirms a default connector is already set (e.g., "Default connector is already set"), proceed to Step 2.
     - If it indicates no default connector is set (e.g., "No default connector set..."), you **cannot** proceed with \`create_connections\` yet. Inform the user they need to manually copy a connector from FigJam, paste it onto the current page, select it, and then you can run \`set_default_connector({ connectorId: "SELECTED_NODE_ID" })\` before attempting \`create_connections\`. **Do not proceed to Step 2 until a default connector is confirmed.**

### 2. Filter and Transform Reactions from \`get_reactions\` Output
   - **Iterate:** Go through the JSON array provided by \`get_reactions\`. For each node in the array:
     - Iterate through its \`reactions\` array.
   - **Filter:** Keep only reactions where the \`action\` meets these criteria:
     - Has a \`type\` that implies a connection (e.g., \`NAVIGATE\`, \`OPEN_OVERLAY\`, \`SWAP_OVERLAY\`). **Ignore** types like \`CHANGE_TO\`, \`CLOSE_OVERLAY\`, etc.
     - Has a valid \`destinationId\` property.
   - **Extract:** For each valid reaction, extract the following information:
     - \`sourceNodeId\`: The ID of the node the reaction belongs to (from the outer loop).
     - \`destinationNodeId\`: The value of \`action.destinationId\`.
     - \`actionType\`: The value of \`action.type\`.
     - \`triggerType\`: The value of \`trigger.type\`.

### 3. Generate Connector Text Labels
   - **For each extracted connection:** Create a concise, descriptive text label string.
   - **Combine Information:** Use the \`actionType\`, \`triggerType\`, and potentially the names of the source/destination nodes (obtained from Step 1's \`read_my_design\` or by calling \`get_node_info\` if necessary) to generate the label.
   - **Example Labels:**
     - If \`triggerType\` is "ON_CLICK" and \`actionType\` is "NAVIGATE": "On click, navigate to [Destination Node Name]"
     - If \`triggerType\` is "ON_DRAG" and \`actionType\` is "OPEN_OVERLAY": "On drag, open [Destination Node Name] overlay"
   - **Keep it brief and informative.** Let this generated string be \`generatedText\`.

### 4. Prepare the \`connections\` Array for \`create_connections\`
   - **Structure:** Create a JSON array where each element is an object representing a connection.
   - **Format:** Each object in the array must have the following structure:
     \`\`\`json
     {
       "startNodeId": "sourceNodeId_from_step_2",
       "endNodeId": "destinationNodeId_from_step_2",
       "text": "generatedText_from_step_3"
     }
     \`\`\`
   - **Result:** This final array is the value you will pass to the \`connections\` parameter when calling the \`create_connections\` tool.

### 5. Execute Connection Creation
   - **Action:** Call the \`create_connections\` tool, passing the array generated in Step 4 as the \`connections\` argument.
   - **Verify:** Check the response from \`create_connections\` to confirm success or failure.

This detailed process ensures you correctly interpret the reaction data, prepare the necessary information, and use the appropriate tools to create the connector lines.`
          }
        }
      ],
      description: "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'"
    };
  }
);
var CODE_BLOCK_LANGUAGES = [
  "TYPESCRIPT",
  "CPP",
  "RUBY",
  "CSS",
  "JAVASCRIPT",
  "HTML",
  "JSON",
  "GRAPHQL",
  "PYTHON",
  "GO",
  "SQL",
  "SWIFT",
  "KOTLIN",
  "RUST",
  "BASH",
  "PLAINTEXT",
  "DART"
];
var ANNOTATION_CATEGORY_COLORS = [
  "yellow",
  "orange",
  "red",
  "pink",
  "violet",
  "blue",
  "teal",
  "green"
];
function connectToFigma(port = 3055) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info("Already connected to Figma");
    return;
  }
  const wsUrl = serverUrl === "localhost" ? `${WS_URL}:${port}` : WS_URL;
  logger.info(`Connecting to Figma socket server at ${wsUrl}...`);
  ws = new WebSocket(wsUrl);
  ws.on("open", () => {
    logger.info("Connected to Figma socket server");
    currentChannel = null;
    if (lastJoinedChannel) {
      const channel = lastJoinedChannel;
      joinChannel(channel).catch(() => {
      });
    }
  });
  ws.on("message", (data) => {
    try {
      const json = JSON.parse(data);
      if (json.type === "progress_update") {
        const progressData = json.message.data;
        const requestId = json.id || "";
        if (requestId && pendingRequests.has(requestId)) {
          const request = pendingRequests.get(requestId);
          request.lastActivity = Date.now();
          clearTimeout(request.timeout);
          request.timeout = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              logger.error(
                `Request ${requestId} timed out after extended period of inactivity`
              );
              pendingRequests.delete(requestId);
              request.reject(new Error("Request to Figma timed out"));
            }
          }, 6e4);
          logger.info(
            `Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`
          );
          if (progressData.status === "completed" && progressData.progress === 100) {
            logger.info(
              `Operation ${progressData.commandType} completed, waiting for final result`
            );
          }
        }
        return;
      }
      const myResponse = json.message;
      logger.debug(`Received message: ${JSON.stringify(myResponse)}`);
      logger.log("myResponse" + JSON.stringify(myResponse));
      if (myResponse.id && pendingRequests.has(myResponse.id) && myResponse.result) {
        const request = pendingRequests.get(myResponse.id);
        clearTimeout(request.timeout);
        if (myResponse.error) {
          logger.error(`Error from Figma: ${myResponse.error}`);
          request.reject(new Error(myResponse.error));
        } else {
          if (myResponse.result) {
            request.resolve(myResponse.result);
          }
        }
        pendingRequests.delete(myResponse.id);
      } else {
        logger.info(
          `Received broadcast message: ${JSON.stringify(myResponse)}`
        );
      }
    } catch (error) {
      logger.error(
        `Error parsing message: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
  ws.on("error", (error) => {
    logger.error(`Socket error: ${error}`);
  });
  ws.on("close", () => {
    logger.info("Disconnected from Figma socket server");
    ws = null;
    for (const [id, request] of pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Connection closed"));
      pendingRequests.delete(id);
    }
    if (shuttingDown) return;
    logger.info("Attempting to reconnect in 2 seconds...");
    reconnectTimer = setTimeout(() => connectToFigma(port), 2e3);
  });
}
var shuttingDown = false;
var reconnectTimer = null;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Shutting down (${reason})`);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  for (const [id, request] of pendingRequests.entries()) {
    clearTimeout(request.timeout);
    request.reject(new Error("Server shutting down"));
    pendingRequests.delete(id);
  }
  try {
    ws?.close();
  } catch {
  }
  server.close().catch(() => {
  }).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 1e3).unref();
}
async function joinChannel(channelName) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected to Figma");
  }
  try {
    await sendCommandToFigma("join", { channel: channelName });
    currentChannel = channelName;
    lastJoinedChannel = channelName;
    logger.info(`Joined channel: ${channelName}`);
  } catch (error) {
    logger.error(
      `Failed to join channel: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}
function sendCommandToFigma(command, params = {}, timeoutMs = 3e4) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToFigma();
      reject(new Error("Not connected to Figma. Attempting to connect..."));
      return;
    }
    const requiresChannel = command !== "join";
    if (requiresChannel && !currentChannel) {
      reject(new Error("Must join a channel before sending commands"));
      return;
    }
    const id = uuidv4();
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      ...command === "join" ? { channel: params.channel } : { channel: currentChannel },
      message: {
        id,
        command,
        params: {
          ...params,
          commandId: id
          // Include the command ID in params
        }
      }
    };
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error(
          `Request ${id} to Figma timed out after ${timeoutMs / 1e3} seconds`
        );
        reject(new Error("Request to Figma timed out"));
      }
    }, timeoutMs);
    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      lastActivity: Date.now()
    });
    logger.info(`Sending command to Figma: ${command}`);
    logger.debug(`Request details: ${JSON.stringify(request)}`);
    ws.send(JSON.stringify(request));
  });
}
var imageFilterValue = z.number().min(-1).max(1);
var imagePaintOptionsShape = {
  imageTransform: z.tuple([
    z.tuple([z.number(), z.number(), z.number()]),
    z.tuple([z.number(), z.number(), z.number()])
  ]).optional().describe(
    "CROP only: 2x3 affine matrix [[a, b, tx], [c, d, ty]] mapping the layer onto the image (normalized 0-1 image space). E.g. [[0.5, 0, 0.25], [0, 0.5, 0.25]] shows the center half. Defaults to identity [[1,0,0],[0,1,0]] when CROP is used without it"
  ),
  scalingFactor: z.number().positive().optional().describe("TILE only: image scale for tiling (e.g. 0.5 = half size)"),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe("FILL/FIT/TILE only: image rotation in degrees (CROP rotates via imageTransform)"),
  filters: z.object({
    exposure: imageFilterValue.optional(),
    contrast: imageFilterValue.optional(),
    saturation: imageFilterValue.optional(),
    temperature: imageFilterValue.optional(),
    tint: imageFilterValue.optional(),
    highlights: imageFilterValue.optional(),
    shadows: imageFilterValue.optional()
  }).strict().optional().describe("Image adjustments, each -1 to 1 (0 = unchanged)")
};
function checkImagePaintOptions(scaleMode, params) {
  if (params.imageTransform !== void 0 && scaleMode !== "CROP") {
    throw new Error("imageTransform only applies to scaleMode CROP");
  }
  if (params.scalingFactor !== void 0 && scaleMode !== "TILE") {
    throw new Error("scalingFactor only applies to scaleMode TILE");
  }
  if (params.rotation !== void 0 && scaleMode === "CROP") {
    throw new Error(
      "rotation does not apply to scaleMode CROP (rotate via imageTransform)"
    );
  }
}
server.tool(
  "set_image_fill",
  "Fill a node in Figma with an image from a local file path, a URL, or base64 data (replaces the node's existing fills). Optional imageTransform (CROP), scalingFactor (TILE), rotation and filters adjust the image; use set_image_properties to change them later without re-uploading.",
  {
    nodeId: z.string().describe("The ID of the node to fill"),
    imagePath: z.string().optional().describe(
      "Absolute path to a local image file, read by the MCP server (preferred: keeps image bytes out of the model context)"
    ),
    imageUrl: z.string().optional().describe(
      "Image URL, fetched by the MCP server (the Figma plugin cannot fetch arbitrary domains itself)"
    ),
    imageBase64: z.string().optional().describe(
      "Base64-encoded image data, with or without a data: URI prefix (only when the image exists nowhere else)"
    ),
    scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional().describe("How the image fills the node (default: FILL)"),
    ...imagePaintOptionsShape
  },
  async ({
    nodeId,
    imagePath,
    imageUrl,
    imageBase64,
    scaleMode,
    imageTransform,
    scalingFactor,
    rotation,
    filters
  }) => {
    try {
      const imageOptions = { imageTransform, scalingFactor, rotation, filters };
      checkImagePaintOptions(scaleMode || "FILL", imageOptions);
      const sources = [imagePath, imageUrl, imageBase64].filter(
        (source) => source !== void 0 && source !== ""
      );
      if (sources.length !== 1) {
        throw new Error(
          "Provide exactly one of imagePath, imageUrl or imageBase64"
        );
      }
      let base64Data;
      if (imagePath) {
        base64Data = (await readFile(imagePath)).toString("base64");
      } else if (imageUrl) {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch image URL (HTTP ${response.status})`
          );
        }
        base64Data = Buffer.from(await response.arrayBuffer()).toString(
          "base64"
        );
      } else {
        base64Data = imageBase64.replace(/^data:[^;,]+;base64,/, "");
      }
      if (base64Data.length > 12 * 1024 * 1024) {
        throw new Error(
          "Image is too large to send over the relay (~9MB binary max); downscale it first"
        );
      }
      const result = await sendCommandToFigma("set_image_fill", {
        nodeId,
        imageBase64: base64Data,
        scaleMode: scaleMode || "FILL",
        ...imageOptions
      });
      const typedResult = result;
      const sizeInfo = typedResult.imageWidth ? ` (${typedResult.imageWidth}x${typedResult.imageHeight})` : "";
      return {
        content: [
          {
            type: "text",
            text: `Set image fill of node "${typedResult.name}"${sizeInfo} with scale mode ${scaleMode || "FILL"}, imageHash: ${typedResult.imageHash}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting image fill: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "rename_node",
  "Rename a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to rename"),
    name: z.string().describe("The new name for the node")
  },
  async ({ nodeId, name }) => {
    try {
      const result = await sendCommandToFigma("rename_node", { nodeId, name });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Renamed node from "${typedResult.previousName}" to "${typedResult.name}"`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error renaming node: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "create_section",
  "Create a section in Figma to group related content on the canvas",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the section"),
    height: z.number().describe("Height of the section"),
    name: z.string().optional().describe("Optional name for the section")
  },
  async ({ x, y, width, height, name }) => {
    try {
      const result = await sendCommandToFigma("create_section", {
        x,
        y,
        width,
        height,
        name: name || "Section"
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Created section "${typedResult.name}" with ID: ${typedResult.id}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating section: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
server.tool(
  "set_parent",
  "Move a node into a new parent node (e.g. a section, frame or group). Preserves the node's absolute position unless x/y are provided",
  {
    nodeId: z.string().describe("The ID of the node to move"),
    parentId: z.string().describe(
      "The ID of the new parent node (must support children, e.g. a section, frame or group)"
    ),
    x: z.number().optional().describe("Optional X position relative to the new parent"),
    y: z.number().optional().describe("Optional Y position relative to the new parent"),
    index: z.number().optional().describe(
      "Optional child index to insert at (default: appended as last child)"
    )
  },
  async ({ nodeId, parentId, x, y, index }) => {
    try {
      const result = await sendCommandToFigma("set_parent", {
        nodeId,
        parentId,
        x,
        y,
        index
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Moved node "${typedResult.name}" into "${typedResult.parentName}" at (${typedResult.x}, ${typedResult.y})`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting parent: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
function jsonResult(result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result)
      }
    ]
  };
}
function errorResult(prefix, error) {
  return {
    content: [
      {
        type: "text",
        text: `${prefix}: ${error instanceof Error ? error.message : String(error)}`
      }
    ]
  };
}
var rgbaSchema = z.object({
  r: z.number().min(0).max(1).describe("Red component (0-1)"),
  g: z.number().min(0).max(1).describe("Green component (0-1)"),
  b: z.number().min(0).max(1).describe("Blue component (0-1)"),
  a: z.number().min(0).max(1).optional().describe("Alpha component (0-1, default 1)")
});
var variableValueSchema = z.union([
  rgbaSchema,
  z.object({
    aliasOf: z.string().describe("ID of another variable to alias")
  }),
  z.number(),
  z.string(),
  z.boolean()
]);
server.tool(
  "create_component_from_node",
  "Convert an existing node (e.g. a frame) into a Figma main Component. The node is replaced in place by the new component.",
  {
    nodeId: z.string().describe("The ID of the node to convert into a component"),
    name: z.string().optional().describe("Optional name for the new component")
  },
  async ({ nodeId, name }) => {
    try {
      const result = await sendCommandToFigma("create_component_from_node", {
        nodeId,
        name
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating component from node", error);
    }
  }
);
server.tool(
  "combine_as_variants",
  'Combine multiple main Components into a Component Set (variants). Each component name must use the variant format "Prop=Value, Prop2=Value" (e.g. "Type=Primary, Size=Large") so Figma can derive the variant properties. Variants are then laid out in a grid (max 4 columns, 24px gap, 24px padding) and the component set is resized to fit them (skipped if the set uses auto layout).',
  {
    componentIds: z.array(z.string()).min(1).describe("IDs of the COMPONENT nodes to combine"),
    name: z.string().optional().describe("Optional name for the component set"),
    parentId: z.string().optional().describe(
      "Optional parent node ID for the component set (default: parent of the first component, or current page)"
    )
  },
  async ({ componentIds, name, parentId }) => {
    try {
      const result = await sendCommandToFigma("combine_as_variants", {
        componentIds,
        name,
        parentId
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error combining components as variants", error);
    }
  }
);
server.tool(
  "add_component_property",
  "Add a component property (TEXT, BOOLEAN or INSTANCE_SWAP) to a COMPONENT or COMPONENT_SET. Optionally link it to a child node: TEXT controls the node's characters, BOOLEAN its visibility, INSTANCE_SWAP the main component of a nested instance.",
  {
    componentId: z.string().describe("ID of the COMPONENT or COMPONENT_SET"),
    name: z.string().describe("Property name"),
    type: z.enum(["TEXT", "BOOLEAN", "INSTANCE_SWAP"]).describe("Property type"),
    defaultValue: z.union([z.string(), z.boolean()]).describe(
      "Default value: string for TEXT, boolean for BOOLEAN, component ID for INSTANCE_SWAP"
    ),
    targetNodeId: z.string().optional().describe(
      "Optional child node ID to bind (TEXT node for TEXT, any node for BOOLEAN, INSTANCE node for INSTANCE_SWAP)"
    )
  },
  async ({ componentId, name, type, defaultValue, targetNodeId }) => {
    try {
      const result = await sendCommandToFigma("add_component_property", {
        componentId,
        name,
        type,
        defaultValue,
        targetNodeId
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error adding component property", error);
    }
  }
);
server.tool(
  "swap_instance",
  "Swap the main component of an instance, preserving overrides where possible",
  {
    instanceId: z.string().describe("ID of the INSTANCE node"),
    componentId: z.string().describe("ID of the new main COMPONENT")
  },
  async ({ instanceId, componentId }) => {
    try {
      const result = await sendCommandToFigma("swap_instance", {
        instanceId,
        componentId
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error swapping instance", error);
    }
  }
);
server.tool(
  "get_local_variables",
  "Get all local variable collections (with modes) and variables in the current document. Color values are returned as hex, aliases as { aliasOf }.",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_local_variables");
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting local variables", error);
    }
  }
);
server.tool(
  "create_variable_collection",
  "Create a local variable collection. The default mode is renamed to modes[0]; remaining modes are added (multiple modes may require a paid Figma plan).",
  {
    name: z.string().describe("Collection name"),
    modes: z.array(z.string()).optional().describe('Optional mode names, e.g. ["Light", "Dark"]')
  },
  async ({ name, modes }) => {
    try {
      const result = await sendCommandToFigma("create_variable_collection", {
        name,
        modes
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating variable collection", error);
    }
  }
);
server.tool(
  "create_variable",
  'Create a variable in a collection and optionally set its value. Use slashes in the name for grouping (e.g. "color/primary"). Colors use RGBA 0-1.',
  {
    collectionId: z.string().describe("ID of the variable collection"),
    name: z.string().describe("Variable name"),
    resolvedType: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]).describe("Variable type"),
    value: variableValueSchema.optional().describe(
      "Optional initial value: {r,g,b,a?} for COLOR, number for FLOAT, string for STRING, boolean for BOOLEAN, or {aliasOf: variableId}"
    ),
    modeId: z.string().optional().describe(
      "Optional mode ID for the value (default: collection's default mode)"
    ),
    scopes: z.array(z.string()).optional().describe(
      'Optional variable scopes, e.g. ["ALL_FILLS"], ["GAP"], ["CORNER_RADIUS"]'
    )
  },
  async ({ collectionId, name, resolvedType, value, modeId, scopes }) => {
    try {
      const result = await sendCommandToFigma("create_variable", {
        collectionId,
        name,
        resolvedType,
        value,
        modeId,
        scopes
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating variable", error);
    }
  }
);
server.tool(
  "set_variable_value",
  "Set the value of a variable for a mode. Value may be a literal or an alias to another variable ({aliasOf: variableId}).",
  {
    variableId: z.string().describe("ID of the variable"),
    value: variableValueSchema.describe(
      "Value: {r,g,b,a?} (0-1), number, string, boolean, or {aliasOf: variableId}"
    ),
    modeId: z.string().optional().describe("Optional mode ID (default: collection's default mode)")
  },
  async ({ variableId, value, modeId }) => {
    try {
      const result = await sendCommandToFigma("set_variable_value", {
        variableId,
        value,
        modeId
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting variable value", error);
    }
  }
);
server.tool(
  "delete_variable",
  "DESTRUCTIVE: permanently delete a local variable. Nodes bound to it lose the binding. Cannot be undone through this tool.",
  {
    variableId: z.string().describe("ID of the variable to delete")
  },
  async ({ variableId }) => {
    try {
      const result = await sendCommandToFigma("delete_variable", {
        variableId
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error deleting variable", error);
    }
  }
);
server.tool(
  "delete_variable_collection",
  "DESTRUCTIVE: permanently delete a local variable collection together with ALL variables and modes inside it. Nodes bound to those variables lose their bindings. Cannot be undone through this tool.",
  {
    collectionId: z.string().describe("ID of the variable collection to delete")
  },
  async ({ collectionId }) => {
    try {
      const result = await sendCommandToFigma("delete_variable_collection", {
        collectionId
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error deleting variable collection", error);
    }
  }
);
server.tool(
  "bind_variable",
  'Bind a variable to a node property. Fields: fills/strokes (COLOR, bound to the first paint), width, height, itemSpacing, counterAxisSpacing, paddingLeft/Right/Top/Bottom, topLeftRadius/topRightRadius/bottomLeftRadius/bottomRightRadius, strokeWeight, opacity, characters, visible. Shortcuts: "padding" (4 sides), "cornerRadius" (4 corners). Pass variableId null to unbind.',
  {
    nodeId: z.string().describe("ID of the node"),
    field: z.enum([
      "fills",
      "strokes",
      "width",
      "height",
      "itemSpacing",
      "counterAxisSpacing",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "padding",
      "topLeftRadius",
      "topRightRadius",
      "bottomLeftRadius",
      "bottomRightRadius",
      "cornerRadius",
      "strokeWeight",
      "opacity",
      "characters",
      "visible"
    ]).describe("Node property to bind"),
    variableId: z.string().nullable().describe("ID of the variable to bind, or null to remove the binding")
  },
  async ({ nodeId, field, variableId }) => {
    try {
      const result = await sendCommandToFigma("bind_variable", {
        nodeId,
        field,
        variableId
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error binding variable", error);
    }
  }
);
var interactionTriggerSchema = z.enum([
  "ON_CLICK",
  "ON_HOVER",
  "ON_PRESS",
  "ON_DRAG",
  "AFTER_TIMEOUT",
  "MOUSE_ENTER",
  "MOUSE_LEAVE"
]);
server.tool(
  "add_interaction",
  "Add a prototype interaction (trigger + action) to a node. NAVIGATE/SWAP/OVERLAY need a top-level frame on the same page as destination, SCROLL_TO a node inside the same top-level frame, CHANGE_TO a variant of the same component set (source must be an instance or inside a variant). Directional transitions (MOVE_IN, MOVE_OUT, PUSH, SLIDE_IN, SLIDE_OUT) require a direction. Appends to existing reactions unless replace is true.",
  {
    nodeId: z.string().describe("ID of the node that receives the interaction"),
    trigger: interactionTriggerSchema.optional().describe("Trigger type (default: ON_CLICK)"),
    timeout: z.number().positive().optional().describe(
      "Delay in SECONDS (e.g. 2 = 2s), required for AFTER_TIMEOUT; converted to milliseconds for Figma"
    ),
    action: z.enum([
      "NAVIGATE",
      "OVERLAY",
      "SWAP",
      "SCROLL_TO",
      "CHANGE_TO",
      "BACK",
      "CLOSE",
      "URL"
    ]).optional().describe("Action type (default: NAVIGATE)"),
    destinationId: z.string().optional().describe(
      "Destination node ID, required for NAVIGATE, OVERLAY, SWAP, SCROLL_TO and CHANGE_TO"
    ),
    url: z.string().url().optional().describe("URL to open, required for the URL action"),
    openInNewTab: z.boolean().optional().describe("Open URL in a new tab (URL action only, default true)"),
    transition: z.object({
      type: z.enum([
        "INSTANT",
        "DISSOLVE",
        "SMART_ANIMATE",
        "MOVE_IN",
        "MOVE_OUT",
        "PUSH",
        "SLIDE_IN",
        "SLIDE_OUT"
      ]).describe("Transition type"),
      direction: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM"]).optional().describe(
        "Direction, required for MOVE_IN, MOVE_OUT, PUSH, SLIDE_IN and SLIDE_OUT"
      ),
      duration: z.number().positive().max(10).optional().describe("Duration in SECONDS (e.g. 0.3 = 300ms, default: 0.3)"),
      easing: z.enum([
        "LINEAR",
        "EASE_IN",
        "EASE_OUT",
        "EASE_IN_AND_OUT",
        "GENTLE",
        "QUICK",
        "BOUNCY",
        "SLOW"
      ]).optional().describe("Easing curve (default: EASE_OUT)")
    }).optional().describe("Transition for node actions (default: INSTANT)"),
    preserveScrollPosition: z.boolean().optional().describe("Keep the destination's scroll position (node actions only)"),
    replace: z.boolean().optional().describe(
      "Replace all existing reactions instead of appending (default: false)"
    )
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("add_interaction", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error adding interaction", error);
    }
  }
);
server.tool(
  "set_reactions",
  "Replace all prototype reactions of a node with raw Figma Plugin API Reaction objects ({ trigger, actions: [...] }). Use for advanced cases (e.g. SET_VARIABLE, CONDITIONAL, ON_KEY_DOWN). Trigger timeout/delay are in milliseconds, transition duration in seconds.",
  {
    nodeId: z.string().describe("ID of the node"),
    reactions: z.array(z.object({}).passthrough()).describe(
      "Array of raw Reaction objects; an empty array removes all reactions"
    )
  },
  async ({ nodeId, reactions }) => {
    try {
      const result = await sendCommandToFigma("set_reactions", {
        nodeId,
        reactions
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting reactions", error);
    }
  }
);
server.tool(
  "remove_interactions",
  "Remove prototype interactions from a node: all of them, or only those with a given trigger type",
  {
    nodeId: z.string().describe("ID of the node"),
    triggerType: interactionTriggerSchema.optional().describe("Optional trigger type to remove; omit to remove all")
  },
  async ({ nodeId, triggerType }) => {
    try {
      const result = await sendCommandToFigma("remove_interactions", {
        nodeId,
        triggerType
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error removing interactions", error);
    }
  }
);
server.tool(
  "get_flow_starting_points",
  "Get the prototype flow starting points of the current page",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_flow_starting_points");
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting flow starting points", error);
    }
  }
);
server.tool(
  "set_flow_starting_point",
  "Add (or rename) a prototype flow starting point on a top-level frame",
  {
    nodeId: z.string().describe("ID of the top-level frame where the flow starts"),
    name: z.string().describe("Flow name")
  },
  async ({ nodeId, name }) => {
    try {
      const result = await sendCommandToFigma("set_flow_starting_point", {
        nodeId,
        name
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting flow starting point", error);
    }
  }
);
server.tool(
  "remove_flow_starting_point",
  "Remove the prototype flow starting point of a frame",
  {
    nodeId: z.string().describe("ID of the frame whose flow starting point should be removed")
  },
  async ({ nodeId }) => {
    try {
      const result = await sendCommandToFigma("remove_flow_starting_point", {
        nodeId
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error removing flow starting point", error);
    }
  }
);
server.tool(
  "set_overlay_settings",
  "Read the overlay settings (position, background, close on click outside) of a frame used as an overlay. These properties are READ-ONLY in the Figma Plugin API: calling with any setting returns an error together with the current values; set them manually in Figma's Prototype panel.",
  {
    nodeId: z.string().describe("ID of the frame used as overlay destination"),
    position: z.enum([
      "CENTER",
      "TOP_LEFT",
      "TOP_CENTER",
      "TOP_RIGHT",
      "BOTTOM_LEFT",
      "BOTTOM_CENTER",
      "BOTTOM_RIGHT",
      "MANUAL"
    ]).optional().describe("Desired overlay position"),
    background: z.union([z.literal("NONE"), z.object({ color: rgbaSchema })]).optional().describe(
      'Desired overlay background: "NONE" or { color: {r,g,b,a} } (0-1)'
    ),
    closeOnClickOutside: z.boolean().optional().describe("Desired close-on-click-outside behavior")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_overlay_settings", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting overlay settings", error);
    }
  }
);
server.tool(
  "set_scroll_behavior",
  "Set prototype scrolling: overflowDirection on a frame, and/or make a child FIXED (fix position when scrolling) or SCROLLS. FIXED moves the node to the top of its parent's layer order (last child); in an auto-layout parent this also changes the node's position in the flow. SCROLLS moves a fixed node back to the top of the scrolling children. STICKY_SCROLLS is not supported by the Figma Plugin API and returns an error.",
  {
    nodeId: z.string().describe(
      "ID of the node (a frame for overflowDirection, a child of a frame for scrollBehavior)"
    ),
    overflowDirection: z.enum(["NONE", "HORIZONTAL", "VERTICAL", "BOTH"]).optional().describe("Scroll direction of the frame's overflowing content"),
    scrollBehavior: z.enum(["SCROLLS", "FIXED", "STICKY_SCROLLS"]).optional().describe("Scroll behavior of the node inside its parent frame")
  },
  async ({ nodeId, overflowDirection, scrollBehavior }) => {
    try {
      const result = await sendCommandToFigma("set_scroll_behavior", {
        nodeId,
        overflowDirection,
        scrollBehavior
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting scroll behavior", error);
    }
  }
);
server.tool(
  "set_frame_properties",
  "Set frame layout properties not covered by other tools: layoutPositioning (ABSOLUTE takes a child out of its auto-layout parent's flow, AUTO puts it back), itemReverseZIndex (auto-layout stacking: true = first child on top), clipsContent (clip overflowing children). x/y are applied last, so an ABSOLUTE child can be positioned in the same call.",
  {
    nodeId: z.string().describe("ID of the frame, component, instance or child node"),
    layoutPositioning: z.enum(["AUTO", "ABSOLUTE"]).optional().describe("Position of the node inside its auto-layout parent"),
    itemReverseZIndex: z.boolean().optional().describe("Auto-layout frames only: true = first child drawn on top"),
    clipsContent: z.boolean().optional().describe("Whether the frame clips content outside its bounds"),
    x: z.number().optional().describe("X position relative to the parent"),
    y: z.number().optional().describe("Y position relative to the parent")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_frame_properties", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting frame properties", error);
    }
  }
);
var textStylePropsSchema = {
  description: z.string().optional().describe("Optional style description"),
  fontFamily: z.string().optional().describe("Font family (default: Inter, or the style's current family)"),
  fontStyle: z.string().optional().describe(
    'Font style name as shown in Figma, e.g. "Regular", "Medium", "Semi Bold", "Bold". Takes precedence over fontWeight'
  ),
  fontWeight: z.number().optional().describe(
    "Font weight (100-900), mapped to a font style name when fontStyle is not given"
  ),
  fontSize: z.number().positive().optional().describe("Font size in pixels"),
  lineHeight: z.union([
    z.number(),
    z.literal("AUTO"),
    z.object({
      unit: z.enum(["PIXELS", "PERCENT", "AUTO"]),
      value: z.number().optional()
    })
  ]).optional().describe(
    'Line height: number (pixels), "AUTO", or { unit: "PIXELS" | "PERCENT", value }'
  ),
  letterSpacing: z.union([
    z.number(),
    z.object({ unit: z.enum(["PIXELS", "PERCENT"]), value: z.number() })
  ]).optional().describe(
    'Letter spacing: number (pixels) or { unit: "PIXELS" | "PERCENT", value }'
  ),
  textCase: z.enum([
    "ORIGINAL",
    "UPPER",
    "LOWER",
    "TITLE",
    "SMALL_CAPS",
    "SMALL_CAPS_FORCED"
  ]).optional().describe("Text case"),
  textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional().describe("Text decoration"),
  paragraphSpacing: z.number().optional().describe("Paragraph spacing in pixels")
};
server.tool(
  "create_text_style",
  "Create a local text style (typography token). Use slashes in the name to group styles, e.g. 'Heading/H1'. Returns the style id for apply_text_style.",
  {
    name: z.string().min(1).describe("Style name, e.g. 'Body/Medium 14'"),
    ...textStylePropsSchema
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_text_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating text style", error);
    }
  }
);
server.tool(
  "update_text_style",
  "Update properties of an existing local text style. Text nodes using the style update automatically.",
  {
    styleId: z.string().describe("ID of the text style (from get_styles or create_text_style)"),
    name: z.string().min(1).optional().describe("New style name"),
    ...textStylePropsSchema
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("update_text_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error updating text style", error);
    }
  }
);
server.tool(
  "apply_text_style",
  "Apply a text style to one or more TEXT nodes (also works on text inside instances, e.g. 'I<instanceId>;<textId>'). Reports per-node success.",
  {
    styleId: z.string().describe("ID of the text style to apply"),
    nodeId: z.string().optional().describe("ID of a single text node"),
    nodeIds: z.array(z.string()).optional().describe("IDs of multiple text nodes")
  },
  async ({ styleId, nodeId, nodeIds }) => {
    try {
      const result = await sendCommandToFigma("apply_text_style", {
        styleId,
        nodeId,
        nodeIds
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error applying text style", error);
    }
  }
);
server.tool(
  "set_visible",
  "Show or hide one or more nodes (also nodes inside instances, e.g. 'I<instanceId>;<childId>', which creates a visibility override). Reports per-node success.",
  {
    visible: z.boolean().describe("true to show, false to hide"),
    nodeId: z.string().optional().describe("ID of a single node"),
    nodeIds: z.array(z.string()).optional().describe("IDs of multiple nodes")
  },
  async ({ visible, nodeId, nodeIds }) => {
    try {
      const result = await sendCommandToFigma("set_visible", {
        visible,
        nodeId,
        nodeIds
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting visibility", error);
    }
  }
);
server.tool(
  "get_main_component",
  "Return the main component (id, name, variant name and component set) of one or more INSTANCE nodes, read directly in the plugin (no REST API).",
  {
    nodeId: z.string().optional().describe("ID of a single instance"),
    nodeIds: z.array(z.string()).optional().describe("IDs of multiple instances")
  },
  async ({ nodeId, nodeIds }) => {
    try {
      const result = await sendCommandToFigma("get_main_component", {
        nodeId,
        nodeIds
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting main component", error);
    }
  }
);
server.tool(
  "set_text_decoration",
  "Set underline / strikethrough / none on one or more TEXT nodes (also text inside instances, e.g. 'I<instanceId>;<textId>'), optionally only for a character range [start, end). Reports per-node success.",
  {
    decoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).describe("Text decoration to apply"),
    nodeId: z.string().optional().describe("ID of a single text node"),
    nodeIds: z.array(z.string()).optional().describe("IDs of multiple text nodes"),
    start: z.number().int().min(0).optional().describe("Optional start character index (inclusive)"),
    end: z.number().int().min(0).optional().describe("Optional end character index (exclusive)")
  },
  async ({ decoration, nodeId, nodeIds, start, end }) => {
    try {
      const result = await sendCommandToFigma("set_text_decoration", {
        decoration,
        nodeId,
        nodeIds,
        start,
        end
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting text decoration", error);
    }
  }
);
server.tool(
  "delete_style",
  "Delete a local style (text, paint, effect or grid) by ID. Nodes using it keep their current values but are detached.",
  {
    styleId: z.string().describe("ID of the style to delete")
  },
  async ({ styleId }) => {
    try {
      const result = await sendCommandToFigma("delete_style", { styleId });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error deleting style", error);
    }
  }
);
var effectsSchema = z.array(
  z.object({
    type: z.enum([
      "DROP_SHADOW",
      "INNER_SHADOW",
      "LAYER_BLUR",
      "BACKGROUND_BLUR"
    ]),
    color: z.object({
      r: z.number().min(0).max(1),
      g: z.number().min(0).max(1),
      b: z.number().min(0).max(1),
      a: z.number().min(0).max(1).optional()
    }).optional().describe("Shadow color, RGBA 0-1 (default black 10%)"),
    offset: z.object({ x: z.number(), y: z.number() }).optional().describe("Shadow offset in pixels"),
    radius: z.number().min(0).optional().describe("Blur radius in pixels"),
    spread: z.number().optional().describe("Shadow spread in pixels"),
    visible: z.boolean().optional().describe("Whether the effect is visible (default true)"),
    blendMode: z.string().optional().describe("Blend mode (default NORMAL)"),
    showShadowBehindNode: z.boolean().optional().describe("Drop shadow only: show behind translucent fills")
  })
);
server.tool(
  "set_effects",
  "Replace the effects (drop/inner shadows, layer/background blur) of a node. Pass an empty array to clear all effects.",
  {
    nodeId: z.string().describe("ID of the node"),
    effects: effectsSchema.describe("Effects to set on the node, in order")
  },
  async ({ nodeId, effects }) => {
    try {
      const result = await sendCommandToFigma("set_effects", {
        nodeId,
        effects
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting effects", error);
    }
  }
);
server.tool(
  "create_effect_style",
  "Create a local effect style (shadow/blur token), e.g. 'Shadow/lg'. Returns the style id for apply_effect_style.",
  {
    name: z.string().min(1).describe("Style name, e.g. 'Shadow/md'"),
    effects: effectsSchema.min(1).describe("Effects of the style, in order"),
    description: z.string().optional().describe("Style description")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_effect_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating effect style", error);
    }
  }
);
server.tool(
  "update_effect_style",
  "Update the name, description or effects of a local effect style. Nodes using the style update automatically.",
  {
    styleId: z.string().describe(
      "ID of the effect style (from get_styles or create_effect_style)"
    ),
    name: z.string().min(1).optional().describe("New style name"),
    effects: effectsSchema.optional().describe("New effects, replacing the old ones"),
    description: z.string().optional().describe("New description")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("update_effect_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error updating effect style", error);
    }
  }
);
server.tool(
  "apply_effect_style",
  "Apply an effect style to one or more nodes (frames, components, instances, shapes). Pass styleId '' to detach. Reports per-node success.",
  {
    styleId: z.string().describe("ID of the effect style to apply, or '' to detach"),
    nodeId: z.string().optional().describe("ID of a single node"),
    nodeIds: z.array(z.string()).optional().describe("IDs of multiple nodes")
  },
  async ({ styleId, nodeId, nodeIds }) => {
    try {
      const result = await sendCommandToFigma("apply_effect_style", {
        styleId,
        nodeId,
        nodeIds
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error applying effect style", error);
    }
  }
);
var shapeBaseSchema = {
  x: z.number().describe("X position"),
  y: z.number().describe("Y position"),
  width: z.number().positive().describe("Width in pixels"),
  height: z.number().positive().describe("Height in pixels"),
  name: z.string().optional().describe("Optional name for the node"),
  parentId: z.string().optional().describe("Optional parent node ID (default: current page)"),
  fillColor: rgbaSchema.optional().describe("Fill color, RGBA 0-1"),
  strokeColor: rgbaSchema.optional().describe("Stroke color, RGBA 0-1"),
  strokeWeight: z.number().min(0).optional().describe("Stroke weight")
};
var gradientSchema = {
  gradientType: z.enum([
    "GRADIENT_LINEAR",
    "GRADIENT_RADIAL",
    "GRADIENT_ANGULAR",
    "GRADIENT_DIAMOND"
  ]).describe("Gradient type"),
  stops: z.array(
    z.object({
      position: z.number().min(0).max(1).describe("Stop position (0-1)"),
      color: rgbaSchema.describe("Stop color, RGBA 0-1")
    })
  ).min(2).describe("Color stops (at least 2)"),
  angle: z.number().optional().describe(
    "Gradient angle in degrees around the node center (0 = left to right, 90 = top to bottom). Mainly for linear gradients"
  ),
  gradientTransform: z.array(z.array(z.number()).length(3)).length(2).optional().describe(
    "Raw 2x3 gradient transform matrix [[a,b,tx],[c,d,ty]] in normalized node space; overrides angle"
  )
};
server.tool(
  "create_ellipse",
  "Create an ellipse (circle, arc or donut via arcData) in Figma.",
  {
    ...shapeBaseSchema,
    arcData: z.object({
      startingAngle: z.number().optional().describe("Start angle in radians (default 0)"),
      endingAngle: z.number().optional().describe("End angle in radians (default 2\u03C0)"),
      innerRadius: z.number().min(0).max(1).optional().describe("Inner radius ratio 0-1 for donuts (default 0)")
    }).optional().describe("Optional arc settings for arcs/donuts")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_ellipse", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating ellipse", error);
    }
  }
);
server.tool(
  "create_line",
  "Create a straight line in Figma, starting at (x, y) with the given length and optional rotation.",
  {
    x: z.number().describe("Start X position"),
    y: z.number().describe("Start Y position"),
    length: z.number().positive().describe("Line length in pixels"),
    rotation: z.number().optional().describe("Rotation in degrees (Figma convention, counter-clockwise)"),
    name: z.string().optional().describe("Optional name for the line"),
    parentId: z.string().optional().describe("Optional parent node ID (default: current page)"),
    strokeColor: rgbaSchema.optional().describe("Stroke color, RGBA 0-1 (default black)"),
    strokeWeight: z.number().positive().optional().describe("Stroke weight (default 1)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_line", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating line", error);
    }
  }
);
server.tool(
  "create_polygon",
  "Create a regular polygon (triangle, hexagon, ...) in Figma.",
  {
    ...shapeBaseSchema,
    pointCount: z.number().int().min(3).optional().describe("Number of sides (default 3)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_polygon", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating polygon", error);
    }
  }
);
server.tool(
  "create_star",
  "Create a star shape in Figma.",
  {
    ...shapeBaseSchema,
    pointCount: z.number().int().min(3).optional().describe("Number of points (default 5)"),
    innerRadius: z.number().min(0).max(1).optional().describe("Inner radius ratio 0-1 (default 0.382)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_star", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating star", error);
    }
  }
);
server.tool(
  "create_vector",
  "Create a vector node from SVG path data (e.g. 'M 0 0 L 10 10 Z'). Filled black when no fill or stroke is given. For full SVG markup use create_node_from_svg.",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    name: z.string().optional().describe("Optional name for the vector"),
    parentId: z.string().optional().describe("Optional parent node ID (default: current page)"),
    paths: z.array(
      z.object({
        data: z.string().min(1).describe("SVG path data string"),
        windingRule: z.enum(["NONZERO", "EVENODD"]).optional().describe("Fill rule (default NONZERO)")
      })
    ).min(1).describe("Vector paths"),
    fillColor: rgbaSchema.optional().describe("Fill color, RGBA 0-1"),
    strokeColor: rgbaSchema.optional().describe("Stroke color, RGBA 0-1"),
    strokeWeight: z.number().min(0).optional().describe("Stroke weight")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_vector", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating vector", error);
    }
  }
);
server.tool(
  "group_nodes",
  "Group nodes into a GROUP. All nodes must share the same parent.",
  {
    nodeIds: z.array(z.string()).min(1).describe("IDs of the nodes to group"),
    name: z.string().optional().describe("Optional name for the group")
  },
  async ({ nodeIds, name }) => {
    try {
      const result = await sendCommandToFigma("group_nodes", { nodeIds, name });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error grouping nodes", error);
    }
  }
);
server.tool(
  "ungroup_node",
  "Ungroup a GROUP node, moving its children into the group's parent. Returns the children IDs.",
  {
    nodeId: z.string().describe("ID of the GROUP node")
  },
  async ({ nodeId }) => {
    try {
      const result = await sendCommandToFigma("ungroup_node", { nodeId });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error ungrouping node", error);
    }
  }
);
server.tool(
  "boolean_operation",
  "Combine shapes with a boolean operation (union, subtract, intersect, exclude). All nodes must share the same parent; for SUBTRACT the bottom-most node is the base.",
  {
    nodeIds: z.array(z.string()).min(2).describe("IDs of the nodes to combine"),
    operation: z.enum(["UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"]).describe("Boolean operation"),
    name: z.string().optional().describe("Optional name for the result")
  },
  async ({ nodeIds, operation, name }) => {
    try {
      const result = await sendCommandToFigma("boolean_operation", {
        nodeIds,
        operation,
        name
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error running boolean operation", error);
    }
  }
);
server.tool(
  "flatten_nodes",
  "Flatten one or more nodes into a single vector. All nodes must share the same parent.",
  {
    nodeIds: z.array(z.string()).min(1).describe("IDs of the nodes to flatten"),
    name: z.string().optional().describe("Optional name for the vector")
  },
  async ({ nodeIds, name }) => {
    try {
      const result = await sendCommandToFigma("flatten_nodes", {
        nodeIds,
        name
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error flattening nodes", error);
    }
  }
);
server.tool(
  "set_text_properties",
  "Set typography of a TEXT node: font, size, line height, letter spacing, case, color, hyperlink, list type and indentation, for the whole node or a character range [start, end). Paragraph spacing, alignment, auto-resize, truncation and maxLines always apply to the whole node.",
  {
    nodeId: z.string().describe("ID of the text node"),
    start: z.number().int().min(0).optional().describe("Optional start character index (inclusive)"),
    end: z.number().int().min(0).optional().describe("Optional end character index (exclusive)"),
    fontFamily: z.string().optional().describe(
      "Font family; without fontStyle the current style is kept (fallback Regular)"
    ),
    fontStyle: z.string().optional().describe('Font style name as shown in Figma, e.g. "Regular", "Bold"'),
    fontSize: z.number().positive().optional().describe("Font size in pixels"),
    lineHeight: z.union([
      z.object({ unit: z.literal("AUTO") }),
      z.object({
        unit: z.enum(["PIXELS", "PERCENT"]),
        value: z.number().finite()
      })
    ]).optional().describe(
      'Line height { unit, value }; value is required for PIXELS/PERCENT, omitted for "AUTO"'
    ),
    letterSpacing: z.object({
      unit: z.enum(["PIXELS", "PERCENT"]),
      value: z.number().finite()
    }).optional().describe("Letter spacing { unit, value }"),
    textCase: z.enum([
      "ORIGINAL",
      "UPPER",
      "LOWER",
      "TITLE",
      "SMALL_CAPS",
      "SMALL_CAPS_FORCED"
    ]).optional().describe("Text case"),
    fillColor: rgbaSchema.optional().describe("Text color, RGBA 0-1"),
    paragraphSpacing: z.number().min(0).optional().describe("Paragraph spacing in pixels (whole node)"),
    textAlignHorizontal: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]).optional().describe("Horizontal alignment (whole node)"),
    textAlignVertical: z.enum(["TOP", "CENTER", "BOTTOM"]).optional().describe("Vertical alignment (whole node)"),
    textAutoResize: z.enum(["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"]).optional().describe("Auto-resize mode (whole node)"),
    hyperlink: z.union([
      z.object({
        type: z.enum(["URL", "NODE"]),
        value: z.string().min(1).describe("URL for type URL, or target node ID for type NODE")
      }).refine(
        (link) => link.type !== "URL" || /^(https?:|mailto:)/i.test(link.value),
        {
          message: "hyperlink URL must start with http:, https: or mailto:",
          path: ["value"]
        }
      ),
      z.null()
    ]).optional().describe(
      "Hyperlink for the node or range: { type: 'URL', value: 'https://...' }, { type: 'NODE', value: nodeId }, or null to remove"
    ),
    listType: z.enum(["NONE", "ORDERED", "UNORDERED"]).optional().describe(
      "List style for the paragraphs in the node or range (NONE removes the list)"
    ),
    indentation: z.number().int().min(0).optional().describe("List indentation level for the node or range (0 = none)"),
    textTruncation: z.enum(["DISABLED", "ENDING"]).optional().describe("ENDING truncates overflowing text with an ellipsis (whole node)"),
    maxLines: z.number().int().min(1).nullable().optional().describe(
      "Max lines before truncating, needs textTruncation ENDING; null disables (whole node)"
    )
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_text_properties", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting text properties", error);
    }
  }
);
server.tool(
  "set_node_properties",
  "Set general properties (opacity, rotation, blend mode, lock, mask, min/max size) on one or more nodes. Properties a node does not have are reported as skipped. Reports per-node success.",
  {
    nodeId: z.string().optional().describe("ID of a single node"),
    nodeIds: z.array(z.string()).optional().describe("IDs of multiple nodes"),
    opacity: z.number().min(0).max(1).optional().describe("Opacity (0-1)"),
    rotation: z.number().optional().describe("Rotation in degrees (Figma convention, counter-clockwise)"),
    blendMode: z.enum([
      "PASS_THROUGH",
      "NORMAL",
      "DARKEN",
      "MULTIPLY",
      "LINEAR_BURN",
      "COLOR_BURN",
      "LIGHTEN",
      "SCREEN",
      "LINEAR_DODGE",
      "COLOR_DODGE",
      "OVERLAY",
      "SOFT_LIGHT",
      "HARD_LIGHT",
      "DIFFERENCE",
      "EXCLUSION",
      "HUE",
      "SATURATION",
      "COLOR",
      "LUMINOSITY"
    ]).optional().describe("Layer blend mode"),
    locked: z.boolean().optional().describe("Lock or unlock the node"),
    isMask: z.boolean().optional().describe("Use the node as a mask"),
    minWidth: z.number().min(0).nullable().optional().describe("Min width (auto layout), null to reset"),
    maxWidth: z.number().min(0).nullable().optional().describe("Max width (auto layout), null to reset"),
    minHeight: z.number().min(0).nullable().optional().describe("Min height (auto layout), null to reset"),
    maxHeight: z.number().min(0).nullable().optional().describe("Max height (auto layout), null to reset")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_node_properties", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting node properties", error);
    }
  }
);
server.tool(
  "set_gradient_fill",
  "Set a gradient (linear, radial, angular, diamond) as the fill or stroke of a node, replacing existing paints or appending to them.",
  {
    nodeId: z.string().describe("ID of the node"),
    ...gradientSchema,
    target: z.enum(["fill", "stroke"]).optional().describe("Apply to fills or strokes (default fill)"),
    append: z.boolean().optional().describe(
      "true to add on top of existing paints, false to replace them (default false)"
    )
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_gradient_fill", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting gradient fill", error);
    }
  }
);
var paintStyleGradientSchema = {
  gradientType: gradientSchema.gradientType.optional(),
  stops: gradientSchema.stops.optional(),
  angle: gradientSchema.angle,
  gradientTransform: gradientSchema.gradientTransform
};
server.tool(
  "create_paint_style",
  "Create a local paint style (color token) from a solid color or a gradient, e.g. 'Brand/Primary'. Returns the style id for apply_paint_style.",
  {
    name: z.string().min(1).describe("Style name, e.g. 'Brand/Primary'"),
    color: rgbaSchema.optional().describe("Solid color, RGBA 0-1 (or use gradientType + stops)"),
    ...paintStyleGradientSchema,
    description: z.string().optional().describe("Style description")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_paint_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating paint style", error);
    }
  }
);
server.tool(
  "update_paint_style",
  "Update the name, description or paint (solid color or gradient) of a local paint style. Nodes using the style update automatically.",
  {
    styleId: z.string().describe("ID of the paint style (from get_styles or create_paint_style)"),
    name: z.string().min(1).optional().describe("New style name"),
    color: rgbaSchema.optional().describe("New solid color, RGBA 0-1"),
    ...paintStyleGradientSchema,
    description: z.string().optional().describe("New description")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("update_paint_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error updating paint style", error);
    }
  }
);
server.tool(
  "apply_paint_style",
  "Apply a paint style to the fill or stroke of a node.",
  {
    nodeId: z.string().describe("ID of the node"),
    styleId: z.string().describe("ID of the paint style to apply"),
    target: z.enum(["fill", "stroke"]).optional().describe("Apply to fill or stroke (default fill)")
  },
  async ({ nodeId, styleId, target }) => {
    try {
      const result = await sendCommandToFigma("apply_paint_style", {
        nodeId,
        styleId,
        target
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error applying paint style", error);
    }
  }
);
server.tool(
  "set_stroke_properties",
  "Set stroke properties of a node: weight, alignment, dash pattern, cap, join and per-side weights (frames/rectangles). Use set_stroke_color for the color.",
  {
    nodeId: z.string().describe("ID of the node"),
    strokeWeight: z.number().min(0).optional().describe("Stroke weight"),
    strokeAlign: z.enum(["INSIDE", "OUTSIDE", "CENTER"]).optional().describe("Stroke alignment"),
    dashPattern: z.array(z.number().min(0)).optional().describe("Dash/gap lengths, e.g. [4, 2]; [] for a solid stroke"),
    strokeCap: z.enum([
      "NONE",
      "ROUND",
      "SQUARE",
      "ARROW_LINES",
      "ARROW_EQUILATERAL",
      "TRIANGLE_FILLED",
      "DIAMOND_FILLED",
      "CIRCLE_FILLED"
    ]).optional().describe("Stroke cap (lines/vectors)"),
    strokeJoin: z.enum(["MITER", "BEVEL", "ROUND"]).optional().describe("Stroke join"),
    strokeTopWeight: z.number().min(0).optional().describe("Top stroke weight"),
    strokeRightWeight: z.number().min(0).optional().describe("Right stroke weight"),
    strokeBottomWeight: z.number().min(0).optional().describe("Bottom stroke weight"),
    strokeLeftWeight: z.number().min(0).optional().describe("Left stroke weight")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_stroke_properties", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting stroke properties", error);
    }
  }
);
server.tool(
  "get_pages",
  "List all pages in the document with id, name and whether it is the current page. childCount is only included for the current page (other pages are not loaded).",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_pages");
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting pages", error);
    }
  }
);
server.tool(
  "create_page",
  "Create a new page in the document.",
  {
    name: z.string().optional().describe("Optional name for the new page"),
    switchTo: z.boolean().optional().describe("Switch to the new page after creating it (default false)")
  },
  async ({ name, switchTo }) => {
    try {
      const result = await sendCommandToFigma("create_page", {
        name,
        switchTo
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating page", error);
    }
  }
);
server.tool(
  "set_current_page",
  "Switch the current page in Figma. Other tools default to the current page.",
  {
    pageId: z.string().describe("ID of the page to switch to")
  },
  async ({ pageId }) => {
    try {
      const result = await sendCommandToFigma("set_current_page", { pageId });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting current page", error);
    }
  }
);
server.tool(
  "detach_instance",
  "Detach a component instance, converting it into a regular frame. Returns the new frame.",
  {
    nodeId: z.string().describe("ID of the INSTANCE node to detach")
  },
  async ({ nodeId }) => {
    try {
      const result = await sendCommandToFigma("detach_instance", { nodeId });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error detaching instance", error);
    }
  }
);
var constraintSchema = z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]);
server.tool(
  "set_constraints",
  "Set resizing constraints of a node relative to its parent frame. Unspecified axes keep their current value. MIN = left/top, MAX = right/bottom, STRETCH = left & right / top & bottom.",
  {
    nodeId: z.string().describe("ID of the node"),
    horizontal: constraintSchema.optional().describe("Horizontal constraint"),
    vertical: constraintSchema.optional().describe("Vertical constraint")
  },
  async ({ nodeId, horizontal, vertical }) => {
    try {
      if (horizontal === void 0 && vertical === void 0) {
        throw new Error("Provide horizontal and/or vertical");
      }
      const result = await sendCommandToFigma("set_constraints", {
        nodeId,
        horizontal,
        vertical
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting constraints", error);
    }
  }
);
var gridColorSchema = rgbaSchema.optional().describe("Grid color, RGBA 0-1 (default red at 10% opacity)");
var layoutGridsSchema = z.array(
  z.union([
    z.object({
      pattern: z.literal("GRID").describe("Square grid"),
      sectionSize: z.number().positive().describe("Grid cell size in pixels"),
      visible: z.boolean().optional().describe("Whether the grid is visible (default true)"),
      color: gridColorSchema
    }),
    z.object({
      pattern: z.enum(["COLUMNS", "ROWS"]).describe("Column or row grid"),
      alignment: z.enum(["MIN", "MAX", "STRETCH", "CENTER"]).describe("Grid alignment within the frame"),
      count: z.union([z.number().int().positive(), z.literal("AUTO")]).describe('Number of columns/rows, or "AUTO" to fill the frame'),
      gutterSize: z.number().min(0).describe("Gap between columns/rows in pixels"),
      offset: z.number().min(0).optional().describe(
        "Margin from the frame edge in pixels (ignored for CENTER, default 0)"
      ),
      sectionSize: z.number().positive().optional().describe(
        "Column/row width in pixels; required unless alignment is STRETCH"
      ),
      visible: z.boolean().optional().describe("Whether the grid is visible (default true)"),
      color: gridColorSchema
    })
  ])
);
function validateLayoutGrids(grids) {
  for (const grid of grids) {
    if (grid.pattern !== "GRID" && grid.alignment !== "STRETCH" && grid.sectionSize === void 0) {
      throw new Error(
        `sectionSize is required for ${grid.pattern} grids with alignment ${grid.alignment}`
      );
    }
  }
}
server.tool(
  "set_layout_grids",
  "Replace the layout grids of a frame, component or instance. Pass an empty array to remove all grids.",
  {
    nodeId: z.string().describe("ID of the frame/component/instance"),
    grids: layoutGridsSchema.describe("Layout grids to set; [] removes all grids")
  },
  async ({ nodeId, grids }) => {
    try {
      validateLayoutGrids(grids);
      const result = await sendCommandToFigma("set_layout_grids", {
        nodeId,
        grids
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting layout grids", error);
    }
  }
);
server.tool(
  "reorder_node",
  "Change the z-order (layer order) of a node within its parent. FRONT/BACK move to top/bottom, FORWARD/BACKWARD move one step, INDEX moves to an explicit child index (0 = backmost).",
  {
    nodeId: z.string().describe("ID of the node"),
    position: z.enum(["FRONT", "BACK", "FORWARD", "BACKWARD", "INDEX"]).describe("Where to move the node"),
    index: z.number().int().min(0).optional().describe("Target child index; required when position is INDEX")
  },
  async ({ nodeId, position, index }) => {
    try {
      if (position === "INDEX" && index === void 0) {
        throw new Error("index is required when position is INDEX");
      }
      const result = await sendCommandToFigma("reorder_node", {
        nodeId,
        position,
        index
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error reordering node", error);
    }
  }
);
server.tool(
  "get_node_css",
  "Get the CSS properties Figma generates for a node (same as Dev Mode's CSS panel), as a property \u2192 value object.",
  {
    nodeId: z.string().describe("ID of the node")
  },
  async ({ nodeId }) => {
    try {
      const result = await sendCommandToFigma("get_node_css", { nodeId });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting node CSS", error);
    }
  }
);
server.tool(
  "find_nodes",
  "Search descendant nodes by name (substring or regex) and/or type. Use scan_nodes_by_types for type-only scans with progress; this tool focuses on name search.",
  {
    parentId: z.string().optional().describe("Node to search within (default: current page)"),
    nameContains: z.string().optional().describe("Case-insensitive substring the node name must contain"),
    nameRegex: z.string().max(200).optional().describe(
      "JavaScript regular expression the node name must match (max 200 characters)"
    ),
    types: z.array(z.string()).optional().describe("Node types to include, e.g. ['FRAME', 'TEXT']"),
    limit: z.number().int().min(1).max(1e3).optional().describe("Maximum number of results (default 100, max 1000)"),
    includeHidden: z.boolean().optional().describe("Include hidden nodes and nodes inside hidden parents (default true)"),
    allPages: z.boolean().optional().describe(
      "Search every page instead of the current one (default false; cannot be combined with parentId). Results include pageId/pageName. Scanning stops at the first page boundary after more than `limit` matches; then `totalIsLowerBound` is true and `total` only counts the scanned pages (`pagesScanned` of `pageCount`). Loading all pages can be slow on large files"
    )
  },
  async (params) => {
    try {
      if (params.allPages && params.parentId) {
        throw new Error("Use either parentId or allPages, not both");
      }
      if (params.nameRegex !== void 0) {
        if (/\([^)]*[+*][^)]*\)[+*{]/.test(params.nameRegex)) {
          throw new Error("nameRegex rejected: nested quantifiers are not allowed");
        }
        try {
          new RegExp(params.nameRegex);
        } catch (error) {
          throw new Error(
            `Invalid nameRegex: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      const result = await sendCommandToFigma(
        "find_nodes",
        params,
        params.allPages ? 12e4 : 6e4
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error finding nodes", error);
    }
  }
);
server.tool(
  "create_sticky",
  "Create a sticky note (FigJam only).",
  {
    text: z.string().describe("Sticky note text"),
    x: z.number().optional().describe("X position (default 0)"),
    y: z.number().optional().describe("Y position (default 0)"),
    color: rgbaSchema.optional().describe("Sticky fill color, RGBA 0-1"),
    authorVisible: z.boolean().optional().describe("Show the author name on the sticky"),
    parentId: z.string().optional().describe("Optional parent node ID (default: current page)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_sticky", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating sticky", error);
    }
  }
);
server.tool(
  "create_shape_with_text",
  "Create a diagram shape with text (FigJam only).",
  {
    shapeType: z.enum([
      "SQUARE",
      "ELLIPSE",
      "ROUNDED_RECTANGLE",
      "DIAMOND",
      "TRIANGLE_UP",
      "TRIANGLE_DOWN",
      "PARALLELOGRAM_RIGHT",
      "PARALLELOGRAM_LEFT",
      "ENG_DATABASE",
      "ENG_QUEUE",
      "ENG_FILE",
      "ENG_FOLDER",
      "TRAPEZOID",
      "PREDEFINED_PROCESS",
      "SHIELD",
      "DOCUMENT_SINGLE",
      "DOCUMENT_MULTIPLE",
      "MANUAL_INPUT",
      "HEXAGON",
      "CHEVRON",
      "PENTAGON",
      "OCTAGON",
      "STAR",
      "PLUS",
      "ARROW_LEFT",
      "ARROW_RIGHT",
      "SUMMING_JUNCTION",
      "OR",
      "SPEECH_BUBBLE",
      "INTERNAL_STORAGE"
    ]).describe("Shape type"),
    text: z.string().optional().describe("Text inside the shape"),
    x: z.number().optional().describe("X position (default 0)"),
    y: z.number().optional().describe("Y position (default 0)"),
    width: z.number().positive().optional().describe("Width in pixels"),
    height: z.number().positive().optional().describe("Height in pixels"),
    fillColor: rgbaSchema.optional().describe("Shape fill color, RGBA 0-1"),
    parentId: z.string().optional().describe("Optional parent node ID (default: current page)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_shape_with_text", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating shape with text", error);
    }
  }
);
server.tool(
  "create_table",
  "Create a table, optionally filled with cell text (FigJam only).",
  {
    rows: z.number().int().min(1).max(100).optional().describe("Number of rows (default 2)"),
    columns: z.number().int().min(1).max(100).optional().describe("Number of columns (default 2)"),
    x: z.number().optional().describe("X position (default 0)"),
    y: z.number().optional().describe("Y position (default 0)"),
    cells: z.array(z.array(z.string())).optional().describe("Cell text as rows of columns, e.g. [['A1','B1'],['A2','B2']]"),
    parentId: z.string().optional().describe("Optional parent node ID (default: current page)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_table", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating table", error);
    }
  }
);
var pluginDataNamespaceSchema = z.string().regex(/^[A-Za-z0-9]{3,}$/).describe("Namespace (at least 3 alphanumeric characters)");
server.tool(
  "set_shared_plugin_data",
  "Store a string on a node as shared plugin data, readable by any plugin using the same namespace. An empty value deletes the key.",
  {
    nodeId: z.string().describe("ID of the node"),
    namespace: pluginDataNamespaceSchema,
    key: z.string().min(1).describe("Data key"),
    value: z.string().describe("Value to store; empty string deletes the key")
  },
  async ({ nodeId, namespace, key, value }) => {
    try {
      const result = await sendCommandToFigma("set_shared_plugin_data", {
        nodeId,
        namespace,
        key,
        value
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting shared plugin data", error);
    }
  }
);
server.tool(
  "get_shared_plugin_data",
  "Read shared plugin data from a node. Without key, returns all key/value pairs in the namespace.",
  {
    nodeId: z.string().describe("ID of the node"),
    namespace: pluginDataNamespaceSchema,
    key: z.string().optional().describe("Data key (omit to read all keys)")
  },
  async ({ nodeId, namespace, key }) => {
    try {
      const result = await sendCommandToFigma("get_shared_plugin_data", {
        nodeId,
        namespace,
        key
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting shared plugin data", error);
    }
  }
);
var variableScopeSchema = z.enum([
  "ALL_SCOPES",
  "TEXT_CONTENT",
  "CORNER_RADIUS",
  "WIDTH_HEIGHT",
  "GAP",
  "ALL_FILLS",
  "FRAME_FILL",
  "SHAPE_FILL",
  "TEXT_FILL",
  "STROKE_COLOR",
  "STROKE_FLOAT",
  "EFFECT_FLOAT",
  "EFFECT_COLOR",
  "OPACITY",
  "COLOR_OPACITY",
  "FONT_FAMILY",
  "FONT_STYLE",
  "FONT_WEIGHT",
  "FONT_SIZE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
  "PARAGRAPH_SPACING",
  "PARAGRAPH_INDENT"
]);
server.tool(
  "update_variable",
  "Update metadata of an existing variable: name, description, scopes, hiddenFromPublishing and code syntax (WEB/ANDROID/iOS). Use set_variable_value to change values.",
  {
    variableId: z.string().describe("ID of the variable"),
    name: z.string().optional().describe("New name (use / for groups)"),
    description: z.string().optional().describe("New description"),
    scopes: z.array(variableScopeSchema).optional().describe('Replace the variable scopes, e.g. ["ALL_FILLS"]'),
    hiddenFromPublishing: z.boolean().optional().describe("Hide the variable when publishing the library"),
    codeSyntax: z.object({
      WEB: z.string().optional(),
      ANDROID: z.string().optional(),
      iOS: z.string().optional()
    }).optional().describe(
      "Code syntax per platform, e.g. {WEB: 'var(--color-primary)'}. An empty string removes the syntax for that platform"
    )
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("update_variable", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error updating variable", error);
    }
  }
);
server.tool(
  "update_variable_collection",
  "Rename a variable collection or change whether it is hidden from publishing.",
  {
    collectionId: z.string().describe("ID of the variable collection"),
    name: z.string().optional().describe("New collection name"),
    hiddenFromPublishing: z.boolean().optional().describe("Hide the collection when publishing the library")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma(
        "update_variable_collection",
        params
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error updating variable collection", error);
    }
  }
);
server.tool(
  "manage_variable_modes",
  "Add, rename or remove a mode of a variable collection (e.g. Light/Dark). Returns the collection's current modes. The number of modes may be limited by the Figma plan.",
  {
    collectionId: z.string().describe("ID of the variable collection"),
    action: z.enum(["add", "rename", "remove"]).describe("Mode operation"),
    name: z.string().optional().describe("Mode name (required for add and rename)"),
    modeId: z.string().optional().describe("Mode ID (required for rename and remove)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("manage_variable_modes", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error managing variable modes", error);
    }
  }
);
server.tool(
  "set_variable_mode",
  "Set the explicit variable mode of a node (frame, component, page, ...) for a collection, e.g. switch a frame to Dark mode. Use clear: true to remove the explicit mode so it inherits from its parent. Returns the node's explicitVariableModes.",
  {
    nodeId: z.string().describe("ID of the node"),
    collectionId: z.string().describe("ID of the variable collection"),
    modeId: z.string().optional().describe("Mode ID to apply (required unless clear is true)"),
    clear: z.boolean().optional().describe("true to clear the explicit mode for this collection")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_variable_mode", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting variable mode", error);
    }
  }
);
server.tool(
  "import_style_by_key",
  "Import a published library style (paint, text, effect or grid) by its key so it can be applied locally. Returns the local style id, name and type.",
  {
    key: z.string().describe("Published style key")
  },
  async ({ key }) => {
    try {
      const result = await sendCommandToFigma("import_style_by_key", { key });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error importing style", error);
    }
  }
);
server.tool(
  "import_variable_by_key",
  "Import a published library variable by its key (see get_library_variables) so it can be bound locally. Returns id, name, resolvedType and variableCollectionId.",
  {
    key: z.string().describe("Published variable key")
  },
  async ({ key }) => {
    try {
      const result = await sendCommandToFigma("import_variable_by_key", {
        key
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error importing variable", error);
    }
  }
);
server.tool(
  "get_library_variable_collections",
  "List variable collections available from enabled team libraries (key, name, libraryName). Requires the plugin's teamlibrary permission.",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma(
        "get_library_variable_collections"
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting library variable collections", error);
    }
  }
);
server.tool(
  "get_library_variables",
  "List variables (key, name, resolvedType) in a team library variable collection. Import one with import_variable_by_key.",
  {
    libraryCollectionKey: z.string().describe("Key of the library collection from get_library_variable_collections")
  },
  async ({ libraryCollectionKey }) => {
    try {
      const result = await sendCommandToFigma("get_library_variables", {
        libraryCollectionKey
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting library variables", error);
    }
  }
);
server.tool(
  "edit_component_property",
  "Edit a component property (BOOLEAN, TEXT, INSTANCE_SWAP) on a COMPONENT or COMPONENT_SET: rename it, change its default value, preferred values or description. Returns the new full property name. Limitations: VARIANT properties and slotSettings are not supported; for a variant inside a set, edit the property on the parent COMPONENT_SET.",
  {
    nodeId: z.string().describe("ID of the COMPONENT or COMPONENT_SET"),
    propertyName: z.string().describe("Full property name including the #id suffix, e.g. 'Label#12:0'"),
    newValues: z.object({
      name: z.string().optional().describe("New property name (without suffix)"),
      defaultValue: z.union([z.string(), z.boolean()]).optional().describe("New default value (string for TEXT / component id for INSTANCE_SWAP, boolean for BOOLEAN)"),
      preferredValues: z.array(
        z.object({
          type: z.enum(["COMPONENT", "COMPONENT_SET"]),
          key: z.string().describe("Component or component set key")
        })
      ).optional().describe("Preferred values for INSTANCE_SWAP properties"),
      description: z.string().optional().describe("New property description")
    }).describe("Fields to change")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("edit_component_property", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error editing component property", error);
    }
  }
);
server.tool(
  "delete_component_property",
  "Delete a component property (BOOLEAN, TEXT, INSTANCE_SWAP) from a COMPONENT or COMPONENT_SET.",
  {
    nodeId: z.string().describe("ID of the COMPONENT or COMPONENT_SET"),
    propertyName: z.string().describe("Full property name including the #id suffix")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma(
        "delete_component_property",
        params
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error deleting component property", error);
    }
  }
);
server.tool(
  "reset_instance_overrides",
  "Reset all overrides on one or more component instances back to the main component. Returns {applied, failed, results}.",
  {
    nodeId: z.string().optional().describe("ID of a single INSTANCE"),
    nodeIds: z.array(z.string()).optional().describe("IDs of several INSTANCE nodes (takes precedence over nodeId)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma(
        "reset_instance_overrides",
        params
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error resetting instance overrides", error);
    }
  }
);
var paintCommonSchema = {
  opacity: z.number().min(0).max(1).optional().describe("Paint opacity (0-1)"),
  visible: z.boolean().optional().describe("Paint visibility (default true)"),
  blendMode: z.string().optional().describe("Blend mode (default NORMAL)")
};
var paintInputSchema = z.union([
  z.object({
    type: z.literal("SOLID"),
    color: rgbaSchema.describe("Color, RGBA 0-1"),
    ...paintCommonSchema,
    opacity: paintCommonSchema.opacity.describe(
      "Paint opacity (0-1), overrides color.a"
    )
  }),
  z.object({
    type: gradientSchema.gradientType,
    stops: gradientSchema.stops,
    angle: gradientSchema.angle,
    ...paintCommonSchema
  }),
  z.object({
    type: z.literal("IMAGE"),
    imageHash: z.string().describe("Hash of an image already in the file (e.g. from set_image_fill)"),
    scaleMode: z.enum(["FILL", "FIT", "TILE"]).optional().describe("Image scale mode (default FILL)"),
    ...paintCommonSchema
  })
]);
server.tool(
  "set_fills",
  "Replace all fills or strokes of a node with a list of paints (solid, gradient, image). Array order follows Figma: index 0 is the bottom-most paint, the last item is on top. paints: [] removes all paints.",
  {
    nodeId: z.string().describe("ID of the node"),
    target: z.enum(["fills", "strokes"]).optional().describe("Paint list to replace (default fills)"),
    paints: z.array(paintInputSchema).describe("Paints, bottom-most first; [] removes all")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_fills", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting fills", error);
    }
  }
);
server.tool(
  "get_available_fonts",
  "List fonts available to the Figma plugin (same as the font picker), grouped by family with their style names. Use the exact family/style with create_text, set_text_properties or text styles.",
  {
    family: z.string().min(1).optional().describe("Only families containing this text (case-insensitive)"),
    limit: z.number().int().positive().optional().describe("Maximum number of families to return (default 200)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("get_available_fonts", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error listing fonts", error);
    }
  }
);
server.tool(
  "set_layout_child",
  "Set how a node behaves inside its auto-layout parent. HORIZONTAL/VERTICAL parents: layoutGrow (0 fixed, 1 fill the primary axis) and layoutAlign (STRETCH fills the counter axis). GRID parents: cell position (gridRow + gridColumn, 0-based), spans and cell alignment. For fill/hug sizing see also set_layout_sizing.",
  {
    nodeId: z.string().describe("ID of the auto-layout child"),
    layoutGrow: z.number().min(0).optional().describe("Flex parents: 0 = fixed size, 1 = grow along the primary axis"),
    layoutAlign: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"]).optional().describe("Flex parents: counter-axis alignment; STRETCH fills it"),
    gridRow: z.number().int().min(0).optional().describe("Grid parents: 0-based row index (requires gridColumn)"),
    gridColumn: z.number().int().min(0).optional().describe("Grid parents: 0-based column index (requires gridRow)"),
    gridRowSpan: z.number().int().min(1).optional().describe("Grid parents: number of rows the node spans"),
    gridColumnSpan: z.number().int().min(1).optional().describe("Grid parents: number of columns the node spans"),
    gridChildHorizontalAlign: z.enum(["MIN", "CENTER", "MAX", "AUTO"]).optional().describe("Grid parents: horizontal alignment inside the cell"),
    gridChildVerticalAlign: z.enum(["MIN", "CENTER", "MAX", "AUTO"]).optional().describe("Grid parents: vertical alignment inside the cell")
  },
  async (params) => {
    try {
      if (params.gridRow === void 0 !== (params.gridColumn === void 0)) {
        throw new Error("gridRow and gridColumn must be given together");
      }
      const result = await sendCommandToFigma("set_layout_child", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting layout child properties", error);
    }
  }
);
server.tool(
  "create_grid_style",
  "Create a local grid style (layout grid token), e.g. 'Grid/12 columns'. Uses the same grid format as set_layout_grids. Returns the style id for apply_grid_style; delete it with delete_style.",
  {
    name: z.string().min(1).describe("Style name, e.g. 'Grid/Desktop 12 col'"),
    grids: layoutGridsSchema.min(1).describe("Layout grids of the style"),
    description: z.string().optional().describe("Style description")
  },
  async (params) => {
    try {
      validateLayoutGrids(params.grids);
      const result = await sendCommandToFigma("create_grid_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating grid style", error);
    }
  }
);
server.tool(
  "update_grid_style",
  "Update the name, description or layout grids of a local grid style. Nodes using the style update automatically.",
  {
    styleId: z.string().describe("ID of the grid style (from get_styles or create_grid_style)"),
    name: z.string().min(1).optional().describe("New style name"),
    grids: layoutGridsSchema.optional().describe("New layout grids, replacing the old ones"),
    description: z.string().optional().describe("New description")
  },
  async (params) => {
    try {
      if (params.grids) validateLayoutGrids(params.grids);
      const result = await sendCommandToFigma("update_grid_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error updating grid style", error);
    }
  }
);
server.tool(
  "apply_grid_style",
  "Apply a grid style to one or more frames, components or instances. Pass styleId '' to detach. Reports per-node success.",
  {
    styleId: z.string().describe("ID of the grid style to apply, or '' to detach"),
    nodeId: z.string().optional().describe("ID of a single node"),
    nodeIds: z.array(z.string()).optional().describe("IDs of multiple nodes")
  },
  async ({ styleId, nodeId, nodeIds }) => {
    try {
      const result = await sendCommandToFigma("apply_grid_style", {
        styleId,
        nodeId,
        nodeIds
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error applying grid style", error);
    }
  }
);
server.tool(
  "set_export_settings",
  "Replace the export settings stored on a node (the Export panel in Figma). Pass settings: [] to remove all. This only configures exports; to export now use export_node_as_image or download_design_assets.",
  {
    nodeId: z.string().describe("ID of the node"),
    settings: z.array(
      z.object({
        format: z.enum(["PNG", "JPG", "SVG", "PDF"]),
        suffix: z.string().optional().describe("File name suffix, e.g. '@2x'"),
        constraint: z.object({
          type: z.enum(["SCALE", "WIDTH", "HEIGHT"]),
          value: z.number().positive()
        }).optional().describe("PNG/JPG only: scale factor or target width/height in pixels"),
        contentsOnly: z.boolean().optional().describe("Export only the node contents (default true)"),
        useAbsoluteBounds: z.boolean().optional().describe("Use the full node bounds, even if cropped or empty"),
        colorProfile: z.enum(["DOCUMENT", "SRGB", "DISPLAY_P3_V4"]).optional().describe("Color profile of the export"),
        svgOutlineText: z.boolean().optional().describe("SVG only: render text as outlines (default true)"),
        svgIdAttribute: z.boolean().optional().describe("SVG only: include layer names as id attributes"),
        svgSimplifyStroke: z.boolean().optional().describe("SVG only: simplify inside/outside strokes")
      })
    ).describe("Export settings, in panel order; [] removes all")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_export_settings", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting export settings", error);
    }
  }
);
server.tool(
  "create_slice",
  "Create a slice (an export region independent of layers). Add export formats to it with set_export_settings.",
  {
    x: z.number().describe("X position (relative to the parent)"),
    y: z.number().describe("Y position (relative to the parent)"),
    width: z.number().positive().describe("Width in pixels"),
    height: z.number().positive().describe("Height in pixels"),
    name: z.string().optional().describe("Layer name"),
    parentId: z.string().optional().describe("Optional parent node ID (default: current page)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_slice", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating slice", error);
    }
  }
);
var saveVersionShape = {
  title: z.string().trim().min(1).describe("Version title (non-empty)"),
  description: z.string().optional().describe("Optional version description")
};
server.tool(
  "save_version",
  "Save a named version to the file's version history. Changes made just before may not be included; save after edits settle.",
  saveVersionShape,
  async (params) => {
    try {
      const result = await sendCommandToFigma("save_version", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error saving version", error);
    }
  }
);
server.tool(
  "set_image_properties",
  "Change scaleMode, crop (imageTransform), tiling scale, rotation or filters of an IMAGE fill already on a node, without re-uploading the image. Fields not given are kept (when still valid for the scaleMode); filters are merged into the existing ones.",
  {
    nodeId: z.string().describe("Node whose image fill to change"),
    paintIndex: z.number().int().min(0).optional().describe("Index in the node's fills (default: first IMAGE fill)"),
    scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional().describe("New scale mode (default: keep current)"),
    ...imagePaintOptionsShape
  },
  async (params) => {
    try {
      if (params.scaleMode !== void 0) {
        checkImagePaintOptions(params.scaleMode, params);
      }
      const result = await sendCommandToFigma("set_image_properties", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting image properties", error);
    }
  }
);
server.tool(
  "duplicate_page",
  "Duplicate a page with all its content. Components on the copy become instances of the originals.",
  {
    pageId: z.string().describe("ID of the page to duplicate"),
    name: z.string().optional().describe("Name for the copy (default: Figma's)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("duplicate_page", params, 6e4);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error duplicating page", error);
    }
  }
);
server.tool(
  "get_style_usage",
  "List the nodes that use a style and in which field (fillStyleId, textStyleId, ...).",
  {
    styleId: z.string().describe("Style ID"),
    limit: z.number().int().min(1).max(1e3).optional().describe("Maximum consumers returned (default 200, max 1000)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("get_style_usage", params, 6e4);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting style usage", error);
    }
  }
);
server.tool(
  "get_viewport",
  "Get the current page's viewport: center, zoom (1 = 100%) and visible bounds.",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_viewport");
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting viewport", error);
    }
  }
);
server.tool(
  "set_viewport",
  "Move and/or zoom the viewport of the current page. To fit specific nodes, use set_focus or set_selections instead.",
  {
    center: z.object({ x: z.number(), y: z.number() }).optional().describe("Canvas point to center on"),
    zoom: z.number().positive().optional().describe("Zoom level (1 = 100%, 0.5 = 50%)")
  },
  async (params) => {
    try {
      if (params.center === void 0 && params.zoom === void 0) {
        throw new Error("Provide center and/or zoom");
      }
      const result = await sendCommandToFigma("set_viewport", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error setting viewport", error);
    }
  }
);
server.tool(
  "reorder_style",
  "Move a local style after another local style of the same type and folder in the styles list (Figma Design only).",
  {
    styleId: z.string().describe("Local style to move"),
    afterStyleId: z.string().nullable().optional().describe("Style to place it after; omit or null to move it first")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("reorder_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error reordering style", error);
    }
  }
);
server.tool(
  "reorder_style_folder",
  "Move a local style folder after another folder with the same parent (Figma Design only). Nested folders use the full '/'-delimited name.",
  {
    styleType: z.enum(["PAINT", "TEXT", "EFFECT", "GRID", "CUSTOM_ANIMATION"]).describe("Type of styles in the folder"),
    folder: z.string().min(1).describe("Folder to move, e.g. 'Brand/Primary'"),
    afterFolder: z.string().nullable().optional().describe("Folder to place it after; omit or null to move it first")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("reorder_style_folder", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error reordering style folder", error);
    }
  }
);
server.tool(
  "create_code_block",
  "Create a code block (FigJam only).",
  {
    code: z.string().describe("Code content"),
    codeLanguage: z.enum(CODE_BLOCK_LANGUAGES).optional().describe("Syntax highlighting language (default: Figma's)"),
    x: z.number().optional().describe("X position (default 0)"),
    y: z.number().optional().describe("Y position (default 0)"),
    parentId: z.string().optional().describe("Optional parent node ID (default: current page)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_code_block", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating code block", error);
    }
  }
);
var httpUrlSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), {
  message: "URL must use http or https"
});
server.tool(
  "create_link_preview",
  "Insert a link preview for a URL (FigJam only): an embed for oEmbed providers (e.g. YouTube), otherwise an unfurled card.",
  {
    url: httpUrlSchema.describe("http(s) URL to preview"),
    x: z.number().optional().describe("X position (default: where Figma places it)"),
    y: z.number().optional().describe("Y position (default: where Figma places it)"),
    parentId: z.string().optional().describe("Optional parent node ID (default: current page)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_link_preview", params, 6e4);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating link preview", error);
    }
  }
);
server.tool(
  "extend_library_collection",
  "Create an extended variable collection (inherits variables, allows overrides) from a library collection key or a local collection ID. Enterprise plan only.",
  {
    name: z.string().trim().min(1).describe("Name of the new extended collection"),
    collectionKey: z.string().optional().describe(
      "Key of a library or local collection (see get_library_variable_collections)"
    ),
    collectionId: z.string().optional().describe("ID of a local variable collection")
  },
  async (params) => {
    try {
      if (Boolean(params.collectionKey) === Boolean(params.collectionId)) {
        throw new Error("Provide exactly one of collectionKey or collectionId");
      }
      const result = await sendCommandToFigma("extend_library_collection", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error extending variable collection", error);
    }
  }
);
server.tool(
  "get_dev_resources",
  "List dev resources (links to code, docs, tickets) attached to a node, including inherited ones.",
  {
    nodeId: z.string().describe("Node ID"),
    includeChildren: z.boolean().optional().describe("Also include dev resources of descendants (default false)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("get_dev_resources", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting dev resources", error);
    }
  }
);
server.tool(
  "add_dev_resource",
  "Attach a dev resource link to a node. Fails if the node already has a resource with that URL.",
  {
    nodeId: z.string().describe("Node ID"),
    url: httpUrlSchema.describe("http(s) URL of the resource"),
    name: z.string().optional().describe("Display name (default: derived from the URL by Figma)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("add_dev_resource", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error adding dev resource", error);
    }
  }
);
server.tool(
  "edit_dev_resource",
  "Change the URL and/or name of a dev resource on a node. Inherited resources must be edited on their main component (inheritedNodeId).",
  {
    nodeId: z.string().describe("Node ID"),
    currentUrl: httpUrlSchema.describe("Current URL of the resource"),
    url: httpUrlSchema.optional().describe("New http(s) URL"),
    name: z.string().optional().describe("New display name")
  },
  async (params) => {
    try {
      if (params.url === void 0 && params.name === void 0) {
        throw new Error("Provide url and/or name to change");
      }
      const result = await sendCommandToFigma("edit_dev_resource", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error editing dev resource", error);
    }
  }
);
server.tool(
  "delete_dev_resource",
  "Remove a dev resource from a node by URL.",
  {
    nodeId: z.string().describe("Node ID"),
    url: httpUrlSchema.describe("URL of the resource to remove")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("delete_dev_resource", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error deleting dev resource", error);
    }
  }
);
server.tool(
  "get_annotation_categories",
  "List the annotation categories in the file (id, label, color, isPreset). Use the id as categoryId in set_annotation.",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_annotation_categories");
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting annotation categories", error);
    }
  }
);
server.tool(
  "create_annotation_category",
  "Create an annotation category.",
  {
    label: z.string().trim().min(1).describe("Category label"),
    color: z.enum(ANNOTATION_CATEGORY_COLORS).describe("Category color")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("create_annotation_category", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error creating annotation category", error);
    }
  }
);
var measurementSideSchema = z.enum(["TOP", "RIGHT", "BOTTOM", "LEFT"]);
var measurementOffsetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("INNER"),
    relative: z.number().describe("Position along the measured edge, relative")
  }),
  z.object({
    type: z.literal("OUTER"),
    fixed: z.number().describe("Fixed distance outside the nodes, in pixels")
  })
]);
server.tool(
  "get_measurements",
  "List Dev Mode measurements on the current page, optionally only those touching a node. Read-only and works in the design editor; creating/editing measurements is Dev Mode only and not available with the current plugin manifest.",
  {
    nodeId: z.string().optional().describe("Only measurements that start or end at this node")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("get_measurements", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error getting measurements", error);
    }
  }
);
server.tool(
  "add_measurement",
  "Add a measurement between two nodes on the current page. Both sides must be on the same axis (LEFT/RIGHT or TOP/BOTTOM). Dev Mode only \u2014 not available with the current plugin manifest (editorType figma/figjam); will return an error.",
  {
    startNodeId: z.string().describe("Start node ID"),
    startSide: measurementSideSchema.describe("Edge of the start node"),
    endNodeId: z.string().describe("End node ID"),
    endSide: measurementSideSchema.describe("Edge of the end node"),
    offset: measurementOffsetSchema.optional().describe("Label offset (default { type: 'INNER', relative: 0 })"),
    freeText: z.string().optional().describe("Custom label text")
  },
  async (params) => {
    try {
      const horizontal = (side) => side === "LEFT" || side === "RIGHT";
      if (horizontal(params.startSide) !== horizontal(params.endSide)) {
        throw new Error(
          "startSide and endSide must be on the same axis (LEFT/RIGHT or TOP/BOTTOM)"
        );
      }
      const result = await sendCommandToFigma("add_measurement", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error adding measurement", error);
    }
  }
);
server.tool(
  "edit_measurement",
  "Change a measurement's offset and/or label text. Dev Mode only \u2014 not available with the current plugin manifest (editorType figma/figjam); will return an error.",
  {
    measurementId: z.string().describe("Measurement ID (see get_measurements)"),
    offset: measurementOffsetSchema.optional().describe("New label offset"),
    freeText: z.string().optional().describe("New label text")
  },
  async (params) => {
    try {
      if (params.offset === void 0 && params.freeText === void 0) {
        throw new Error("Provide offset and/or freeText to change");
      }
      const result = await sendCommandToFigma("edit_measurement", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error editing measurement", error);
    }
  }
);
server.tool(
  "delete_measurement",
  "Delete a measurement from the current page. Dev Mode only \u2014 not available with the current plugin manifest (editorType figma/figjam); will return an error.",
  {
    measurementId: z.string().describe("Measurement ID (see get_measurements)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("delete_measurement", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult("Error deleting measurement", error);
    }
  }
);
var DESIGN_SPEC_NOTE = "Spec format: each node references shared values in `styles` by id (layout*, fill*, stroke*, effect*, text*). Layout values are CSS-like (flex, gap, padding, sizing fill/hug/fixed). `exportAs: svg` marks icons/vectors to export as assets instead of rebuilding them; `assets` lists icons and image fills to download with download_design_assets. `designStyles` and `variables` give design-token names to map onto the project's theme.";
function formatRestVariableValue(value) {
  if (value && typeof value === "object") {
    if (value.type === "VARIABLE_ALIAS") return { aliasOf: value.id };
    if ("r" in value && "g" in value && "b" in value) {
      const r = Math.round(value.r * 255);
      const g = Math.round(value.g * 255);
      const b = Math.round(value.b * 255);
      const a = value.a ?? 1;
      return a >= 1 ? `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1e3) / 1e3})`;
    }
  }
  return value;
}
async function loadRestVariables(token, fileKey) {
  try {
    const data = await getLocalVariables(token, fileKey);
    const collections = data.meta?.variableCollections || {};
    const out = {};
    for (const [id, v] of Object.entries(data.meta?.variables || {})) {
      const collection = collections[v.variableCollectionId];
      const modeNames = {};
      for (const m of collection?.modes || []) modeNames[m.modeId] = m.name;
      const valuesByMode = {};
      for (const [modeId, value] of Object.entries(v.valuesByMode || {})) {
        valuesByMode[modeNames[modeId] || modeId] = formatRestVariableValue(value);
      }
      out[id] = {
        name: v.name,
        collection: collection?.name,
        resolvedType: v.resolvedType,
        valuesByMode
      };
    }
    return out;
  } catch (error) {
    logger.debug(
      `Variables endpoint unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
    return void 0;
  }
}
function requireFigmaToken() {
  const token = getFigmaToken();
  if (!token) {
    throw new Error(
      "FIGMA_ACCESS_TOKEN is not set. Create a personal access token in Figma (Settings > Security > Personal access tokens, scope file_content:read) and pass it to the MCP server environment."
    );
  }
  return token;
}
function resolveFileTarget(url, fileKey, nodeId) {
  if (url) {
    const parsed = parseFigmaUrl(url);
    return {
      fileKey: parsed.fileKey,
      nodeIds: nodeId ? [normalizeNodeId(nodeId)] : parsed.nodeId ? [parsed.nodeId] : []
    };
  }
  if (!fileKey) {
    throw new Error("Provide either a Figma url or a fileKey");
  }
  return { fileKey, nodeIds: nodeId ? [normalizeNodeId(nodeId)] : [] };
}
server.tool(
  "get_design_context",
  `Read a Figma design from the open file through the plugin and return a compact, code-oriented spec (layout, styles, text, components, variables, assets) for generating UI code. Uses the given nodeIds or the current selection. ${DESIGN_SPEC_NOTE}`,
  {
    nodeIds: z.array(z.string()).optional().describe("Node IDs to read. Defaults to the current selection in Figma."),
    maxDepth: z.number().int().min(0).optional().describe("Maximum depth of children to include (default: unlimited)"),
    includeHidden: z.boolean().optional().describe("Include hidden layers (default: false)")
  },
  async ({ nodeIds, maxDepth, includeHidden }) => {
    try {
      const result = await sendCommandToFigma(
        "get_design_context",
        { nodeIds, maxDepth, includeHidden },
        6e4
      );
      const spec = simplifyBundles(result.bundles, {
        maxDepth,
        includeHidden,
        variables: result.variables
      });
      return jsonResult({
        source: "plugin",
        fileName: result.fileName,
        page: result.page,
        ...spec
      });
    } catch (error) {
      return errorResult("Error getting design context", error);
    }
  }
);
server.tool(
  "get_figma_design_from_url",
  `Read a Figma design through the Figma REST API (no plugin needed, requires FIGMA_ACCESS_TOKEN). Pass a Figma URL (figma.com/design/<fileKey>/...?node-id=1-2) or fileKey + nodeId. With a node it returns the code-oriented spec; without a node it returns the file outline (pages and top-level frames) so you can pick one. ${DESIGN_SPEC_NOTE}`,
  {
    url: z.string().optional().describe("Figma file/design URL, optionally with ?node-id="),
    fileKey: z.string().optional().describe("Figma file key (alternative to url)"),
    nodeId: z.string().optional().describe("Node ID such as 1:2 or 1-2 (overrides node-id in url)"),
    maxDepth: z.number().int().min(0).optional().describe("Maximum depth of children to include (default: unlimited)"),
    includeHidden: z.boolean().optional().describe("Include hidden layers (default: false)")
  },
  async ({ url, fileKey, nodeId, maxDepth, includeHidden }) => {
    try {
      const token = requireFigmaToken();
      const target = resolveFileTarget(url, fileKey, nodeId);
      if (target.nodeIds.length === 0) {
        const file = await getFileOutline(token, target.fileKey, 2);
        const pages = (file.document?.children || []).map((page) => ({
          id: page.id,
          name: page.name,
          frames: (page.children || []).map((n) => ({
            id: n.id,
            name: n.name,
            type: n.type
          }))
        }));
        return jsonResult({
          source: "rest",
          fileKey: target.fileKey,
          fileName: file.name,
          lastModified: file.lastModified,
          pages,
          hint: "Call again with nodeId of the frame to convert into code."
        });
      }
      const data = await getFileNodes(
        token,
        target.fileKey,
        target.nodeIds,
        maxDepth !== void 0 ? maxDepth + 1 : void 0
      );
      const bundles = target.nodeIds.map((id) => {
        const entry = data.nodes?.[id];
        if (!entry || !entry.document) {
          throw new Error(`Node ${id} not found in file ${target.fileKey}`);
        }
        return entry;
      });
      const variables = await loadRestVariables(token, target.fileKey);
      const spec = simplifyBundles(bundles, {
        maxDepth,
        includeHidden,
        variables
      });
      return jsonResult({
        source: "rest",
        fileKey: target.fileKey,
        fileName: data.name,
        lastModified: data.lastModified,
        ...spec
      });
    } catch (error) {
      return errorResult("Error reading Figma design", error);
    }
  }
);
var assetItemSchema = z.object({
  nodeId: z.string().optional().describe("Node ID to render (icons, illustrations, frames)"),
  imageRef: z.string().optional().describe("imageRef of an image fill (from spec.assets.images) to download the original bitmap"),
  fileName: z.string().describe("File name to write, e.g. 'arrow-left.svg' or 'hero.png' (no directories)"),
  format: z.enum(["svg", "png", "jpg", "pdf"]).optional().describe("Render format for nodeId (default: from file extension, else png)"),
  scale: z.number().positive().max(4).optional().describe("Scale for png/jpg renders (default: 2)")
});
function safeAssetPath(dir, fileName) {
  const base = path.basename(fileName);
  if (!base || base !== fileName || base === "." || base === "..") {
    throw new Error(`Invalid fileName "${fileName}": use a plain file name without directories`);
  }
  return path.join(dir, base);
}
function inferFormat(item) {
  if (item.format) return item.format;
  const ext = path.extname(item.fileName).slice(1).toLowerCase();
  if (ext === "svg" || ext === "png" || ext === "pdf") return ext;
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  return "png";
}
server.tool(
  "download_design_assets",
  "Download icons, illustrations and image fills from a Figma design into a local folder so generated code can reference them. Use source 'plugin' for designs read with get_design_context, or 'rest' (with url/fileKey) for designs read with get_figma_design_from_url.",
  {
    source: z.enum(["plugin", "rest"]).describe("Where to read the assets from"),
    url: z.string().optional().describe("Figma URL (rest source)"),
    fileKey: z.string().optional().describe("Figma file key (rest source)"),
    localPath: z.string().describe("Directory to write files to (absolute, or relative to the MCP server working directory). Created if missing."),
    items: z.array(assetItemSchema).min(1).max(50)
  },
  async ({ source, url, fileKey, localPath, items }) => {
    try {
      const dir = path.resolve(process.cwd(), localPath);
      for (const item of items) {
        if (!item.nodeId && !item.imageRef) {
          throw new Error(`Item "${item.fileName}" needs nodeId or imageRef`);
        }
        safeAssetPath(dir, item.fileName);
      }
      await mkdir(dir, { recursive: true });
      const written = [];
      if (source === "plugin") {
        const result = await sendCommandToFigma(
          "export_node_assets",
          {
            items: items.map((item) => ({
              nodeId: item.nodeId,
              imageRef: item.imageRef,
              format: item.imageRef ? void 0 : inferFormat(item).toUpperCase(),
              scale: item.scale ?? 2
            }))
          },
          12e4
        );
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const res = result.results[i];
          if (!res || !res.success || !res.data) {
            written.push({ fileName: item.fileName, error: res?.error || "Export failed" });
            continue;
          }
          const filePath = safeAssetPath(dir, item.fileName);
          await writeFile(filePath, Buffer.from(res.data, "base64"));
          written.push({ fileName: item.fileName, path: filePath });
        }
      } else {
        const token = requireFigmaToken();
        const target = resolveFileTarget(url, fileKey);
        const renderUrls = {};
        const groups = /* @__PURE__ */ new Map();
        for (const item of items.filter((i) => i.nodeId && !i.imageRef)) {
          const format = inferFormat(item);
          const scale = format === "svg" ? 1 : item.scale ?? 2;
          const key = `${format}@${scale}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        for (const [key, groupItems] of groups) {
          const [format, scale] = key.split("@");
          const urls = await getImageRenderUrls(
            token,
            target.fileKey,
            groupItems.map((i) => normalizeNodeId(i.nodeId)),
            format,
            Number(scale)
          );
          for (const i of groupItems) {
            renderUrls[i.fileName] = urls[normalizeNodeId(i.nodeId)] ?? null;
          }
        }
        const needsFills = items.some((i) => i.imageRef);
        const fillUrls = needsFills ? await getImageFillUrls(token, target.fileKey) : {};
        for (const item of items) {
          try {
            const sourceUrl = item.imageRef ? fillUrls[item.imageRef] : renderUrls[item.fileName];
            if (!sourceUrl) {
              throw new Error(
                item.imageRef ? `No image found for imageRef ${item.imageRef}` : `Figma could not render node ${item.nodeId}`
              );
            }
            const bytes = await downloadBytes(sourceUrl);
            const filePath = safeAssetPath(dir, item.fileName);
            await writeFile(filePath, bytes);
            written.push({ fileName: item.fileName, path: filePath });
          } catch (error) {
            written.push({
              fileName: item.fileName,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
      return jsonResult({
        directory: dir,
        saved: written.filter((w) => w.path).length,
        failed: written.filter((w) => w.error).length,
        files: written
      });
    } catch (error) {
      return errorResult("Error downloading design assets", error);
    }
  }
);
var REST_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
var restFileSchema = {
  fileUrl: z.string().optional().describe("Figma file/design URL (alternative to fileKey)"),
  fileKey: z.string().regex(REST_KEY_PATTERN, "fileKey may only contain letters, digits, _ and -").optional().describe("Figma file key (alternative to fileUrl)")
};
function resolveRestFileKey(fileUrl, fileKey) {
  const key = resolveFileTarget(fileUrl, fileKey).fileKey;
  if (!REST_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid Figma file key: ${key}`);
  }
  return key;
}
var teamPageSchema = {
  teamId: z.string().regex(REST_KEY_PATTERN, "teamId may only contain letters, digits, _ and -").describe("Team ID, from figma.com/files/team/<teamId>/..."),
  pageSize: z.number().int().min(1).max(1e3).optional().describe("Items per page (Figma default 30)"),
  cursor: z.number().int().optional().describe("Pagination cursor: nextCursor from the previous page")
};
function summarizeTeamLibraryItem(item) {
  return {
    key: item.key,
    name: item.name,
    description: item.description || void 0,
    styleType: item.style_type,
    fileKey: item.file_key,
    nodeId: item.node_id,
    containingFrame: item.containing_frame?.name,
    containingPage: item.containing_frame?.pageName,
    componentSet: item.containing_frame?.containingComponentSet?.name,
    thumbnailUrl: item.thumbnail_url
  };
}
server.tool(
  "get_comments",
  "Read the comments of a Figma file through the REST API (requires FIGMA_ACCESS_TOKEN with file_comments:read). Replies carry parentId; nodeId is set for comments pinned to a node.",
  { ...restFileSchema },
  async ({ fileUrl, fileKey }) => {
    try {
      const token = requireFigmaToken();
      const target = { fileKey: resolveRestFileKey(fileUrl, fileKey) };
      const data = await getFileComments(token, target.fileKey);
      const comments = (data.comments || []).map((c) => ({
        id: c.id,
        message: c.message,
        user: c.user?.handle,
        createdAt: c.created_at,
        resolvedAt: c.resolved_at || null,
        nodeId: c.client_meta?.node_id,
        parentId: c.parent_id || void 0
      }));
      return jsonResult({
        fileKey: target.fileKey,
        count: comments.length,
        comments
      });
    } catch (error) {
      return errorResult("Error reading comments", error);
    }
  }
);
server.tool(
  "post_comment",
  "Post a REAL comment (or a reply) to a Figma file through the REST API. The comment is published under the token owner's account and is immediately visible to every collaborator, and may trigger notifications; only use it when the user explicitly asks to comment. Requires FIGMA_ACCESS_TOKEN with file_comments:write.",
  {
    ...restFileSchema,
    message: z.string().min(1).max(5e3).describe("Comment text"),
    nodeId: z.string().regex(/^[A-Za-z0-9:;_-]+$/, "nodeId must look like 1:2, 1-2 or I1:2;3:4").optional().describe("Pin a new comment thread to this node (e.g. 1:2 or 1-2); not allowed with commentId"),
    commentId: z.string().regex(/^\d+$/, "commentId must be numeric").optional().describe("Reply to this top-level comment ID instead of starting a thread")
  },
  async ({ fileUrl, fileKey, message, nodeId, commentId }) => {
    try {
      if (commentId && nodeId) {
        throw new Error(
          "commentId and nodeId cannot be combined: a reply inherits the position of its thread"
        );
      }
      const token = requireFigmaToken();
      const target = { fileKey: resolveRestFileKey(fileUrl, fileKey) };
      const body = { message };
      if (commentId) body.comment_id = commentId;
      else if (nodeId) {
        body.client_meta = {
          node_id: normalizeNodeId(nodeId),
          node_offset: { x: 0, y: 0 }
        };
      }
      const c = await postFileComment(token, target.fileKey, body);
      return jsonResult({
        fileKey: target.fileKey,
        id: c.id,
        message: c.message,
        user: c.user?.handle,
        createdAt: c.created_at,
        nodeId: c.client_meta?.node_id,
        parentId: c.parent_id || void 0
      });
    } catch (error) {
      return errorResult("Error posting comment", error);
    }
  }
);
server.tool(
  "get_file_versions",
  "List the version history of a Figma file through the REST API (requires FIGMA_ACCESS_TOKEN), newest first. Paginated: pass a version id as before (older) or after (newer); see pagination in the result.",
  {
    ...restFileSchema,
    pageSize: z.number().int().min(1).max(50).optional().describe("Versions per page (Figma default 30, max 50)"),
    before: z.number().int().optional().describe("Only versions created before this version id"),
    after: z.number().int().optional().describe("Only versions created after this version id")
  },
  async ({ fileUrl, fileKey, pageSize, before, after }) => {
    try {
      const token = requireFigmaToken();
      const target = { fileKey: resolveRestFileKey(fileUrl, fileKey) };
      const data = await getFileVersions(token, target.fileKey, {
        pageSize,
        before,
        after
      });
      const versions = (data.versions || []).map((v) => ({
        id: v.id,
        label: v.label || null,
        description: v.description || null,
        createdAt: v.created_at,
        user: v.user?.handle
      }));
      return jsonResult({
        fileKey: target.fileKey,
        count: versions.length,
        versions,
        pagination: data.pagination || null
      });
    } catch (error) {
      return errorResult("Error reading file versions", error);
    }
  }
);
server.tool(
  "get_team_components",
  "List the published components of a team library through the REST API (requires FIGMA_ACCESS_TOKEN with team_library_content:read). Use the key with create_component_instance. Paginated: pass nextCursor as cursor to get the next page.",
  { ...teamPageSchema },
  async ({ teamId, pageSize, cursor }) => {
    try {
      const token = requireFigmaToken();
      const data = await getTeamComponents(token, teamId, {
        pageSize,
        after: cursor
      });
      const items = data.meta?.components || [];
      return jsonResult({
        teamId,
        count: items.length,
        nextCursor: data.meta?.cursor?.after ?? null,
        components: items.map(summarizeTeamLibraryItem)
      });
    } catch (error) {
      return errorResult("Error reading team components", error);
    }
  }
);
server.tool(
  "get_team_styles",
  "List the published styles of a team library through the REST API (requires FIGMA_ACCESS_TOKEN with team_library_content:read). Use the key with import_style_by_key. Paginated: pass nextCursor as cursor to get the next page.",
  { ...teamPageSchema },
  async ({ teamId, pageSize, cursor }) => {
    try {
      const token = requireFigmaToken();
      const data = await getTeamStyles(token, teamId, {
        pageSize,
        after: cursor
      });
      const items = data.meta?.styles || [];
      return jsonResult({
        teamId,
        count: items.length,
        nextCursor: data.meta?.cursor?.after ?? null,
        styles: items.map(summarizeTeamLibraryItem)
      });
    } catch (error) {
      return errorResult("Error reading team styles", error);
    }
  }
);
var restNodeIdSchema = z.string().regex(/^[A-Za-z0-9:;_-]+$/, "nodeId must look like 1:2, 1-2 or I1:2;3:4");
server.tool(
  "get_team_projects",
  "List the projects of a team through the REST API (requires FIGMA_ACCESS_TOKEN with projects:read). Use a project id with get_project_files.",
  {
    teamId: teamPageSchema.teamId
  },
  async ({ teamId }) => {
    try {
      const token = requireFigmaToken();
      const data = await getTeamProjects(token, teamId);
      const projects = (data.projects || []).map((p) => ({
        id: String(p.id),
        name: p.name
      }));
      return jsonResult({
        teamId,
        teamName: data.name,
        count: projects.length,
        projects
      });
    } catch (error) {
      return errorResult("Error reading team projects", error);
    }
  }
);
server.tool(
  "get_project_files",
  "List the files of a project through the REST API (requires FIGMA_ACCESS_TOKEN with projects:read). Use a file key with the other REST tools.",
  {
    projectId: z.string().regex(/^\d+$/, "projectId must be numeric").describe("Project ID, from get_team_projects or figma.com/files/project/<projectId>"),
    branchData: z.boolean().optional().describe("Also list the branches of each file (default false)")
  },
  async ({ projectId, branchData }) => {
    try {
      const token = requireFigmaToken();
      const data = await getProjectFiles(token, projectId, branchData === true);
      const files = (data.files || []).map((f) => ({
        key: f.key,
        name: f.name,
        lastModified: f.last_modified,
        thumbnailUrl: f.thumbnail_url,
        branches: f.branches
      }));
      return jsonResult({
        projectId,
        projectName: data.name,
        count: files.length,
        files
      });
    } catch (error) {
      return errorResult("Error reading project files", error);
    }
  }
);
server.tool(
  "get_file_dev_resources",
  "List the dev resources (links shown in Dev Mode) of a Figma file through the REST API (requires FIGMA_ACCESS_TOKEN with file_dev_resources:read). Optionally only for some nodes.",
  {
    ...restFileSchema,
    nodeIds: z.array(restNodeIdSchema).optional().describe("Only return dev resources attached to these nodes (e.g. 1:2 or 1-2)")
  },
  async ({ fileUrl, fileKey, nodeIds }) => {
    try {
      const token = requireFigmaToken();
      const target = { fileKey: resolveRestFileKey(fileUrl, fileKey) };
      const data = await getDevResources(
        token,
        target.fileKey,
        (nodeIds || []).map(normalizeNodeId)
      );
      const devResources = (data.dev_resources || []).map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        nodeId: r.node_id
      }));
      return jsonResult({
        fileKey: target.fileKey,
        count: devResources.length,
        devResources
      });
    } catch (error) {
      return errorResult("Error reading dev resources", error);
    }
  }
);
server.tool(
  "create_file_dev_resources",
  "Attach REAL dev resources (links shown in Dev Mode) to nodes of a Figma file through the REST API. They are immediately visible to every collaborator; only use it when the user explicitly asks. Requires FIGMA_ACCESS_TOKEN with file_dev_resources:write.",
  {
    ...restFileSchema,
    devResources: z.array(
      z.object({
        nodeId: restNodeIdSchema.describe("Node to attach the link to (e.g. 1:2 or 1-2)"),
        name: z.string().min(1).max(500).describe("Link title"),
        url: httpUrlSchema.describe("Link URL (http or https)")
      })
    ).min(1).max(50).describe("Dev resources to create (max 50)")
  },
  async ({ fileUrl, fileKey, devResources }) => {
    try {
      const token = requireFigmaToken();
      const target = { fileKey: resolveRestFileKey(fileUrl, fileKey) };
      const data = await createDevResources(
        token,
        devResources.map((r) => ({
          name: r.name,
          url: r.url,
          file_key: target.fileKey,
          node_id: normalizeNodeId(r.nodeId)
        }))
      );
      const created = (data.links_created || []).map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        nodeId: r.node_id
      }));
      const errors = (data.errors || []).map((e) => ({
        nodeId: e.node_id,
        error: e.error
      }));
      return jsonResult({
        fileKey: target.fileKey,
        createdCount: created.length,
        created,
        errors
      });
    } catch (error) {
      return errorResult("Error creating dev resources", error);
    }
  }
);
server.tool(
  "delete_file_dev_resource",
  "Permanently delete a dev resource (Dev Mode link) from a Figma file through the REST API; only use it when the user explicitly asks. Requires FIGMA_ACCESS_TOKEN with file_dev_resources:write.",
  {
    ...restFileSchema,
    devResourceId: z.string().regex(REST_KEY_PATTERN, "devResourceId may only contain letters, digits, _ and -").describe("Dev resource id, from get_file_dev_resources")
  },
  async ({ fileUrl, fileKey, devResourceId }) => {
    try {
      const token = requireFigmaToken();
      const target = { fileKey: resolveRestFileKey(fileUrl, fileKey) };
      await deleteDevResource(token, target.fileKey, devResourceId);
      return jsonResult({
        fileKey: target.fileKey,
        devResourceId,
        deleted: true
      });
    } catch (error) {
      return errorResult("Error deleting dev resource", error);
    }
  }
);
function registerPluginResource(name, uri, description, command) {
  server.resource(
    name,
    uri,
    { description, mimeType: "application/json" },
    async (resourceUri) => {
      let result;
      try {
        result = await sendCommandToFigma(command);
      } catch (error) {
        throw new Error(
          `Could not read ${uri} from the Figma plugin: ${(error instanceof Error ? error.message : String(error)).replace(/\.+$/, "")}. Make sure the relay is running, the plugin is open in Figma and join_channel was called.`
        );
      }
      return {
        contents: [
          {
            uri: resourceUri.href,
            mimeType: "application/json",
            text: JSON.stringify(result)
          }
        ]
      };
    }
  );
}
registerPluginResource(
  "document",
  "figma://document",
  "Current Figma document and page info (same as get_document_info)",
  "get_document_info"
);
registerPluginResource(
  "selection",
  "figma://selection",
  "Current selection in Figma (same as get_selection)",
  "get_selection"
);
registerPluginResource(
  "styles",
  "figma://styles",
  "Local paint, text, effect and grid styles (same as get_styles)",
  "get_styles"
);
registerPluginResource(
  "variables",
  "figma://variables",
  "Local variable collections and variables (same as get_local_variables)",
  "get_local_variables"
);
registerPluginResource(
  "pages",
  "figma://pages",
  "Pages of the current document (same as get_pages)",
  "get_pages"
);
server.prompt(
  "design_to_code",
  "Workflow for turning a Figma design into code",
  () => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When generating code from a Figma design:

1. Read the design:
   - Figma open with the plugin connected: join_channel, then get_design_context (uses the selection, or pass nodeIds).
   - Only a Figma link: get_figma_design_from_url with the url (needs FIGMA_ACCESS_TOKEN). Without node-id it returns the page/frame outline first.
   - For large screens, read with maxDepth first, then read child nodes separately.
2. Look at the design: export_node_as_image (plugin) for a visual reference to compare against.
3. Follow the project, not Figma: reuse existing components, theme tokens, and the styling approach already in the codebase. Map designStyles/variables names to existing tokens before writing raw values.
4. Translate the spec:
   - layout display/flexDirection/gap/padding \u2192 flexbox; sizing fill \u2192 flex: 1 / width: 100%, hug \u2192 auto, fixed \u2192 explicit size.
   - position: absolute only where the spec says so (non auto-layout parents).
   - INSTANCE nodes with component.name \u2192 reuse/create one component per main component, props from component.properties.
   - richText segments \u2192 nested inline elements.
5. Assets: nodes with exportAs: svg and spec.assets.images \u2192 download_design_assets into the project's asset folder; never redraw icons with divs.
6. Verify: build/lint the project and compare the result with the exported image.`
          }
        }
      ],
      description: "Workflow for turning a Figma design into code"
    };
  }
);
server.tool(
  "join_channel",
  "Join a specific channel to communicate with Figma",
  {
    channel: z.string().describe("The name of the channel to join").default("")
  },
  async ({ channel }) => {
    try {
      if (!channel) {
        return {
          content: [
            {
              type: "text",
              text: "Please provide a channel name to join:"
            }
          ],
          followUp: {
            tool: "join_channel",
            description: "Join the specified channel"
          }
        };
      }
      await joinChannel(channel);
      return {
        content: [
          {
            type: "text",
            text: `Successfully joined channel: ${channel}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error joining channel: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);
async function main() {
  try {
    connectToFigma();
  } catch (error) {
    logger.warn(
      `Could not connect to Figma initially: ${error instanceof Error ? error.message : String(error)}`
    );
    logger.warn("Will try to connect when the first command is sent");
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("FigmaMCP server running on stdio");
  process.stdin.on("end", () => shutdown("stdin closed"));
  process.stdin.on("close", () => shutdown("stdin closed"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
main().catch((error) => {
  logger.error(
    `Error starting FigmaMCP server: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
//# sourceMappingURL=server.js.map