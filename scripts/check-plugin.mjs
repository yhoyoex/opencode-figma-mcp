#!/usr/bin/env node
// Static checks for the unbundled Figma plugin (src/opencode_mcp_plugin/code.js):
// 1. it parses (node --check)
// 2. it avoids syntax the Figma plugin sandbox rejects: ?., ?? and object spread/rest
// 3. every plugin command the MCP server sends has a `case` in the dispatcher
// 4. MCP tool names are unique

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "src/opencode_mcp_plugin/code.js");
const serverPath = path.join(root, "src/opencode_figma_mcp/server.ts");

// Commands handled by the relay rather than the plugin
const RELAY_COMMANDS = new Set(["join"]);

const failures = [];

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

// 1. Syntax
const check = spawnSync("node", ["--check", pluginPath], { encoding: "utf8" });
if (check.error) {
  failures.push(`node --check could not run: ${check.error.message}`);
} else if (check.status !== 0) {
  failures.push(`node --check failed:\n${check.stderr.trim()}`);
}

// 2. Forbidden syntax, scanned on code only (strings, templates, regexes and comments skipped)
const REGEX_PREFIX_CHARS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_PREFIX_WORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "void", "yield", "await", "delete", "throw", "new"]);

function scanForbiddenSyntax(source) {
  const found = [];
  // Bracket stack; "tpl" marks a `${` that resumes a template literal when closed
  const stack = [];
  let lastSignificant = "";
  let lastWord = "";
  let i = 0;

  function skipTemplate() {
    // i points just after the opening backtick or a closing `}` of `${`
    while (i < source.length) {
      const ch = source[i];
      if (ch === "\\") {
        i += 2;
      } else if (ch === "`") {
        i++;
        return;
      } else if (ch === "$" && source[i + 1] === "{") {
        stack.push("tpl");
        i += 2;
        return;
      } else {
        i++;
      }
    }
  }

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < source.length && source[i] !== ch && source[i] !== "\n") {
        i += source[i] === "\\" ? 2 : 1;
      }
      i++;
      lastSignificant = ch;
      lastWord = "";
      continue;
    }
    if (ch === "`") {
      i++;
      skipTemplate();
      lastSignificant = "`";
      lastWord = "";
      continue;
    }
    if (
      ch === "/" &&
      (lastSignificant === "" ||
        REGEX_PREFIX_CHARS.has(lastSignificant) ||
        REGEX_PREFIX_WORDS.has(lastWord))
    ) {
      i++;
      let inClass = false;
      while (i < source.length && source[i] !== "\n") {
        const c = source[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        i++;
      }
      i++;
      while (/[a-z]/i.test(source[i] || "")) i++;
      lastSignificant = "/";
      lastWord = "";
      continue;
    }

    if (ch === "?" && next === "." && !/[0-9]/.test(source[i + 2] || "")) {
      found.push({ index: i, rule: "optional chaining (?.)" });
    } else if (ch === "?" && next === "?") {
      found.push({ index: i, rule: "nullish coalescing (??)" });
    } else if (ch === "." && next === "." && source[i + 2] === ".") {
      if (stack[stack.length - 1] === "{") {
        found.push({ index: i, rule: "object spread/rest ({...})" });
      }
      i += 3;
      lastSignificant = ".";
      lastWord = "";
      continue;
    }

    if (ch === "{" || ch === "(" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === ")" || ch === "]") {
      const top = stack.pop();
      if (ch === "}" && top === "tpl") {
        i++;
        skipTemplate();
        lastSignificant = "`";
        lastWord = "";
        continue;
      }
    }

    if (/[A-Za-z0-9_$]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
      lastWord = source.slice(i, j);
      lastSignificant = source[j - 1];
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) {
      lastSignificant = ch;
      lastWord = "";
    }
    i++;
  }
  return found;
}

const pluginSource = readFileSync(pluginPath, "utf8");
for (const { index, rule } of scanForbiddenSyntax(pluginSource)) {
  failures.push(`code.js:${lineOf(pluginSource, index)}: ${rule} is not supported by the Figma plugin runtime`);
}

// 3. Server commands must be handled by the plugin dispatcher
const pluginCases = new Set(
  [...pluginSource.matchAll(/case\s+"([a-z0-9_]+)"\s*:/g)].map((m) => m[1]),
);
const serverSource = readFileSync(serverPath, "utf8");
const toolStarts = [...serverSource.matchAll(/server\.tool\(\s*"([a-z0-9_]+)"/g)].map((m) => ({
  name: m[1],
  index: m.index,
}));

// McpServer throws at startup on a duplicate tool name
const seenTools = new Set();
for (const { name, index } of toolStarts) {
  if (seenTools.has(name)) {
    failures.push(`server.ts:${lineOf(serverSource, index)}: tool "${name}" is registered twice`);
  }
  seenTools.add(name);
}

function enclosingTool(index) {
  let name = null;
  for (const tool of toolStarts) {
    if (tool.index > index) break;
    name = tool.name;
  }
  return name;
}

const commandUses = [
  ...[...serverSource.matchAll(/sendCommandToFigma\(\s*"([a-z0-9_]+)"/g)].map((m) => ({
    command: m[1],
    index: m.index,
    owner: enclosingTool(m.index) && `tool ${enclosingTool(m.index)}`,
  })),
  ...[
    ...serverSource.matchAll(
      /registerPluginResource\(\s*"[^"]*",\s*"([^"]*)",\s*"[^"]*",\s*"([a-z0-9_]+)"/g,
    ),
  ].map((m) => ({ command: m[2], index: m.index, owner: `resource ${m[1]}` })),
];
let checkedCommands = 0;
for (const { command, index, owner } of commandUses) {
  if (RELAY_COMMANDS.has(command)) continue;
  checkedCommands++;
  if (!pluginCases.has(command)) {
    failures.push(
      `server.ts:${lineOf(serverSource, index)}: command "${command}"${owner ? ` (${owner})` : ""} has no case in code.js`,
    );
  }
}

if (failures.length) {
  console.error(`check-plugin: ${failures.length} problem(s)\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(
  `check-plugin: OK (syntax, forbidden syntax, ${checkedCommands} command uses across ${toolStarts.length} tools)`,
);
