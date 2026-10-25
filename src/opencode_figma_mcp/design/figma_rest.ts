// Minimal Figma REST API client used to read designs without the plugin.

const API_BASE = "https://api.figma.com/v1";

export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
}

export function getFigmaToken(): string | undefined {
  return (
    process.env.FIGMA_ACCESS_TOKEN ||
    process.env.FIGMA_API_KEY ||
    process.env.FIGMA_TOKEN ||
    undefined
  );
}

// Accepts figma.com/design|file|proto|board/<key>/... (incl. /branch/<branchKey>/)
// and normalises node-id "1-2" to "1:2".
export function parseFigmaUrl(input: string): ParsedFigmaUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid Figma URL: ${input}`);
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) {
    throw new Error(`Not a figma.com URL: ${input}`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const kindIndex = parts.findIndex((p) =>
    ["design", "file", "proto", "board"].includes(p),
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
    nodeId: rawNodeId ? normalizeNodeId(rawNodeId) : undefined,
  };
}

export function normalizeNodeId(nodeId: string): string {
  return nodeId.includes(":") ? nodeId : nodeId.replace("-", ":");
}

async function figmaGet(path: string, token: string): Promise<any> {
  return figmaRequest("GET", path, token);
}

async function figmaRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  token: string,
  body?: unknown,
): Promise<any> {
  const headers: Record<string, string> = { "X-Figma-Token": token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.err || parsed.message || text;
    } catch {
      // keep raw body
    }
    const hint =
      res.status === 403
        ? " (check that FIGMA_ACCESS_TOKEN is valid and has access to this file)"
        : res.status === 429
          ? " (Figma rate limit reached, try again later)"
          : "";
    const shortDetail =
      String(detail).length > 500 ? `${String(detail).slice(0, 500)}…` : detail;
    throw new Error(`Figma API ${res.status}: ${shortDetail}${hint}`);
  }
  // DELETE endpoints may answer with an empty body
  return text ? JSON.parse(text) : {};
}

export async function getFileNodes(
  token: string,
  fileKey: string,
  nodeIds: string[],
  depth?: number,
): Promise<{ name: string; lastModified: string; nodes: Record<string, any> }> {
  const params = new URLSearchParams({ ids: nodeIds.join(",") });
  if (depth !== undefined) params.set("depth", String(depth));
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/nodes?${params}`, token);
}

export async function getFileOutline(token: string, fileKey: string, depth = 2): Promise<any> {
  return figmaGet(`/files/${encodeURIComponent(fileKey)}?depth=${depth}`, token);
}

export async function getImageRenderUrls(
  token: string,
  fileKey: string,
  nodeIds: string[],
  format: "svg" | "png" | "jpg" | "pdf",
  scale = 1,
): Promise<Record<string, string | null>> {
  const params = new URLSearchParams({ ids: nodeIds.join(","), format });
  if (format !== "svg") params.set("scale", String(scale));
  const data = await figmaGet(`/images/${encodeURIComponent(fileKey)}?${params}`, token);
  if (data.err) throw new Error(`Figma image render error: ${data.err}`);
  return data.images || {};
}

export async function getImageFillUrls(token: string, fileKey: string): Promise<Record<string, string>> {
  const data = await figmaGet(`/files/${encodeURIComponent(fileKey)}/images`, token);
  return data.meta?.images || {};
}

// Local variables endpoint is Enterprise-only; callers should treat failure as non-fatal.
export async function getLocalVariables(token: string, fileKey: string): Promise<any> {
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/variables/local`, token);
}

export async function getFileComments(token: string, fileKey: string): Promise<any> {
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/comments`, token);
}

export interface PostCommentBody {
  message: string;
  comment_id?: string;
  client_meta?: { node_id: string; node_offset: { x: number; y: number } };
}

export async function postFileComment(
  token: string,
  fileKey: string,
  body: PostCommentBody,
): Promise<any> {
  return figmaRequest("POST", `/files/${encodeURIComponent(fileKey)}/comments`, token, body);
}

export interface FileVersionsPage {
  pageSize?: number;
  before?: number;
  after?: number;
}

export async function getFileVersions(
  token: string,
  fileKey: string,
  page: FileVersionsPage = {},
): Promise<any> {
  const params = new URLSearchParams();
  if (page.pageSize !== undefined) params.set("page_size", String(page.pageSize));
  if (page.before !== undefined) params.set("before", String(page.before));
  if (page.after !== undefined) params.set("after", String(page.after));
  const query = params.toString();
  return figmaGet(
    `/files/${encodeURIComponent(fileKey)}/versions${query ? `?${query}` : ""}`,
    token,
  );
}

export interface TeamLibraryPage {
  pageSize?: number;
  after?: number;
}

function teamLibraryQuery(page: TeamLibraryPage): string {
  const params = new URLSearchParams();
  if (page.pageSize !== undefined) params.set("page_size", String(page.pageSize));
  if (page.after !== undefined) params.set("after", String(page.after));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getTeamComponents(
  token: string,
  teamId: string,
  page: TeamLibraryPage = {},
): Promise<any> {
  return figmaGet(
    `/teams/${encodeURIComponent(teamId)}/components${teamLibraryQuery(page)}`,
    token,
  );
}

export async function getTeamStyles(
  token: string,
  teamId: string,
  page: TeamLibraryPage = {},
): Promise<any> {
  return figmaGet(`/teams/${encodeURIComponent(teamId)}/styles${teamLibraryQuery(page)}`, token);
}

export async function getTeamProjects(token: string, teamId: string): Promise<any> {
  return figmaGet(`/teams/${encodeURIComponent(teamId)}/projects`, token);
}

export async function getProjectFiles(
  token: string,
  projectId: string,
  branchData = false,
): Promise<any> {
  const query = branchData ? "?branch_data=true" : "";
  return figmaGet(`/projects/${encodeURIComponent(projectId)}/files${query}`, token);
}

export async function getDevResources(
  token: string,
  fileKey: string,
  nodeIds: string[] = [],
): Promise<any> {
  const query = nodeIds.length
    ? `?${new URLSearchParams({ node_ids: nodeIds.join(",") })}`
    : "";
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/dev_resources${query}`, token);
}

export interface NewDevResource {
  name: string;
  url: string;
  file_key: string;
  node_id: string;
}

export async function createDevResources(
  token: string,
  devResources: NewDevResource[],
): Promise<any> {
  return figmaRequest("POST", "/dev_resources", token, { dev_resources: devResources });
}

export async function deleteDevResource(
  token: string,
  fileKey: string,
  devResourceId: string,
): Promise<any> {
  return figmaRequest(
    "DELETE",
    `/files/${encodeURIComponent(fileKey)}/dev_resources/${encodeURIComponent(devResourceId)}`,
    token,
  );
}

// Image URLs returned by Figma's /images endpoints are served from Figma or S3.
const DOWNLOAD_HOST_SUFFIXES = ["figma.com", "figmausercontent.com", "amazonaws.com"];

export function assertAllowedDownloadUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Download rejected: invalid URL ${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = DOWNLOAD_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  if (parsed.protocol !== "https:" || !allowed) {
    throw new Error(
      `Download rejected: ${url} is not an https URL on ${DOWNLOAD_HOST_SUFFIXES.join(", ")}`,
    );
  }
}

export async function downloadBytes(url: string): Promise<Uint8Array> {
  assertAllowedDownloadUrl(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}
