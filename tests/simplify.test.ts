import { describe, expect, test } from "bun:test";
import { colorToCss, simplifyBundles } from "../src/opencode_figma_mcp/design/simplify";

const red = { r: 1, g: 0, b: 0, a: 1 };
const solid = (color = red, extra: any = {}) => ({ type: "SOLID", color, ...extra });
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function run(document: any, options?: any, extra: any = {}) {
  return simplifyBundles([{ document, ...extra }], options);
}

describe("colorToCss", () => {
  test("alpha penuh -> hex uppercase", () => {
    expect(colorToCss({ r: 1, g: 0.5, b: 0, a: 1 })).toBe("#FF8000");
  });

  test("alpha < 1 -> rgba, paintOpacity dikalikan", () => {
    expect(colorToCss({ r: 0, g: 0, b: 0, a: 0.5 })).toBe("rgba(0, 0, 0, 0.5)");
    expect(colorToCss({ r: 0, g: 0, b: 0, a: 1 }, 0.25)).toBe("rgba(0, 0, 0, 0.25)");
  });

  test("a tidak ada dianggap 1", () => {
    expect(colorToCss({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });
});

describe("simplifyBundles - input minimal", () => {
  test("node kosong menghasilkan id/name/type tanpa properti lain", () => {
    const spec = run({ id: "1:1", name: "Empty", type: "FRAME" });
    expect(spec.nodes).toEqual([{ id: "1:1", name: "Empty", type: "FRAME" }]);
    expect(spec.styles).toEqual({});
    expect(spec.assets).toEqual({ icons: [], images: [] });
    expect(spec.components).toBeUndefined();
    expect(spec.variables).toBeUndefined();
  });

  test("bundle tanpa document dibuang", () => {
    const spec = simplifyBundles([{ document: null }]);
    expect(spec.nodes).toEqual([]);
  });

  test("size dibulatkan 2 digit dari absoluteBoundingBox", () => {
    const spec = run({ id: "1", name: "n", type: "FRAME", absoluteBoundingBox: box(0, 0, 100.456, 50) });
    expect(spec.nodes[0].size).toEqual({ width: 100.46, height: 50 });
  });
});

describe("auto layout", () => {
  const frame = {
    id: "1:1",
    name: "Card",
    type: "FRAME",
    layoutMode: "HORIZONTAL",
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "MAX",
    itemSpacing: 8,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 16,
    paddingRight: 16,
    clipsContent: true,
  };

  test("frame horizontal dipetakan ke flex row", () => {
    const spec = run(frame);
    const layout = spec.styles[spec.nodes[0].layout];
    expect(layout).toEqual({
      display: "flex",
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "flex-end",
      gap: "8px",
      padding: "4px 16px",
      overflow: "hidden",
    });
  });

  test("VERTICAL -> column; MIN align tidak dikeluarkan", () => {
    const spec = run({ id: "1", name: "n", type: "FRAME", layoutMode: "VERTICAL" });
    expect(spec.styles[spec.nodes[0].layout]).toEqual({ display: "flex", flexDirection: "column" });
  });

  test("SPACE_BETWEEN tidak mengeluarkan gap", () => {
    const spec = run({
      id: "1", name: "n", type: "FRAME", layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "SPACE_BETWEEN", itemSpacing: 10,
    });
    const layout = spec.styles[spec.nodes[0].layout];
    expect(layout.justifyContent).toBe("space-between");
    expect(layout.gap).toBeUndefined();
  });

  test("wrap + counterAxisSpacing -> flexWrap dan rowGap", () => {
    const spec = run({
      id: "1", name: "n", type: "FRAME", layoutMode: "HORIZONTAL",
      layoutWrap: "WRAP", counterAxisSpacing: 12,
    });
    const layout = spec.styles[spec.nodes[0].layout];
    expect(layout.flexWrap).toBe("wrap");
    expect(layout.rowGap).toBe("12px");
  });

  test("padding empat sisi berbeda -> shorthand 4 nilai; seragam -> satu nilai", () => {
    const four = run({ id: "1", name: "n", type: "FRAME", layoutMode: "VERTICAL",
      paddingTop: 1, paddingRight: 2, paddingBottom: 3, paddingLeft: 4 });
    expect(four.styles[four.nodes[0].layout].padding).toBe("1px 2px 3px 4px");
    const same = run({ id: "1", name: "n", type: "FRAME", layoutMode: "VERTICAL",
      paddingTop: 6, paddingRight: 6, paddingBottom: 6, paddingLeft: 6 });
    expect(same.styles[same.nodes[0].layout].padding).toBe("6px");
  });

  test("child dalam auto layout membawa sizing/flexGrow/alignSelf, tanpa absolute", () => {
    const spec = run({
      ...frame,
      children: [{
        id: "2", name: "kid", type: "FRAME",
        layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG",
        layoutGrow: 1, layoutAlign: "STRETCH",
      }],
    });
    const kid = spec.nodes[0].children[0];
    expect(spec.styles[kid.layout]).toEqual({
      sizing: { horizontal: "fill", vertical: "hug" },
      flexGrow: 1,
      alignSelf: "stretch",
    });
  });

  test("child ABSOLUTE dalam auto layout memakai posisi relatif parent", () => {
    const spec = run({
      ...frame,
      absoluteBoundingBox: box(100, 100, 300, 100),
      children: [{
        id: "2", name: "badge", type: "FRAME", layoutPositioning: "ABSOLUTE",
        absoluteBoundingBox: box(110, 125, 10, 10),
        constraints: { horizontal: "LEFT", vertical: "TOP" },
      }],
    });
    const kid = spec.nodes[0].children[0];
    expect(spec.styles[kid.layout]).toEqual({
      position: "absolute", left: 10, top: 25,
      constraints: { horizontal: "LEFT", vertical: "TOP" },
    });
  });

  test("child di parent non-auto-layout -> position absolute", () => {
    const spec = run({
      id: "1", name: "p", type: "FRAME", absoluteBoundingBox: box(0, 0, 100, 100),
      children: [{ id: "2", name: "c", type: "FRAME", absoluteBoundingBox: box(5, 6, 10, 10) }],
    });
    const layout = spec.styles[spec.nodes[0].children[0].layout];
    expect(layout).toMatchObject({ position: "absolute", left: 5, top: 6 });
  });
});

describe("teks", () => {
  const textNode = {
    id: "t1", name: "Title", type: "TEXT", characters: "Halo",
    fills: [solid()],
    style: {
      fontFamily: "Inter", fontWeight: 700, fontSize: 20,
      lineHeightUnit: "PIXELS", lineHeightPx: 24,
      letterSpacing: 0.5, textAlignHorizontal: "CENTER",
      textCase: "UPPER", textDecoration: "UNDERLINE", italic: true,
    },
  };

  test("teks: fill jadi color (bukan fills), style jadi textStyle", () => {
    const spec = run(textNode);
    const n = spec.nodes[0];
    expect(n.text).toBe("Halo");
    expect(n.fills).toBeUndefined();
    expect(spec.styles[n.color]).toEqual(["#FF0000"]);
    expect(spec.styles[n.textStyle]).toEqual({
      fontFamily: "Inter", fontWeight: 700, fontSize: 20,
      fontStyle: "italic", lineHeight: "24px", letterSpacing: "0.5px",
      textAlign: "center", textTransform: "uppercase", textDecoration: "underline",
    });
  });

  test("lineHeight FONT_SIZE_% menjadi rasio", () => {
    const spec = run({
      ...textNode,
      style: { fontFamily: "Inter", fontWeight: 400, fontSize: 16,
        lineHeightUnit: "FONT_SIZE_%", lineHeightPercentFontSize: 150 },
    });
    expect(spec.styles[spec.nodes[0].textStyle].lineHeight).toBe(1.5);
  });

  test("characterStyleOverrides menghasilkan richText bersegmen", () => {
    const spec = run({
      id: "t", name: "t", type: "TEXT", characters: "abcd",
      style: { fontFamily: "Inter", fontWeight: 400, fontSize: 14 },
      characterStyleOverrides: [0, 0, 1, 1],
      styleOverrideTable: { 1: { fontWeight: 700, fills: [solid({ r: 0, g: 0, b: 1, a: 1 })] } },
    });
    const rich = spec.nodes[0].richText;
    expect(rich.map((s: any) => s.text)).toEqual(["ab", "cd"]);
    expect(rich[0].style).toBeUndefined();
    expect(spec.styles[rich[1].style].fontWeight).toBe(700);
    expect(spec.styles[rich[1].color]).toEqual(["#0000FF"]);
  });

  test("tanpa override -> tidak ada richText", () => {
    expect(run(textNode).nodes[0].richText).toBeUndefined();
  });
});

describe("fills", () => {
  test("solid dengan opacity paint -> rgba", () => {
    const spec = run({ id: "1", name: "n", type: "RECTANGLE", fills: [solid(red, { opacity: 0.5 })] });
    expect(spec.styles[spec.nodes[0].fills]).toEqual(["rgba(255, 0, 0, 0.5)"]);
  });

  test("gradient linear -> linear-gradient dengan sudut dari handle", () => {
    const spec = run({
      id: "1", name: "n", type: "FRAME",
      fills: [{
        type: "GRADIENT_LINEAR",
        gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
      }],
    });
    expect(spec.styles[spec.nodes[0].fills]).toEqual(["linear-gradient(90deg, #000000 0%, #FFFFFF 100%)"]);
  });

  test("gradient radial & angular", () => {
    const stops = [{ position: 0, color: red }];
    const spec = run({
      id: "1", name: "n", type: "FRAME",
      fills: [
        { type: "GRADIENT_RADIAL", gradientStops: stops },
        { type: "GRADIENT_ANGULAR", gradientStops: stops },
      ],
    });
    expect(spec.styles[spec.nodes[0].fills]).toEqual([
      "radial-gradient(circle, #FF0000 0%)",
      "conic-gradient(#FF0000 0%)",
    ]);
  });

  test("fill image dicatat di assets.images dan dideduplikasi per imageRef", () => {
    const img = { type: "IMAGE", imageRef: "ref1", scaleMode: "FILL" };
    const spec = run({
      id: "p", name: "p", type: "FRAME",
      children: [
        { id: "a", name: "a", type: "RECTANGLE", fills: [img] },
        { id: "b", name: "b", type: "RECTANGLE", fills: [img] },
        { id: "c", name: "c", type: "RECTANGLE", fills: [{ type: "IMAGE", imageRef: "ref2" }] },
      ],
    });
    expect(spec.assets.images.map((i) => i.imageRef)).toEqual(["ref1", "ref2"]);
    expect(spec.assets.images[0]).toEqual({ nodeId: "a", name: "a", imageRef: "ref1" });
    expect(spec.styles[spec.nodes[0].children[0].fills]).toEqual([{ type: "IMAGE", imageRef: "ref1", scaleMode: "FILL" }]);
  });

  test("paint visible:false diabaikan", () => {
    const spec = run({ id: "1", name: "n", type: "RECTANGLE", fills: [solid(red, { visible: false })] });
    expect(spec.nodes[0].fills).toBeUndefined();
  });
});

describe("deduplikasi style", () => {
  test("style identik berbagi satu ref, berbeda mendapat ref baru", () => {
    const mk = (id: string, color: any) => ({ id, name: id, type: "RECTANGLE", fills: [solid(color)] });
    const spec = run({
      id: "p", name: "p", type: "FRAME",
      children: [mk("a", red), mk("b", red), mk("c", { r: 0, g: 1, b: 0, a: 1 })],
    });
    const [a, b, c] = spec.nodes[0].children;
    expect(a.fills).toBe("fill1");
    expect(b.fills).toBe(a.fills);
    expect(c.fills).toBe("fill2");
    expect(Object.keys(spec.styles).filter((k) => k.startsWith("fill"))).toEqual(["fill1", "fill2"]);
  });

  test("dedup berlaku lintas bundle", () => {
    const doc = (id: string) => ({ id, name: id, type: "RECTANGLE", fills: [solid()] });
    const spec = simplifyBundles([{ document: doc("a") }, { document: doc("b") }]);
    expect(spec.nodes[0].fills).toBe(spec.nodes[1].fills);
    expect(spec.nodes).toHaveLength(2);
  });
});

describe("visibility dan nesting", () => {
  const tree = {
    id: "p", name: "p", type: "FRAME",
    children: [
      { id: "a", name: "a", type: "FRAME", visible: false },
      { id: "b", name: "b", type: "FRAME", children: [{ id: "c", name: "c", type: "FRAME" }] },
    ],
  };

  test("node invisible dibuang secara default", () => {
    const spec = run(tree);
    expect(spec.nodes[0].children.map((c: any) => c.id)).toEqual(["b"]);
  });

  test("includeHidden: true mempertahankan node invisible", () => {
    const spec = run(tree, { includeHidden: true });
    expect(spec.nodes[0].children.map((c: any) => c.id)).toEqual(["a", "b"]);
  });

  test("children nested diproses rekursif", () => {
    const spec = run(tree);
    expect(spec.nodes[0].children[0].children[0].id).toBe("c");
  });

  test("maxDepth memotong children dan mengisi childrenTruncated", () => {
    const spec = run(tree, { maxDepth: 1 });
    const b = spec.nodes[0].children[0];
    expect(b.id).toBe("b");
    expect(b.children).toBeUndefined();
    expect(b.childrenTruncated).toBe(1);
  });

  test("maxDepth 0 memotong tepat di root", () => {
    const spec = run(tree, { maxDepth: 0 });
    expect(spec.nodes[0].childrenTruncated).toBe(2);
    expect(spec.nodes[0].children).toBeUndefined();
  });
});

describe("vektor / ikon", () => {
  test("VECTOR tunggal: exportAs svg dan masuk assets.icons", () => {
    const spec = run({ id: "v", name: "arrow", type: "VECTOR" });
    expect(spec.nodes[0].exportAs).toBe("svg");
    expect(spec.assets.icons).toEqual([{ nodeId: "v", name: "arrow", suggestedFormat: "svg" }]);
  });

  test("frame berisi hanya vektor jadi satu ikon; anak tidak diproses", () => {
    const spec = run({
      id: "i", name: "icon", type: "FRAME",
      children: [{ id: "v1", name: "v1", type: "VECTOR" }, { id: "v2", name: "v2", type: "VECTOR" }],
    });
    expect(spec.nodes[0].exportAs).toBe("svg");
    expect(spec.nodes[0].children).toBeUndefined();
    expect(spec.assets.icons).toHaveLength(1);
    expect(spec.assets.icons[0].nodeId).toBe("i");
  });

  test("frame auto layout berisi vektor bukan ikon", () => {
    const spec = run({
      id: "i", name: "row", type: "FRAME", layoutMode: "HORIZONTAL",
      children: [{ id: "v1", name: "v1", type: "VECTOR" }],
    });
    expect(spec.nodes[0].exportAs).toBeUndefined();
    expect(spec.assets.icons.map((i) => i.nodeId)).toEqual(["v1"]);
  });
});

describe("tampilan lain", () => {
  test("ELLIPSE -> borderRadius 50%", () => {
    expect(run({ id: "e", name: "e", type: "ELLIPSE", fills: [solid()] }).nodes[0].borderRadius).toBe("50%");
  });

  test("cornerRadius dan rectangleCornerRadii", () => {
    expect(run({ id: "1", name: "n", type: "FRAME", cornerRadius: 8 }).nodes[0].borderRadius).toBe("8px");
    expect(
      run({ id: "1", name: "n", type: "FRAME", rectangleCornerRadii: [1, 2, 3, 4] }).nodes[0].borderRadius,
    ).toBe("1px 2px 3px 4px");
    expect(
      run({ id: "1", name: "n", type: "FRAME", rectangleCornerRadii: [5, 5, 5, 5] }).nodes[0].borderRadius,
    ).toBe("5px");
  });

  test("opacity < 1 dan blendMode non-default dikeluarkan", () => {
    const n = run({ id: "1", name: "n", type: "FRAME", opacity: 0.5, blendMode: "MULTIPLY" }).nodes[0];
    expect(n.opacity).toBe(0.5);
    expect(n.blendMode).toBe("multiply");
    const d = run({ id: "1", name: "n", type: "FRAME", opacity: 1, blendMode: "PASS_THROUGH" }).nodes[0];
    expect(d.opacity).toBeUndefined();
    expect(d.blendMode).toBeUndefined();
  });

  test("stroke: warna, lebar, align", () => {
    const spec = run({
      id: "1", name: "n", type: "FRAME",
      strokes: [solid()], strokeWeight: 2, strokeAlign: "INSIDE",
    });
    expect(spec.styles[spec.nodes[0].stroke]).toEqual({ colors: ["#FF0000"], width: "2px", align: "inside" });
  });

  test("effects: drop shadow, inner shadow, layer & background blur", () => {
    const spec = run({
      id: "1", name: "n", type: "FRAME",
      effects: [
        { type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } },
        { type: "INNER_SHADOW", offset: { x: 1, y: 1 }, radius: 2, spread: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { type: "LAYER_BLUR", radius: 3 },
        { type: "BACKGROUND_BLUR", radius: 10 },
        { type: "DROP_SHADOW", visible: false, radius: 99 },
      ],
    });
    expect(spec.styles[spec.nodes[0].effects]).toEqual({
      boxShadow: "0px 4px 8px 0px rgba(0, 0, 0, 0.25), inset 1px 1px 2px 0px #000000",
      filter: "blur(3px)",
      backdropFilter: "blur(10px)",
    });
  });
});

describe("komponen, style, variabel", () => {
  test("INSTANCE membawa nama komponen dan properti tanpa suffix #id", () => {
    const spec = run(
      {
        id: "i", name: "Btn", type: "INSTANCE", componentId: "c1",
        componentProperties: { "Label#1:0": { value: "OK" } },
      },
      undefined,
      { components: { c1: { name: "Button", description: "", componentSetId: "s1" } },
        componentSets: { s1: { name: "Buttons" } } },
    );
    expect(spec.nodes[0].component).toEqual({ id: "c1", name: "Button", properties: { Label: "OK" } });
    expect(spec.components).toEqual({
      c1: { name: "Button", description: undefined, componentSetId: "s1", remote: undefined },
    });
    expect(spec.componentSets).toEqual({ s1: { name: "Buttons", description: undefined } });
  });

  test("node.styles di-resolve ke nama style dari bundle.styles", () => {
    const spec = run(
      { id: "1", name: "n", type: "FRAME", styles: { fill: "S:1", stroke: "S:unknown" } },
      undefined,
      { styles: { "S:1": { name: "Brand/Primary" } } },
    );
    expect(spec.nodes[0].designStyles).toEqual({ fill: "Brand/Primary", stroke: "S:unknown" });
  });

  test("boundVariables di-resolve lewat options.variables, fallback ke id", () => {
    const spec = run(
      {
        id: "1", name: "n", type: "FRAME",
        boundVariables: {
          itemSpacing: { type: "VARIABLE_ALIAS", id: "V:1" },
          fills: [{ type: "VARIABLE_ALIAS", id: "V:2" }],
        },
      },
      { variables: { "V:1": { name: "space/md" } } },
    );
    expect(spec.nodes[0].variables).toEqual({ itemSpacing: "space/md", fills: "V:2" });
    expect(spec.variables).toEqual({ "V:1": { name: "space/md" }, "V:2": { name: "V:2" } });
  });
});
