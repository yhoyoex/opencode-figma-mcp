import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createDevResources,
  deleteDevResource,
  downloadBytes,
  getDevResources,
  getFileComments,
  getProjectFiles,
  getTeamProjects,
  getFileNodes,
  getFileOutline,
  getFileVersions,
  getFigmaToken,
  getImageFillUrls,
  getImageRenderUrls,
  getLocalVariables,
  getTeamComponents,
  getTeamStyles,
  normalizeNodeId,
  parseFigmaUrl,
  postFileComment,
} from "../src/opencode_figma_mcp/design/figma_rest";

const realFetch = globalThis.fetch;
const TOKEN_ENV = ["FIGMA_ACCESS_TOKEN", "FIGMA_API_KEY", "FIGMA_TOKEN"] as const;
const savedEnv: Record<string, string | undefined> = {};

interface Call {
  url: string;
  init: any;
}
let calls: Call[];

function mockFetch(status: number, body: unknown) {
  calls = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status });
  }) as any;
}

beforeEach(() => {
  for (const k of TOKEN_ENV) savedEnv[k] = process.env[k];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of TOKEN_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("getFigmaToken", () => {
  test("mengembalikan undefined bila tidak ada env token", () => {
    for (const k of TOKEN_ENV) delete process.env[k];
    expect(getFigmaToken()).toBeUndefined();
  });

  test("memprioritaskan FIGMA_ACCESS_TOKEN di atas fallback", () => {
    process.env.FIGMA_ACCESS_TOKEN = "a";
    process.env.FIGMA_API_KEY = "b";
    process.env.FIGMA_TOKEN = "c";
    expect(getFigmaToken()).toBe("a");
  });

  test("jatuh ke FIGMA_API_KEY lalu FIGMA_TOKEN", () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    process.env.FIGMA_API_KEY = "b";
    process.env.FIGMA_TOKEN = "c";
    expect(getFigmaToken()).toBe("b");
    delete process.env.FIGMA_API_KEY;
    expect(getFigmaToken()).toBe("c");
  });
});

describe("parseFigmaUrl / normalizeNodeId", () => {
  test("mengurai file key dan node-id dengan normalisasi '1-2' -> '1:2'", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/ABC123/Name?node-id=1-2")).toEqual({
      fileKey: "ABC123",
      nodeId: "1:2",
    });
  });

  test("memakai branch key bila URL branch", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/MAIN/Name/branch/BR9/Name").fileKey).toBe("BR9");
  });

  test("nodeId undefined bila tanpa node-id", () => {
    expect(parseFigmaUrl("https://figma.com/file/KEY/x").nodeId).toBeUndefined();
  });

  test("menolak URL tidak valid, bukan figma.com, atau tanpa file key", () => {
    expect(() => parseFigmaUrl("bukan url")).toThrow("Invalid Figma URL");
    expect(() => parseFigmaUrl("https://evilfigma.com/design/K/x")).toThrow("Not a figma.com URL");
    expect(() => parseFigmaUrl("https://www.figma.com/community")).toThrow("Could not find a file key");
  });

  test("normalizeNodeId membiarkan id yang sudah memakai ':'", () => {
    expect(normalizeNodeId("3:4")).toBe("3:4");
    expect(normalizeNodeId("3-4")).toBe("3:4");
  });
});

describe("request dasar", () => {
  test("mengirim header X-Figma-Token dan method GET tanpa body", async () => {
    mockFetch(200, { ok: true });
    await getFileComments("tok_123", "KEY");
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/KEY/comments");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers["X-Figma-Token"]).toBe("tok_123");
    expect(calls[0].init.body).toBeUndefined();
  });

  test("path param di-encode dengan encodeURIComponent", async () => {
    mockFetch(200, {});
    await getFileComments("t", "a/b c?d");
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/a%2Fb%20c%3Fd/comments");
  });

  test("error memuat status dan pesan 'err' dari body JSON", async () => {
    mockFetch(404, { err: "Not found" });
    await expect(getFileComments("t", "K")).rejects.toThrow("Figma API 404: Not found");
  });

  test("403 menambahkan hint token, 429 menambahkan hint rate limit", async () => {
    mockFetch(403, { err: "Forbidden" });
    await expect(getFileComments("t", "K")).rejects.toThrow("check that FIGMA_ACCESS_TOKEN is valid");
    mockFetch(429, { message: "slow down" });
    await expect(getFileComments("t", "K")).rejects.toThrow("Figma API 429: slow down (Figma rate limit reached");
  });

  test("body error non-JSON dipakai apa adanya", async () => {
    mockFetch(500, "<html>boom</html>");
    await expect(getFileComments("t", "K")).rejects.toThrow("Figma API 500: <html>boom</html>");
  });

  test("body error dipotong 500 karakter dan diakhiri elipsis", async () => {
    mockFetch(500, "x".repeat(800));
    let msg = "";
    try {
      await getFileComments("t", "K");
    } catch (e: any) {
      msg = e.message;
    }
    expect(msg).toBe(`Figma API 500: ${"x".repeat(500)}…`);
  });
});

describe("endpoint file", () => {
  test("getFileNodes: ids digabung koma, depth opsional", async () => {
    mockFetch(200, { nodes: {} });
    await getFileNodes("t", "K", ["1:2", "3:4"], 2);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v1/files/K/nodes");
    expect(u.searchParams.get("ids")).toBe("1:2,3:4");
    expect(u.searchParams.get("depth")).toBe("2");

    mockFetch(200, { nodes: {} });
    await getFileNodes("t", "K", ["1:2"]);
    expect(new URL(calls[0].url).searchParams.has("depth")).toBe(false);
  });

  test("getFileOutline: depth default 2", async () => {
    mockFetch(200, {});
    await getFileOutline("t", "K");
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/K?depth=2");
    await getFileOutline("t", "K", 5);
    expect(calls[1].url).toBe("https://api.figma.com/v1/files/K?depth=5");
  });

  test("getImageRenderUrls: scale dikirim untuk png, tidak untuk svg", async () => {
    mockFetch(200, { images: { "1:2": "https://img/x.png" } });
    const out = await getImageRenderUrls("t", "K", ["1:2"], "png", 2);
    expect(out).toEqual({ "1:2": "https://img/x.png" });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get("format")).toBe("png");
    expect(u.searchParams.get("scale")).toBe("2");

    mockFetch(200, { images: {} });
    await getImageRenderUrls("t", "K", ["1:2"], "svg", 3);
    expect(new URL(calls[0].url).searchParams.has("scale")).toBe(false);
  });

  test("getImageRenderUrls: melempar bila respons memuat err", async () => {
    mockFetch(200, { err: "bad node" });
    await expect(getImageRenderUrls("t", "K", ["1:2"], "png")).rejects.toThrow(
      "Figma image render error: bad node",
    );
  });

  test("getImageFillUrls: mengembalikan meta.images, {} bila kosong", async () => {
    mockFetch(200, { meta: { images: { ref1: "https://u" } } });
    expect(await getImageFillUrls("t", "K")).toEqual({ ref1: "https://u" });
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/K/images");
    mockFetch(200, {});
    expect(await getImageFillUrls("t", "K")).toEqual({});
  });

  test("getLocalVariables memanggil /variables/local", async () => {
    mockFetch(200, { meta: {} });
    await getLocalVariables("t", "K");
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/K/variables/local");
  });
});

describe("comments", () => {
  test("postFileComment: POST dengan Content-Type JSON dan body ter-serialisasi", async () => {
    mockFetch(200, { id: "c1" });
    const body = {
      message: "halo",
      client_meta: { node_id: "1:2", node_offset: { x: 1, y: 2 } },
    };
    const res = await postFileComment("tok", "K", body);
    expect(res).toEqual({ id: "c1" });
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/K/comments");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(calls[0].init.headers["X-Figma-Token"]).toBe("tok");
    expect(JSON.parse(calls[0].init.body)).toEqual(body);
  });
});

describe("versions", () => {
  test("tanpa pagination: tidak ada query string", async () => {
    mockFetch(200, {});
    await getFileVersions("t", "K");
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/K/versions");
  });

  test("pageSize/before/after dipetakan ke page_size/before/after", async () => {
    mockFetch(200, {});
    await getFileVersions("t", "K", { pageSize: 10, before: 99, after: 5 });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get("page_size")).toBe("10");
    expect(u.searchParams.get("before")).toBe("99");
    expect(u.searchParams.get("after")).toBe("5");
  });

  test("nilai 0 tetap dikirim (bukan dianggap kosong)", async () => {
    mockFetch(200, {});
    await getFileVersions("t", "K", { before: 0 });
    expect(new URL(calls[0].url).searchParams.get("before")).toBe("0");
  });
});

describe("team library", () => {
  test("components: path di-encode, tanpa query bila tanpa page", async () => {
    mockFetch(200, {});
    await getTeamComponents("t", "team/1");
    expect(calls[0].url).toBe("https://api.figma.com/v1/teams/team%2F1/components");
  });

  test("styles: page_size dan after", async () => {
    mockFetch(200, {});
    await getTeamStyles("t", "T1", { pageSize: 30, after: 7 });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v1/teams/T1/styles");
    expect(u.searchParams.get("page_size")).toBe("30");
    expect(u.searchParams.get("after")).toBe("7");
  });
});

describe("projects", () => {
  test("getTeamProjects: GET /teams/:id/projects dengan path di-encode", async () => {
    mockFetch(200, { name: "T", projects: [] });
    expect(await getTeamProjects("t", "team/1")).toEqual({ name: "T", projects: [] });
    expect(calls[0].url).toBe("https://api.figma.com/v1/teams/team%2F1/projects");
    expect(calls[0].init.method).toBe("GET");
  });

  test("getProjectFiles: branch_data hanya dikirim bila diminta", async () => {
    mockFetch(200, { files: [] });
    await getProjectFiles("t", "123");
    expect(calls[0].url).toBe("https://api.figma.com/v1/projects/123/files");
    mockFetch(200, { files: [] });
    await getProjectFiles("t", "123", true);
    expect(calls[0].url).toBe("https://api.figma.com/v1/projects/123/files?branch_data=true");
  });
});

describe("dev resources", () => {
  test("getDevResources: tanpa node_ids tidak ada query string", async () => {
    mockFetch(200, { dev_resources: [] });
    await getDevResources("t", "K");
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/K/dev_resources");
  });

  test("getDevResources: node_ids digabung koma", async () => {
    mockFetch(200, { dev_resources: [] });
    await getDevResources("t", "K", ["1:2", "3:4"]);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v1/files/K/dev_resources");
    expect(u.searchParams.get("node_ids")).toBe("1:2,3:4");
  });

  test("createDevResources: POST /dev_resources dengan body dev_resources", async () => {
    mockFetch(200, { links_created: [{ id: "d1" }], errors: [] });
    const items = [{ name: "Docs", url: "https://x.dev", file_key: "K", node_id: "1:2" }];
    const res = await createDevResources("tok", items);
    expect(res).toEqual({ links_created: [{ id: "d1" }], errors: [] });
    expect(calls[0].url).toBe("https://api.figma.com/v1/dev_resources");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(calls[0].init.headers["X-Figma-Token"]).toBe("tok");
    expect(JSON.parse(calls[0].init.body)).toEqual({ dev_resources: items });
  });

  test("deleteDevResource: DELETE dengan path di-encode, body kosong -> {}", async () => {
    mockFetch(200, "");
    expect(await deleteDevResource("t", "K", "a/b")).toEqual({});
    expect(calls[0].url).toBe("https://api.figma.com/v1/files/K/dev_resources/a%2Fb");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].init.body).toBeUndefined();
  });

  test("deleteDevResource: error memuat status Figma", async () => {
    mockFetch(404, { err: "Not found" });
    await expect(deleteDevResource("t", "K", "d1")).rejects.toThrow("Figma API 404: Not found");
  });
});

describe("downloadBytes", () => {
  test("mengembalikan byte respons", async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]))) as any;
    expect(
      Array.from(await downloadBytes("https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/a")),
    ).toEqual([1, 2, 3]);
  });

  test("melempar bila respons tidak ok", async () => {
    globalThis.fetch = (async () => new Response("no", { status: 404 })) as any;
    await expect(downloadBytes("https://www.figma.com/y")).rejects.toThrow(
      "Download failed (404) for https://www.figma.com/y",
    );
  });

  test("mengizinkan host figmausercontent.com", async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array([7]))) as any;
    expect(Array.from(await downloadBytes("https://s3-alpha.figmausercontent.com/img/1"))).toEqual([7]);
  });

  test("menolak host di luar allowlist, http, dan URL tidak valid tanpa fetch", async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response(new Uint8Array([1]));
    }) as any;
    await expect(downloadBytes("https://evil.example.com/a")).rejects.toThrow("Download rejected");
    await expect(downloadBytes("https://figma.com.evil.io/a")).rejects.toThrow("Download rejected");
    await expect(downloadBytes("https://evilfigma.com/a")).rejects.toThrow("Download rejected");
    await expect(downloadBytes("http://www.figma.com/a")).rejects.toThrow("Download rejected");
    await expect(downloadBytes("file:///etc/passwd")).rejects.toThrow("Download rejected");
    await expect(downloadBytes("not a url")).rejects.toThrow("Download rejected: invalid URL");
    expect(fetched).toBe(false);
  });
});
