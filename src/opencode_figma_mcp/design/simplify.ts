// Converts Figma REST-format nodes (from the REST API or the plugin's
// JSON_REST_V1 export) into a compact, code-oriented design spec.

export interface RestNodeBundle {
  document: any;
  components?: Record<string, any>;
  componentSets?: Record<string, any>;
  styles?: Record<string, any>;
}

export interface VariableInfo {
  name: string;
  collection?: string;
  resolvedType?: string;
  valuesByMode?: Record<string, unknown>;
}

export interface SimplifyOptions {
  maxDepth?: number;
  includeHidden?: boolean;
  variables?: Record<string, VariableInfo>;
}

export interface DesignSpec {
  nodes: any[];
  styles: Record<string, any>;
  components?: Record<string, any>;
  componentSets?: Record<string, any>;
  variables?: Record<string, VariableInfo>;
  assets: {
    icons: Array<{ nodeId: string; name: string; suggestedFormat: "svg" }>;
    images: Array<{ nodeId: string; name: string; imageRef: string }>;
  };
}

const VECTOR_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "REGULAR_POLYGON",
]);
const SHAPE_TYPES = new Set(["ELLIPSE", "LINE", "RECTANGLE"]);

function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

export function colorToCss(color: any, paintOpacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = round((color.a ?? 1) * paintOpacity, 3);
  if (a >= 1) {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function gradientToCss(paint: any): string {
  const stops = (paint.gradientStops || [])
    .map(
      (s: any) =>
        `${colorToCss(s.color, paint.opacity ?? 1)} ${round(s.position * 100, 1)}%`,
    )
    .join(", ");
  const handles = paint.gradientHandlePositions;
  if (paint.type === "GRADIENT_LINEAR") {
    let angle = 180;
    if (handles && handles.length >= 2) {
      const dx = handles[1].x - handles[0].x;
      const dy = handles[1].y - handles[0].y;
      angle = round((Math.atan2(dy, dx) * 180) / Math.PI + 90, 1);
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

function simplifyPaint(paint: any): any {
  if (paint.type === "SOLID") {
    return colorToCss(paint.color, paint.opacity ?? 1);
  }
  if (paint.type && paint.type.startsWith("GRADIENT_")) {
    return gradientToCss(paint);
  }
  if (paint.type === "IMAGE") {
    const img: any = { type: "IMAGE", imageRef: paint.imageRef ?? paint.imageHash };
    if (paint.scaleMode) img.scaleMode = paint.scaleMode;
    if (paint.opacity !== undefined && paint.opacity < 1) img.opacity = paint.opacity;
    return img;
  }
  return { type: paint.type };
}

function visiblePaints(paints: any): any[] {
  if (!Array.isArray(paints)) return [];
  return paints.filter((p) => p && p.visible !== false);
}

function padding(node: any): string | undefined {
  const t = node.paddingTop || 0;
  const r = node.paddingRight || 0;
  const b = node.paddingBottom || 0;
  const l = node.paddingLeft || 0;
  if (!t && !r && !b && !l) return undefined;
  if (t === b && l === r) return t === l ? `${t}px` : `${t}px ${r}px`;
  return `${t}px ${r}px ${b}px ${l}px`;
}

const JUSTIFY: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  SPACE_BETWEEN: "space-between",
};
const ALIGN: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  BASELINE: "baseline",
};

function sizingOf(node: any, axis: "Horizontal" | "Vertical"): string | undefined {
  const v = node[`layoutSizing${axis}`];
  if (!v) return undefined;
  return v.toLowerCase();
}

function buildLayout(node: any, parent: any | null): any {
  const layout: any = {};
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

  const parentIsAutoLayout =
    parent && (parent.layoutMode === "HORIZONTAL" || parent.layoutMode === "VERTICAL" || parent.layoutMode === "GRID");

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
        vertical: node.constraints.vertical,
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

  return Object.keys(layout).length ? layout : undefined;
}

function buildTextStyle(style: any): any {
  if (!style) return undefined;
  const ts: any = {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
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
    ts.textTransform =
      style.textCase === "UPPER"
        ? "uppercase"
        : style.textCase === "LOWER"
          ? "lowercase"
          : style.textCase === "TITLE"
            ? "capitalize"
            : style.textCase.toLowerCase();
  }
  if (style.textDecoration && style.textDecoration !== "NONE") {
    ts.textDecoration = style.textDecoration === "STRIKETHROUGH" ? "line-through" : "underline";
  }
  if (style.paragraphSpacing) ts.paragraphSpacing = style.paragraphSpacing;
  return ts;
}

function buildEffects(effects: any): any {
  const list = Array.isArray(effects) ? effects.filter((e) => e.visible !== false) : [];
  if (!list.length) return undefined;
  const out: any = {};
  const shadows = list
    .filter((e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
    .map(
      (e) =>
        `${e.type === "INNER_SHADOW" ? "inset " : ""}${round(e.offset?.x || 0)}px ${round(e.offset?.y || 0)}px ${round(e.radius || 0)}px ${round(e.spread || 0)}px ${colorToCss(e.color || { r: 0, g: 0, b: 0, a: 0.25 })}`,
    );
  if (shadows.length) out.boxShadow = shadows.join(", ");
  const blur = list.find((e) => e.type === "LAYER_BLUR");
  if (blur) out.filter = `blur(${round(blur.radius)}px)`;
  const bgBlur = list.find((e) => e.type === "BACKGROUND_BLUR");
  if (bgBlur) out.backdropFilter = `blur(${round(bgBlur.radius)}px)`;
  return out;
}

function buildStroke(node: any): any {
  const paints = visiblePaints(node.strokes);
  if (!paints.length) return undefined;
  const stroke: any = { colors: paints.map(simplifyPaint) };
  if (node.individualStrokeWeights) {
    const w = node.individualStrokeWeights;
    stroke.width = `${w.top}px ${w.right}px ${w.bottom}px ${w.left}px`;
  } else if (node.strokeWeight !== undefined) {
    stroke.width = `${node.strokeWeight}px`;
  }
  if (node.strokeAlign) stroke.align = node.strokeAlign.toLowerCase();
  if (Array.isArray(node.strokeDashes) && node.strokeDashes.length) stroke.dashes = node.strokeDashes;
  return stroke;
}

function isVectorOnly(node: any): boolean {
  if (VECTOR_TYPES.has(node.type)) return true;
  if (SHAPE_TYPES.has(node.type)) {
    // a plain shape is only "vector" when it has no image fill
    return !visiblePaints(node.fills).some((p) => p.type === "IMAGE");
  }
  if (["GROUP", "FRAME", "INSTANCE", "COMPONENT"].includes(node.type)) {
    const children = (node.children || []).filter((c: any) => c.visible !== false);
    if (!children.length) return false;
    if (node.layoutMode && node.layoutMode !== "NONE") return false;
    return children.every(isVectorOnly);
  }
  return false;
}

function containsVector(node: any): boolean {
  if (VECTOR_TYPES.has(node.type)) return true;
  return (node.children || []).some(containsVector);
}

class StyleRegistry {
  private byKey = new Map<string, string>();
  readonly styles: Record<string, any> = {};
  private counters: Record<string, number> = {};

  ref(prefix: string, value: any): string | undefined {
    if (value === undefined) return undefined;
    const key = `${prefix}:${JSON.stringify(value)}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    this.counters[prefix] = (this.counters[prefix] || 0) + 1;
    const id = `${prefix}${this.counters[prefix]}`;
    this.byKey.set(key, id);
    this.styles[id] = value;
    return id;
  }
}

interface Ctx {
  registry: StyleRegistry;
  styleMeta: Record<string, any>;
  components: Record<string, any>;
  options: SimplifyOptions;
  assets: DesignSpec["assets"];
  variableIds: Set<string>;
}

function collectBoundVariables(bound: any, ctx: Ctx): any {
  if (!bound || typeof bound !== "object") return undefined;
  const out: any = {};
  for (const [field, value] of Object.entries(bound)) {
    const list = Array.isArray(value) ? value : [value];
    const ids = list
      .filter((v: any) => v && v.type === "VARIABLE_ALIAS" && v.id)
      .map((v: any) => v.id as string);
    if (!ids.length) continue;
    ids.forEach((id) => ctx.variableIds.add(id));
    const names = ids.map((id) => ctx.options.variables?.[id]?.name ?? id);
    out[field] = names.length === 1 ? names[0] : names;
  }
  return Object.keys(out).length ? out : undefined;
}

function simplifyNode(node: any, parent: any | null, depth: number, ctx: Ctx): any | null {
  if (!node) return null;
  if (node.visible === false && !ctx.options.includeHidden) return null;

  const out: any = { id: node.id, name: node.name, type: node.type };
  const box = node.absoluteBoundingBox;
  if (box) out.size = { width: round(box.width), height: round(box.height) };

  if (node.type === "INSTANCE" && node.componentId) {
    const comp = ctx.components[node.componentId];
    out.component = { id: node.componentId, name: comp?.name };
    if (node.componentProperties) {
      const props: any = {};
      for (const [k, v] of Object.entries<any>(node.componentProperties)) {
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

  if (node.opacity !== undefined && node.opacity < 1) out.opacity = round(node.opacity, 3);
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
    const overrides: number[] = node.characterStyleOverrides || [];
    const table = node.styleOverrideTable || {};
    if (overrides.some((o) => o) && node.characters) {
      const segments: any[] = [];
      let current = overrides[0] || 0;
      let start = 0;
      const chars: string = node.characters;
      for (let i = 1; i <= chars.length; i++) {
        const o = i < overrides.length ? overrides[i] || 0 : 0;
        if (i === chars.length || o !== current) {
          const seg: any = { text: chars.slice(start, i) };
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
    const named: any = {};
    for (const [kind, styleId] of Object.entries<any>(node.styles)) {
      const meta = ctx.styleMeta[styleId];
      named[kind] = meta?.name ?? styleId;
    }
    out.designStyles = named;
  }

  const vars = collectBoundVariables(node.boundVariables, ctx);
  if (vars) out.variables = vars;

  // Vector-only subtrees are icons/illustrations: export them, don't rebuild them.
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
    if (maxDepth !== undefined && depth >= maxDepth) {
      out.childrenTruncated = node.children.length;
    } else {
      const children = node.children
        .map((c: any) => simplifyNode(c, node, depth + 1, ctx))
        .filter((c: any) => c !== null);
      if (children.length) out.children = children;
    }
  }

  return out;
}

export function simplifyBundles(bundles: RestNodeBundle[], options: SimplifyOptions = {}): DesignSpec {
  const registry = new StyleRegistry();
  const styleMeta: Record<string, any> = {};
  const components: Record<string, any> = {};
  const componentSets: Record<string, any> = {};
  for (const b of bundles) {
    Object.assign(styleMeta, b.styles || {});
    Object.assign(components, b.components || {});
    Object.assign(componentSets, b.componentSets || {});
  }

  const ctx: Ctx = {
    registry,
    styleMeta,
    components,
    options,
    assets: { icons: [], images: [] },
    variableIds: new Set(),
  };

  const nodes = bundles
    .map((b) => simplifyNode(b.document, null, 0, ctx))
    .filter((n) => n !== null);

  const spec: DesignSpec = { nodes, styles: registry.styles, assets: ctx.assets };

  if (Object.keys(components).length) {
    spec.components = Object.fromEntries(
      Object.entries(components).map(([id, c]) => [
        id,
        {
          name: c.name,
          description: c.description || undefined,
          componentSetId: c.componentSetId || undefined,
          remote: c.remote || undefined,
        },
      ]),
    );
  }
  if (Object.keys(componentSets).length) {
    spec.componentSets = Object.fromEntries(
      Object.entries(componentSets).map(([id, c]) => [id, { name: c.name, description: c.description || undefined }]),
    );
  }

  if (ctx.variableIds.size) {
    const vars: Record<string, VariableInfo> = {};
    for (const id of ctx.variableIds) {
      vars[id] = options.variables?.[id] ?? { name: id };
    }
    spec.variables = vars;
  }

  // Dedupe image assets by imageRef
  const seen = new Set<string>();
  spec.assets.images = spec.assets.images.filter((img) => {
    if (!img.imageRef || seen.has(img.imageRef)) return false;
    seen.add(img.imageRef);
    return true;
  });

  return spec;
}
