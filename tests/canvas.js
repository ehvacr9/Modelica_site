"use strict";

const output = document.getElementById("results");
document.getElementById("app").addEventListener("load", async event => {
  const app = event.target.contentWindow, doc = app.document;
  const $ = id => doc.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const near = (a, b) => Math.abs(a - b) < 0.001;

  test("meter components can be added, rotated, and imported", async () => {
    app.loadSample();
    const buttons = [...$("library").querySelectorAll("button")];
    for (const [type, name, label] of [["voltmeter", "電壓表", "V"], ["ammeter", "電流表", "A"]]) {
      const button = buttons.find(item => item.textContent.includes(name));
      assert(button, `元件庫缺少${name}`);
      button.click();
      const part = app.eval("model.components").find(item => item.type === type);
      assert(part && !Object.hasOwn(part, "value"), `${name}應無參數`);
      const node = doc.querySelector(`.node[aria-label="${name} ${part.id}"]`);
      assert(node && node.querySelectorAll(".port").length === 2, `${name}需要兩個電氣端點`);
      const glyph = node.querySelector(".symbol > path");
      const mark = glyph.getAttribute("d");
      assert(mark && node.querySelector(".symbol > g"), `${label}量測符號缺失`);
      const rotated = app.symbol(type, 90);
      assert(rotated.querySelector(":scope > path").getAttribute("d") === mark, `${label}標記旋轉後應保持水平`);
    }
    const saved = JSON.parse(app.eval("JSON.stringify(model)"));
    const transfer = new app.DataTransfer();
    transfer.items.add(new app.File([JSON.stringify(saved)], "meters.json", {type:"application/json"}));
    $("load").files = transfer.files;
    $("load").dispatchEvent(new app.Event("change", {bubbles:true}));
    for (let i = 0; i < 50 && !$("message").textContent.includes("模型已匯入"); i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert($("message").textContent.includes("模型已匯入") &&
      app.eval("model.components.some(p => p.type === 'voltmeter') && model.components.some(p => p.type === 'ammeter')"),
      "量測器應能匯出後匯入");
    assert(app.variableQuantity("voltmeter1.v").unit === "V" && app.variableQuantity("ammeter1.i").unit === "A",
      "量測結果應顯示正確單位");
    app.loadSample();
  });
  test("components, auto routes and branch junctions follow the visible grid", () => {
    app.loadSample();
    const data = app.eval("model"), grid = app.eval("WireRouter.gridSize");
    const check = () => {
      const router = WireRouter.create(data.components, data.wires);
      for (const component of data.components) {
        assert(WireRouter.onGrid(component.x) && WireRouter.onGrid(component.y), "元件應吸附格點");
        for (const port of component.type === "ground" ? ["p"] : ["p", "n"]) {
          const point = WireRouter.port(component, port);
          assert(WireRouter.onGrid(point.x) && WireRouter.onGrid(point.y), "元件端點應位於格點");
        }
      }
      for (let i = 0; i < data.wires.length; i++) {
        const route = router.route(i);
        assert(route && route.every(p => WireRouter.onGrid(p.x) && WireRouter.onGrid(p.y)), "線路及接點應位於格點");
      }
    };
    check();
    const node = doc.querySelector('.node[aria-label="電阻 resistor1"]');
    node.setPointerCapture = () => {};
    for (const [type, x, y] of [["pointerdown", 100, 100], ["pointermove", 117, 115], ["pointerup", 117, 115]])
      node.dispatchEvent(new app.PointerEvent(type, {bubbles: true, button: 0, pointerId: 7, clientX: x, clientY: y}));
    check();
    app.addComponent("resistor", -107, 385);
    check();
    app.zoomAt(1.37, 100, 80);
    const view = app.eval("view");
    const style = $("canvas").style;
    assert(near(parseFloat(style.backgroundSize) / view.scale, grid), "格點應隨縮放同步");
    assert(near(parseFloat(style.backgroundPositionX) + grid * view.scale / 2, view.x) &&
      near(parseFloat(style.backgroundPositionY) + grid * view.scale / 2, view.y), "格點應隨平移同步");
    app.loadSample();
    app.confirm = () => true;
    $("optimize-layout").click();
    const optimized = app.eval("model"), router = WireRouter.create(optimized.components, optimized.wires);
    assert(optimized.components.every(p => WireRouter.onGrid(p.x) && WireRouter.onGrid(p.y)) &&
      optimized.wires.every((w, i) => router.route(i).every(p => WireRouter.onGrid(p.x) && WireRouter.onGrid(p.y))),
      "優化布局的元件與線路應位於格點");
    app.loadSample();
  });
  test("off-grid legacy branch routes align without changing electrical connections", () => {
    const legacy = {diagramVersion: 2, stopTime: 1, components: [
      {id:"voltage1",type:"voltage",value:5,x:25,y:110},
      {id:"resistor1",type:"resistor",value:1000,x:240,y:64,rotation:270},
      {id:"capacitor1",type:"capacitor",value:0.0001,x:480,y:110},
      {id:"ground1",type:"ground",x:240,y:270}
    ], wires: [
      {from:{id:"voltage1",port:"p"},to:{id:"resistor1",port:"p"},route:[{x:85,y:110},{x:85,y:35},{x:228,y:35},{x:228,y:100},{x:240,y:100}]},
      {from:{id:"resistor1",port:"n"},to:{id:"capacitor1",port:"p"},route:[{x:360,y:100},{x:372,y:100},{x:372,y:86},{x:540,y:86},{x:540,y:110}]},
      {from:{id:"capacitor1",port:"n"},to:{id:"voltage1",port:"n"},route:[{x:540,y:182},{x:540,y:240},{x:85,y:240},{x:85,y:182}]},
      {from:{id:"ground1",port:"p"},to:{id:"voltage1",port:"n"},branch:{parent:2,fraction:298/571},route:[{x:300,y:270},{x:300,y:240}]}
    ]};
    const engine = app.eval("CircuitEngine"), code = engine.generate(legacy);
    const outcome = app.alignImportedModel(legacy), router = WireRouter.create(legacy.components, legacy.wires);
    const routes = legacy.wires.map((w, i) => router.route(i));
    assert(outcome.adjusted && engine.generate(legacy) === code, "對齊舊模型不得改變電氣連接");
    assert(routes.every(route => route && route.every(p => WireRouter.onGrid(p.x) && WireRouter.onGrid(p.y))),
      "舊模型的線路和接點都應位於格點");
    const junction = WireRouter.pointAt(routes[2], legacy.wires[3].branch.fraction);
    assert(near(junction.x, routes[3].at(-1).x) && near(junction.y, routes[3].at(-1).y), "舊模型分支仍須連接主線");
  });
  test("desktop canvas grows with viewport and view tabs stay at the bottom", () => {
    const frame = document.getElementById("app"), original = frame.style.cssText;
    const measure = height => {
      frame.style.width = "1100px"; frame.style.height = `${height}px`;
      const bounds = element => element.getBoundingClientRect();
      return {canvas: bounds($("canvas")).height, tabs: bounds(doc.querySelector(".view-tabs")).bottom,
        workspace: bounds(doc.querySelector(".workspace")).bottom};
    };
    try {
      const small = measure(900), large = measure(1200);
      assert(Math.abs(large.canvas - small.canvas - 300) < 2, "畫布高度應隨視窗高度成長");
      assert(large.tabs <= 1200 && Math.abs(large.workspace - large.tabs - 20) < 2,
        "視圖分頁應保持在工作區底部");
      $("tab-code-view").click();
      const code = measure(1200);
      assert(Math.abs(code.tabs - large.tabs) < 2 && $("code-view").clientHeight > 700,
        "切換程式碼視圖時分頁應保持在底部");
      $("tab-model-view").click();
      $("fit-view").click();
      assert($("canvas").clientHeight > 700, "填滿視窗應使用延伸後的畫布");
    } finally { frame.style.cssText = original; $("tab-model-view").click(); }
  });
  test("layout confirmation preserves data or arranges without changing topology and results", () => {
    app.loadSample();
    app.showResults({names: ["time", "capacitor1.v"], columns: [[0, 1], [0, 5]], timeIndex: 0});
    const before = app.eval("JSON.stringify(model)"), code = app.eval("CircuitEngine.generate(model)");
    let asked = false;
    app.confirm = () => { asked = true; return false; };
    $("optimize-layout").click();
    assert(asked && app.eval("JSON.stringify(model)") === before && $("workspace-count").textContent === "2",
      "取消時模型、手動線路與結果不得變更");
    app.confirm = () => true;
    $("optimize-layout").click();
    const result = app.eval("model"), router = WireRouter.create(result.components, result.wires);
    assert(result.components.find(p => p.type === "resistor").rotation === 270, "電阻應水平");
    assert(result.components.find(p => p.type === "ground").y > result.components.find(p => p.type === "voltage").y,
      "接地應位於電路下方");
    const routes = result.wires.map((wire, i) => router.route(i));
    assert(routes.every(Boolean) && result.wires.every((wire, i) => !wire.route || router.validManual(i, wire.route)),
      "線路應重新繞線並可保存");
    assert(result.wires[3].branch.parent === 2 && doc.querySelector(".wire-junction"), "分支接點應保留");
    const resistor = result.components.find(p => p.type === "resistor");
    const left = routes[0].at(-2), right = routes[1][1];
    assert(left.y === WireRouter.port(resistor, "p").y && right.y === WireRouter.port(resistor, "n").y,
      "電阻兩側的線段應水平對齊");
    assert(Math.abs(resistor.x - left.x - (right.x - (resistor.x + 120))) <= WireRouter.gridSize,
      "電阻兩側的水平線段長度應平衡");
    const bottom = routes[2];
    assert(bottom.length === 4 && bottom[1].y - bottom[0].y >= 48 &&
      bottom.at(-2).y - bottom.at(-1).y >= 48, "下方回路應保留適當的垂直長度");
    assert(routes[3].length === 2 && routes[3][0].x === routes[3][1].x,
      "接地線應垂直連接回路");
    assert(app.eval("CircuitEngine.generate(model)") === code && $("workspace-count").textContent === "2",
      "排版不得更改電路或結果");
    assert($("wire-warning").hidden, "範例不應有繞線警告");
    app.loadSample();
  });
  test("loaded sample matches the optimized layout and reloads consistently", () => {
    app.loadSample();
    const snapshot = () => {
      const data = app.eval("model"), router = WireRouter.create(data.components, data.wires);
      return JSON.stringify({
        components: data.components,
        wires: data.wires,
        routes: data.wires.map((wire, i) => router.route(i)),
        junctions: [...$("wires").querySelectorAll(".wire-junction")].map(dot =>
          [dot.getAttribute("cx"), dot.getAttribute("cy")]),
        paths: [...$("wires").querySelectorAll("path.wire")].map(path => path.getAttribute("d")),
        code: app.eval("CircuitEngine.generate(model)")
      });
    };
    const before = snapshot();
    app.confirm = () => true;
    $("optimize-layout").click();
    assert(snapshot() === before, "優化後元件、線路、節點和電氣連接必須與載入範例一致");
    $("optimize-layout").click();
    assert(snapshot() === before, "重複優化不應改變範例布局");
    app.loadSample();
    assert(snapshot() === before, "重新載入範例應恢復相同布局");
  });
  test("sample layout failure leaves the existing model untouched", () => {
    const before = app.eval("JSON.stringify(model)");
    const layout = app.eval("CircuitLayout"), original = layout.optimize;
    try {
      layout.optimize = () => null;
      app.loadSample();
      assert(app.eval("JSON.stringify(model)") === before, "範例布局失敗不得替換模型");
      assert($("message").textContent.includes("原模型未變更"), "範例布局失敗應顯示錯誤");
    } finally { layout.optimize = original; }
  });
  test("layout groups disconnected circuits and avoids component overlap", () => {
    const components = [
      {id: "v", type: "voltage"}, {id: "r", type: "resistor"}, {id: "g", type: "ground"},
      {id: "c", type: "capacitor"}, {id: "r2", type: "resistor"}, {id: "g2", type: "ground"}
    ];
    const wire = (a, b) => ({from: {id: a, port: "p"}, to: {id: b, port: "p"}});
    const parts = app.eval("CircuitLayout").arrange(components, [wire("v", "r"), wire("v", "g"), wire("c", "r2"), wire("r2", "g2")]);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++)
      assert(Math.abs(parts[i].x - parts[j].x) >= 120 || Math.abs(parts[i].y - parts[j].y) >= 72, "元件不可重疊");
    assert(parts.find(p => p.id === "c").y > parts.find(p => p.id === "g").y, "不同電路應分開");
  });
  test("layout follows connectivity rather than component names", () => {
    const components = [
      {id:"v",type:"voltage"}, {id:"r1",type:"resistor"},
      {id:"r2",type:"resistor"}, {id:"c",type:"capacitor"}
    ];
    const wire = (a, ap, b, bp) => ({from:{id:a,port:ap},to:{id:b,port:bp}});
    const wires = [wire("v","p","r2","p"), wire("r2","n","r1","p"),
      wire("r1","n","c","p"), wire("c","n","v","n")];
    const result = app.eval("CircuitLayout").optimize(components, wires);
    assert(result, "應找到可繞線的布局");
    const part = id => result.components.find(p => p.id === id);
    assert(part("v").x < part("r2").x && part("r2").x < part("r1").x &&
      part("r1").x < part("c").x, "應依整體連線而非名稱排序");
    const router = WireRouter.create(result.components, result.wires);
    const between = router.route(1);
    assert(between.length === 2 && between[0].y === between[1].y,
      "相連電阻應以水平直線連接");
    assert(JSON.stringify(result.wires.map(({from,to}) => ({from,to}))) ===
      JSON.stringify(wires), "優化不得改變電氣連線");
  });
  test("layout preserves an already tidy custom circuit and its saved routes", () => {
    app.loadSample();
    const data = app.eval("model"), layout = app.eval("CircuitLayout");
    data.components = data.components.map(part => ({...part, x: part.x + 120, y: part.y + 120}));
    for (const wire of data.wires) if (wire.route)
      wire.route = wire.route.map(point => ({x: point.x + 120, y: point.y + 120}));
    app.render();
    const before = JSON.stringify(data), result = layout.optimize(data.components, data.wires);
    assert(result && result.unchanged, "不應為更短的布局而覆蓋已整齊的手動電路");
    app.confirm = () => true;
    $("optimize-layout").click();
    assert(JSON.stringify(data) === before && $("message").textContent.includes("原布局保持不變"),
      "沒有較佳方案時應保留元件位置、手動線路與分支");
    app.loadSample();
  });
  test("layout improves a spread-out circuit without adding visual clutter", () => {
    app.loadSample();
    const data = app.eval("model"), layout = app.eval("CircuitLayout");
    data.components.find(part => part.id === "resistor1").x = 720;
    for (const wire of data.wires) delete wire.route;
    const router = WireRouter.create(data.components, data.wires);
    const before = data.wires.map((wire, i) => router.route(i));
    const bends = routes => routes.reduce((sum, route) => sum + route.length - 2, 0);
    const crossings = routes => [...WireRouter.crossings(data.wires, routes).bridges.values()]
      .reduce((sum, values) => sum + values.length, 0);
    const result = layout.optimize(data.components, data.wires);
    assert(result && !result.unchanged, "應改善可重新排列的分散電路");
    const updated = WireRouter.create(result.components, result.wires);
    const after = result.wires.map((wire, i) => updated.route(i));
    assert(after.every(Boolean) && bends(after) <= bends(before) && crossings(after) <= crossings(before),
      "優化不應增加折線或跨線");
    assert(app.eval("CircuitEngine").generate({...data, components: result.components, wires: result.wires}) ===
      app.eval("CircuitEngine.generate(model)"), "布局不得改變電氣連線");
    app.loadSample();
  });
  test("layout does not introduce clutter into circuits with meters or separate groups", () => {
    const layout = app.eval("CircuitLayout");
    const parts = [
      {id:"v",type:"voltage",x:0,y:72}, {id:"am",type:"ammeter",x:216,y:0,rotation:270},
      {id:"r",type:"resistor",x:432,y:0,rotation:270}, {id:"g",type:"ground",x:0,y:264},
      {id:"vm",type:"voltmeter",x:648,y:72},
      {id:"r2",type:"resistor",x:0,y:600,rotation:270}, {id:"r3",type:"resistor",x:240,y:600,rotation:270}
    ];
    const wire = (a, ap, b, bp) => ({from:{id:a,port:ap},to:{id:b,port:bp}});
    const wires = [wire("v","p","am","p"), wire("am","n","r","p"), wire("r","n","v","n"),
      wire("g","p","v","n"), wire("vm","p","r","p"), wire("vm","n","r","n"),
      wire("r2","n","r3","p")];
    const result = layout.optimize(parts, wires);
    assert(result, "量測器及獨立電路應能完成布局");
    const check = (components, candidate) => {
      const router = WireRouter.create(components, candidate);
      const routes = candidate.map((wire, i) => router.route(i));
      const geometry = WireRouter.crossings(candidate, routes);
      const segments = routes.flatMap((route, wire) => route.slice(1).map((b, i) => {
        const a = route[i], horizontal = a.y === b.y, axis = horizontal ? "x" : "y";
        return {wire, horizontal, line: horizontal ? a.y : a.x,
          low: Math.min(a[axis], b[axis]), high: Math.max(a[axis], b[axis])};
      }));
      let overlap = 0;
      for (let i = 0; i < segments.length; i++) for (let j = 0; j < i; j++) {
        const a = segments[i], b = segments[j];
        if (a.wire !== b.wire && a.horizontal === b.horizontal && a.line === b.line)
          overlap += Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));
      }
      return {routes, ambiguous: geometry.ambiguous,
        bridges: [...geometry.bridges.values()].reduce((sum, values) => sum + values.length, 0),
        bends: routes.reduce((sum, route) => sum + route.length - 2, 0), overlap,
        short: segments.filter(segment => segment.high - segment.low < 2 * WireRouter.gridSize).length};
    };
    const before = check(parts, wires), after = check(result.components, result.wires);
    assert(after.routes.every(Boolean) && (!after.ambiguous || before.ambiguous) &&
      after.bridges <= before.bridges && after.bends <= before.bends &&
      after.overlap <= before.overlap && after.short <= before.short,
      "優化不應增加線路警告、跨線、重疊、轉折或短碎線");
    assert(result.components.find(p => p.id === "r2").y >= 0, "獨立電路元件應保留");
  });
  test("layout failure leaves all model data untouched", () => {
    app.loadSample();
    app.showResults({names: ["time", "capacitor1.v"], columns: [[0, 1], [0, 5]], timeIndex: 0});
    const before = app.eval("JSON.stringify(model)");
    app.confirm = () => true;
    const router = app.eval("WireRouter"), original = router.create;
    try {
      router.create = () => ({route: () => null, validManual: () => false});
      $("optimize-layout").click();
      assert(app.eval("JSON.stringify(model)") === before && $("workspace-count").textContent === "2",
        "繞線失敗不得更改原模型或模擬結果");
      assert($("message").textContent.includes("原布局及手動線路未變更"), "應明確告知排版失敗");
    } finally { router.create = original; }
  });
  test("sample layout has a single ground junction and no routing warnings", () => {
    assert($("wire-warning").hidden, "範例不應有繞線警告");
    const dots = [...$("wires").querySelectorAll(".wire-junction")];
    assert(dots.length === 1 && dots[0].getAttribute("cx") === "276" && dots[0].getAttribute("cy") === "204",
      "接地線應接至回路下方的單一接點");
    assert(!$("wires").querySelector(".wire-bridge"), "範例線路不應相互跨越");
  });
  test("wire hover targets stop at junctions and follow the rendered branch", () => {
    app.loadSample();
    const groups = $("wires").querySelectorAll("g");
    const main = [...groups[2].querySelectorAll(".wire-hit")].map(path => path.getAttribute("d"));
    const branch = [...groups[3].querySelectorAll(".wire-hit")].map(path => path.getAttribute("d"));
    assert(main.includes("M 492 204 L 276 204") && main.includes("M 276 204 L 60 204"),
      `主線命中區必須在接點分割：${main.join("; ")}`);
    assert(branch.join("; ").includes("276 204"), "分支命中區應到達主線接點");
    assert(app.eval("CircuitEngine.generate(model)").includes("connect(ground1.p, voltage1.n)"),
      "分支須保留電氣連接");
  });
  test("routing adapts clearance to nearby components without crossing them", () => {
    const components = [
      {id: "a", x: 0, y: 0, rotation: 270}, {id: "b", x: 138, y: 0, rotation: 270},
      {id: "c", x: 400, y: 0, rotation: 270}
    ];
    const wires = [{from: {id: "a", port: "n"}, to: {id: "c", port: "p"}}];
    const router = WireRouter.create(components, wires), route = router.route(0);
    assert(route && router.validManual(0, route), `應從狹窄間隙繞開元件：${JSON.stringify(route)}`);
    assert(route[0].x === 120 && route.at(-1).x === 400, "線路必須連接真正的端點");
  });
  test("unroutable branch still points to its actual junction", () => {
    app.loadSample();
    app.eval("model.components.push({id:'block', type:'resistor', value:1, x:240, y:250, rotation:0})");
    app.render();
    const router = WireRouter.create(app.eval("model.components"), app.eval("model.wires"));
    const parent = router.route(2), junction = WireRouter.pointAt(parent, app.eval("model.wires[3].branch.fraction"));
    assert(!router.route(3), "被元件遮擋的端點不應假裝繞線成功");
    const branch = $("wires").querySelectorAll(".wire")[3];
    assert(branch.classList.contains("wire-unrouted") && branch.getAttribute("d").endsWith(`L ${junction.x} ${junction.y}`),
      "無法繞線的分支必須指向主線接點，而非虛假的另一個元件端點");
    app.loadSample();
  });
  test("rotation updates both terminals and obstacle-avoiding routes", () => {
    const components = [{id: "a", x: 0, y: 0}, {id: "b", x: 500, y: 200}];
    const wires = [{from: {id: "a", port: "n"}, to: {id: "b", port: "p"}}];
    const expected = [[60, 72, 60, 0], [0, 36, 120, 36], [60, 0, 60, 72], [120, 36, 0, 36]];
    for (const [index, angle] of [0, 90, 180, 270].entries()) {
      components[0].rotation = angle;
      const p = WireRouter.port(components[0], "p"), n = WireRouter.port(components[0], "n");
      assert([n.x, n.y, p.x, p.y].join(",") === expected[index].join(","), `${angle}° 端點錯誤`);
      const points = WireRouter.create(components, wires).route(0);
      assert(points && points[0].x === n.x && points[0].y === n.y, `${angle}° 連線端點錯誤`);
      const next = points[1];
      assert((next.x - n.x) * n.dx + (next.y - n.y) * n.dy > 0, `${angle}° 連線未從端點向外延伸`);
    }
  });
  test("manual segment routing keeps endpoints and avoids components", () => {
    const components = [{id: "a", x: 0, y: 0, rotation: 270}, {id: "b", x: 500, y: 0, rotation: 270}];
    const wires = [{from: {id: "a", port: "n"}, to: {id: "b", port: "p"}}];
    const router = WireRouter.create(components, wires), original = router.route(0);
    const moved = WireRouter.shiftSegment(original, 0, 60);
    assert(moved && router.validManual(0, moved), "移動後線段應保留端點並繞開元件");
    assert(moved.some(point => point.y === 96), "水平線段未移動");
    components.push({id: "block", x: 220, y: 60});
    assert(!WireRouter.create(components, wires).validManual(0, moved), "手動路徑不得穿過元件");
  });
  test("crossings distinguish nets and place junction at a three-way split", () => {
    const e = (id, port = "p") => ({id, port});
    const wires = [
      {from: e("a"), to: e("b")}, {from: e("a"), to: e("c")},
      {from: e("d"), to: e("e")}
    ];
    const routes = [
      [{x: 0, y: 0}, {x: 100, y: 0}],
      [{x: 0, y: 0}, {x: 40, y: 0}, {x: 40, y: 40}],
      [{x: 70, y: -30}, {x: 70, y: 30}]
    ];
    const result = WireRouter.crossings(wires, routes);
    assert(result.junctions.length === 1 && result.junctions[0].x === 40 && result.junctions[0].y === 0, "三點接點位置錯誤");
    assert(result.bridges.get("0:0").includes(70) && !result.ambiguous, "不同網路的交叉應顯示跨線");
    routes[2] = [{x: 20, y: 0}, {x: 80, y: 0}];
    assert(WireRouter.crossings(wires, routes).ambiguous, "不同網路重疊應顯示警告");
  });
  test("dragging a branch near its junction slides the junction along its parent", () => {
    app.loadSample();
    const data = app.eval("model"), code = app.eval("CircuitEngine.generate(model)");
    const parentBefore = JSON.stringify(data.wires[2].route);
    const group = $("wires").querySelectorAll("g")[3], hit = group.querySelector(".wire-hit");
    const start = new app.DOMPoint(276, 207).matrixTransform(hit.getScreenCTM());
    const scale = app.eval("view.scale");
    group.setPointerCapture = () => {};
    hit.dispatchEvent(new app.PointerEvent("pointerdown", {bubbles:true, button:0, pointerId: 7, clientX:start.x, clientY:start.y}));
    group.dispatchEvent(new app.PointerEvent("pointermove", {bubbles:true, button:0, pointerId:7, clientX:start.x + 24 * scale, clientY:start.y}));
    const preview = [...$("wires").querySelectorAll(".wire-junction")].find(dot =>
      Number(dot.getAttribute("cx")) === 300 && Number(dot.getAttribute("cy")) === 204);
    assert(preview, "拖曳預覽中的接點應跟隨線段");
    group.dispatchEvent(new app.PointerEvent("pointerup", {bubbles:true, button:0, pointerId:7, clientX:start.x + 24 * scale, clientY:start.y}));
    const router = WireRouter.create(data.components, data.wires);
    const route = router.route(3), junction = WireRouter.pointAt(router.route(2), data.wires[3].branch.fraction);
    assert(junction.x === 300 && junction.y === 204 && near(route.at(-1).x, junction.x) && near(route.at(-1).y, junction.y),
      "接點必須沿主線移動且分支末端與之相連");
    assert(route.at(-2).x === junction.x && route.at(-2).y > junction.y &&
      route.every(p => WireRouter.onGrid(p.x) && WireRouter.onGrid(p.y)), "接點附近應維持單一垂直格點線段");
    assert(JSON.stringify(data.wires[2].route) === parentBefore && app.eval("CircuitEngine.generate(model)") === code,
      "拖曳不得改變主線或電氣連接");
    assert(router.validManual(3, JSON.parse(JSON.stringify(data.wires[3].route))), "路徑須可儲存並重新載入");
    const movedGroup = $("wires").querySelectorAll("g")[3], movedHit = [...movedGroup.querySelectorAll(".wire-hit")].at(-1);
    const movedStart = new app.DOMPoint(300, 210).matrixTransform(movedHit.getScreenCTM());
    movedGroup.setPointerCapture = () => {};
    movedHit.dispatchEvent(new app.PointerEvent("pointerdown", {bubbles:true, button:0, pointerId:8, clientX:movedStart.x, clientY:movedStart.y}));
    movedGroup.dispatchEvent(new app.PointerEvent("pointermove", {bubbles:true, button:0, pointerId:8, clientX:movedStart.x + 600 * scale, clientY:movedStart.y}));
    movedGroup.dispatchEvent(new app.PointerEvent("pointerup", {bubbles:true, button:0, pointerId:8, clientX:movedStart.x + 600 * scale, clientY:movedStart.y}));
    assert(WireRouter.pointAt(WireRouter.create(data.components, data.wires).route(2), data.wires[3].branch.fraction).x === 300,
      "超出主線的拖曳不可改變接點");
    app.loadSample();
  });
  test("horizontal branch slides along a vertical parent and cancel restores the junction", () => {
    app.eval(`model = {diagramVersion:2, stopTime:1, components:[
      {id:"a",type:"resistor",value:1,x:0,y:0},
      {id:"b",type:"resistor",value:1,x:0,y:408},
      {id:"g",type:"ground",x:240,y:180,rotation:270}
    ],wires:[
      {from:{id:"a",port:"n"},to:{id:"b",port:"p"},route:[{x:60,y:72},{x:60,y:408}]},
      {from:{id:"g",port:"p"},to:{id:"a",port:"n"},branch:{parent:0,fraction:3/7},
       route:[{x:240,y:216},{x:60,y:216}]}
    ]}`);
    app.render(); app.fitView();
    const data = app.eval("model"), before = JSON.stringify(data.wires);
    const drag = endType => {
      const group = $("wires").querySelectorAll("g")[1], hit = group.querySelector(".wire-hit");
      const start = new app.DOMPoint(63, 216).matrixTransform(hit.getScreenCTM());
      const scale = app.eval("view.scale");
      group.setPointerCapture = () => {};
      hit.dispatchEvent(new app.PointerEvent("pointerdown", {bubbles:true, button:0, pointerId:9, clientX:start.x, clientY:start.y}));
      for (const type of ["pointermove", endType])
        group.dispatchEvent(new app.PointerEvent(type, {bubbles:true, button:0, pointerId:9, clientX:start.x, clientY:start.y + 24 * scale}));
    };
    drag("pointercancel");
    assert(JSON.stringify(data.wires) === before, "取消拖曳不得更動主線或分支");
    drag("pointerup");
    const router = WireRouter.create(data.components, data.wires), route = router.route(1);
    const point = WireRouter.pointAt(router.route(0), data.wires[1].branch.fraction);
    assert(point.x === 60 && point.y === 240 && route.at(-1).y === 240 && route.at(-2).y === 240,
      "水平分支與接點應一起沿垂直主線移動");
    assert(router.validManual(1, route) && route.every(p => WireRouter.onGrid(p.x) && WireRouter.onGrid(p.y)),
      "更新後的分支必須有效並對齊格點");
    app.loadSample();
  });
  test("branch at a parent corner slides along the perpendicular segment", () => {
    app.eval(`model = {diagramVersion:2, stopTime:1, components:[
      {id:"a",type:"resistor",value:1,x:0,y:0},
      {id:"b",type:"resistor",value:1,x:0,y:408},
      {id:"g",type:"ground",x:240,y:180,rotation:270}
    ],wires:[
      {from:{id:"a",port:"n"},to:{id:"b",port:"p"},
       route:[{x:60,y:72},{x:60,y:120},{x:24,y:120},{x:24,y:216},{x:60,y:216},{x:60,y:408}]},
      {from:{id:"g",port:"p"},to:{id:"a",port:"n"},branch:{parent:0,fraction:0.6},
       route:[{x:240,y:216},{x:60,y:216}]}
    ]}`);
    const data = app.eval("model");
    const parent = data.wires[0].route;
    data.wires[1].branch.fraction = WireRouter.nearest(parent, {x:60,y:216}).fraction;
    assert(WireRouter.create(data.components, data.wires).validManual(1, data.wires[1].route),
      "轉角分支的初始路徑必須有效");
    app.render(); app.fitView();
    const group = $("wires").querySelectorAll("g")[1], hit = group.querySelector(".wire-hit");
    const start = new app.DOMPoint(63, 216).matrixTransform(hit.getScreenCTM());
    const scale = app.eval("view.scale");
    group.setPointerCapture = () => {};
    hit.dispatchEvent(new app.PointerEvent("pointerdown", {bubbles:true, button:0, pointerId:10, clientX:start.x, clientY:start.y}));
    for (const type of ["pointermove", "pointerup"])
      group.dispatchEvent(new app.PointerEvent(type, {bubbles:true, button:0, pointerId:10, clientX:start.x, clientY:start.y + 24 * scale}));
    const router = WireRouter.create(data.components, data.wires), route = router.route(1);
    const point = WireRouter.pointAt(router.route(0), data.wires[1].branch.fraction);
    assert(point.x === 60 && point.y === 240 && route.at(-1).y === 240 && route.at(-2).y === 240,
      "位於轉角的接點應沿垂直主線滑動");
    assert(router.validManual(1, route), "滑動後的分支必須有效");
    app.loadSample();
  });
  test("clicking a wire creates a branch and dragging the main segment moves the junction", () => {
    app.loadSample();
    app.eval("model.wires.pop()");
    app.render();
    doc.querySelector('[aria-label="連接 ground1.p"]').click();
    const wire = $("wires").querySelectorAll("g")[2].querySelectorAll(".wire-hit")[1];
    const point = new app.DOMPoint(276, 204).matrixTransform(wire.getScreenCTM());
    wire.dispatchEvent(new app.MouseEvent("click", {bubbles: true, clientX: point.x, clientY: point.y}));
    const branch = app.eval("model.wires[3]");
    assert(branch && branch.branch.parent === 2, "應建立指向主線的分支");
    const oldJunction = WireRouter.pointAt(branch ? app.eval("model.wires[2].route") : [], branch.branch.fraction);
    assert(Math.abs(oldJunction.x - 276) < 2 && near(oldJunction.y, 204), "接點應在點擊位置");
    assert(app.eval("CircuitEngine.generate(model)").includes("connect(ground1.p, capacitor1.n)"), "分支應產生電氣連接");
    const main = $("wires").querySelectorAll("g")[2];
    main.setPointerCapture = () => {};
    const start = new app.DOMPoint(348, 204).matrixTransform(main.getScreenCTM());
    const hit = [...main.querySelectorAll(".wire-hit")].find(path => path.getAttribute("d").includes("492 204 L 276 204"));
    hit.dispatchEvent(new app.PointerEvent("pointerdown", {bubbles: true, button: 0, pointerId: 7, clientX: start.x, clientY: start.y}));
    for (const [type, y] of [["pointermove", start.y - 20], ["pointerup", start.y - 20]])
      main.dispatchEvent(new app.PointerEvent(type, {bubbles: true, button: 0, pointerId: 7, clientX: start.x, clientY: y}));
    const updated = app.eval("model.wires");
    const router = WireRouter.create(app.eval("model.components"), updated);
    const junction = WireRouter.pointAt(router.route(2), updated[3].branch.fraction);
    const branchEnd = router.route(3).at(-1);
    assert(router.route(2).every(p => WireRouter.onGrid(p.x) && WireRouter.onGrid(p.y)) &&
      WireRouter.onGrid(junction.x) && WireRouter.onGrid(junction.y), "手動拖曳的主線與接點應對齊格點");
    assert(near(junction.x, oldJunction.x) && junction.y < 204 && near(branchEnd.x, junction.x) && near(branchEnd.y, junction.y),
      `接點及分支應隨主線拖曳 ${JSON.stringify({junction, branchEnd, main: router.route(2)})}`);
    assert(doc.querySelector(".wire-junction"), "拖曳後仍應顯示接點");
    app.loadSample();
  });
  test("deleting a parent confirms and removes descendants and preserves unrelated wires", () => {
    app.loadSample();
    app.eval("model.wires.push({from: {id:'resistor1',port:'n'}, to:{id:'ground1',port:'p'}, branch:{parent:3,fraction:0.5}})");
    app.render();
    let message = "";
    app.confirm = text => { message = text; return false; };
    $("wires").querySelectorAll(".wire")[2].dispatchEvent(new app.MouseEvent("click", {bubbles: true}));
    assert(message.includes("2 條分支") && app.eval("model.wires.length") === 5, "取消時應顯示所有分支且不刪除");
    app.confirm = () => true;
    $("wires").querySelectorAll(".wire")[2].dispatchEvent(new app.MouseEvent("click", {bubbles: true}));
    assert(app.eval("model.wires.length") === 2, "應刪除主線及所有分支");
    app.loadSample();
  });
  test("removing an unrelated wire remaps branch references", () => {
    app.loadSample();
    app.removeWires(new Set([0]));
    const saved = app.eval("model");
    assert(saved.wires[2].branch.parent === 1, "移除其他連線後主線索引應更新");
    const router = WireRouter.create(saved.components, saved.wires);
    assert(router.route(2) && app.eval("CircuitEngine.generate(model)").includes("connect(ground1.p, voltage1.n)"),
      "重編索引後分支仍須可繞線且電氣有效");
    app.loadSample();
  });
  test("sample ground wire crosses its own net without an extra junction", () => {
    const components = [
      {id: "voltage1", x: 25, y: 110}, {id: "resistor1", x: 240, y: 45},
      {id: "capacitor1", x: 480, y: 150}, {id: "ground1", x: 240, y: 270}
    ];
    const wires = [
      {from: {id: "voltage1", port: "p"}, to: {id: "resistor1", port: "p"}},
      {from: {id: "resistor1", port: "n"}, to: {id: "capacitor1", port: "p"}},
      {from: {id: "capacitor1", port: "n"}, to: {id: "voltage1", port: "n"}},
      {from: {id: "ground1", port: "p"}, to: {id: "voltage1", port: "n"}}
    ];
    const router = WireRouter.create(components, wires);
    const routes = wires.map((wire, i) => router.route(i));
    const geometry = WireRouter.crossings(wires, routes);
    assert(geometry.junctions.length === 1 && geometry.junctions[0].x === 85 && geometry.junctions[0].y === 194,
      "應只保留真正的三點接點");
    assert(geometry.bridges.get("2:1").includes(300), "同一網路在別處連接時，穿越處仍應跨線");
    assert(!geometry.ambiguous, "範例跨線不應產生警告");
  });
  test("same-net straight crossing remains a bridge but branch junction takes precedence", () => {
    const e = id => ({id, port: "p"});
    const wires = [{from: e("a"), to: e("b")}, {from: e("a"), to: e("c")}];
    const routes = [[{x: 0, y: 0}, {x: 100, y: 0}],
      [{x: 50, y: -50}, {x: 50, y: 50}]];
    let geometry = WireRouter.crossings(wires, routes);
    assert(geometry.junctions.length === 0 && geometry.bridges.get("0:0").includes(50), "直線交叉不應顯示接點");
    wires.push({from: e("a"), to: e("d")});
    routes.push([{x: 50, y: 0}, {x: 80, y: 0}]);
    geometry = WireRouter.crossings(wires, routes);
    assert(geometry.junctions.some(point => point.x === 50 && point.y === 0), "實際分支應顯示接點");
    assert(!geometry.bridges.has("0:0"), "同一接點不應同時繪製跨線");
  });
  test("voltage polarity stays upright and ground has one terminal at every rotation", () => {
    const expectedPolarity = [
      "M 56 27 h 8 M 60 23 v 8 M 56 45 h 8",
      "M 65 36 h 8 M 69 32 v 8 M 47 36 h 8",
      "M 56 45 h 8 M 60 41 v 8 M 56 27 h 8",
      "M 47 36 h 8 M 51 32 v 8 M 65 36 h 8"
    ];
    for (const [index, angle] of [0, 90, 180, 270].entries()) {
      const voltage = app.symbol("voltage", angle);
      assert(voltage.querySelector("g").getAttribute("transform").includes(`rotate(${(angle + 90) % 360})`), "電壓源符號方向錯誤");
      assert(voltage.querySelector(":scope > path").getAttribute("d") === expectedPolarity[index], "電壓源極性方向錯誤");
      const ground = app.symbol("ground", angle);
      assert(ground.querySelector("g").getAttribute("transform").includes(`rotate(${(angle + 90) % 360})`), "接地符號方向錯誤");
      const part = {x: 0, y: 0, rotation: angle};
      const p = WireRouter.port(part, "p");
      assert([p.x, p.y].join(",") === [[60, 0], [120, 36], [60, 72], [0, 36]][index].join(","), "接地端點方向錯誤");
    }
    assert(doc.querySelectorAll('.node[aria-label="接地 ground1"] .port').length === 1, "接地應只有一個端點");
  });
  test("property rotation preserves upright labels and simulation results", () => {
    const node = doc.querySelector('.node[aria-label="電阻 resistor1"]');
    node.setPointerCapture = () => {};
    node.dispatchEvent(new app.PointerEvent("pointerdown", {button: 0, bubbles: true}));
    app.showResults({names: ["time", "capacitor1.v"], columns: [[0, 1], [0, 5]], timeIndex: 0});
    doc.querySelector(".rotation-controls button:last-child").click();
    const updated = doc.querySelector('.node[aria-label="電阻 resistor1"]');
    assert(updated.querySelector(".symbol g").getAttribute("transform").includes("rotate(90)"), "符號未旋轉");
    assert(updated.querySelector(".node-label").style.transform === "", "文字不應跟隨符號旋轉");
    const port = updated.querySelector(".port.p");
    assert(port.style.left === "60px" && port.style.top === "0px", "畫布端點未旋轉");
    assert($("workspace-count").textContent === "2", "旋轉不應清除模擬結果");
    doc.querySelector(".rotation-controls button:first-child").click();
  });
  test("wires avoid moved components and retain endpoint connections", () => {
    const components = [
      {id: "a", x: 0, y: 0, rotation: 270}, {id: "b", x: 500, y: 0, rotation: 270}, {id: "obstacle", x: 250, y: 0}
    ];
    const wires = [{from: {id: "a", port: "n"}, to: {id: "b", port: "p"}}];
    const route = () => WireRouter.create(components, wires).route(0);
    const points = route();
    assert(points && points.length >= 4, "連線未繞開障礙");
    assert(points[0].x === 120 && points[0].y === 36 && points.at(-1).x === 500 && points.at(-1).y === 36, "連線端點錯誤");
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      assert(a.x === b.x || a.y === b.y, "連線應水平或垂直");
      for (const part of components) {
        const hit = a.x === b.x
          ? a.x > part.x && a.x < part.x + 120 && Math.max(a.y, b.y) > part.y && Math.min(a.y, b.y) < part.y + 72
          : a.y > part.y && a.y < part.y + 72 && Math.max(a.x, b.x) > part.x && Math.min(a.x, b.x) < part.x + 120;
        assert(!hit, `連線穿過 ${part.id}`);
      }
    }
    components[2].y = 200;
    const moved = route();
    assert(moved && moved.length === 2, "移開障礙後連線未更新");
    components[2].x = 120; components[2].y = 0;
    assert(route() === null, "端點被遮擋時應回報無法繞線");
  });
  test("moving a component preserves distant wire segments and branch junctions", () => {
    app.loadSample();
    const data = app.eval("model"), beforeCode = app.eval("CircuitEngine.generate(model)");
    const beforeRouter = WireRouter.create(data.components, data.wires);
    const before = data.wires.map((wire, i) => beforeRouter.route(i).map(p => ({...p})));
    const oldJunction = WireRouter.pointAt(before[2], data.wires[3].branch.fraction);
    const node = doc.querySelector('.node[aria-label="電阻 resistor1"]');
    node.setPointerCapture = () => {};
    for (const [type, x, y] of [["pointerdown", 100, 100], ["pointermove", 120, 110], ["pointerup", 120, 110]])
      node.dispatchEvent(new app.PointerEvent(type, {bubbles: true, button: 0, pointerId: 7, clientX: x, clientY: y}));
    const router = WireRouter.create(data.components, data.wires), routes = data.wires.map((wire, i) => router.route(i));
    assert(routes.every(Boolean), "移動後所有線路都應連接");
    assert(JSON.stringify(routes[2]) === JSON.stringify(before[2]) && JSON.stringify(routes[3]) === JSON.stringify(before[3]),
      "未受阻擋的其他線路不應改變");
    const junction = WireRouter.pointAt(routes[2], data.wires[3].branch.fraction);
    assert(near(junction.x, oldJunction.x) && near(junction.y, oldJunction.y), "接點位置應保持不變");
    assert(JSON.stringify(routes[0][0]) === JSON.stringify(before[0][0]) &&
      JSON.stringify(routes[1].at(-1)) === JSON.stringify(before[1].at(-1)) &&
      routes[0][1].x === before[0][1].x && routes[1].at(-2).x === before[1].at(-2).x,
      "移動元件時應保留另一端端點與其垂直連線");
    assert(app.eval("CircuitEngine.generate(model)") === beforeCode, "移動不得改變電氣連接");
    app.loadSample();
  });
  test("endpoint adjustment follows both symbol orientations", () => {
    const vertical = [{x: 0, y: 0}, {x: 0, y: 100}, {x: 100, y: 100}, {x: 100, y: 200}];
    const moved = WireRouter.moveEndpoint(vertical, {x: 20, y: 10}, true);
    assert(JSON.stringify(moved) === JSON.stringify([{x: 20, y: 10}, {x: 20, y: 100},
      {x: 100, y: 100}, {x: 100, y: 200}]), "直立元件應維持遠端線路");
    const horizontal = [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}, {x: 200, y: 100}];
    const other = WireRouter.moveEndpoint(horizontal, {x: 220, y: 120}, false);
    assert(JSON.stringify(other) === JSON.stringify([{x: 0, y: 0}, {x: 100, y: 0},
      {x: 100, y: 120}, {x: 220, y: 120}]), "水平元件應維持遠端線路");
    const straight = WireRouter.moveEndpoint([{x:0,y:0},{x:0,y:60}], {x:12,y:12}, true);
    assert(straight.every(point => WireRouter.onGrid(point.x) && WireRouter.onGrid(point.y)),
      "直線改為折線時轉折點仍須位於格點");
    assert(WireRouter.pointAt([{x:0,y:0},{x:48,y:0}], 0.999).x === 36,
      "主線接點吸附格點時不可超出線段內部");
  });
  test("moving a branch source or parent preserves junction and saved routes", () => {
    app.loadSample();
    const data = app.eval("model");
    const drag = (name, dx, dy) => {
      const node = doc.querySelector(`.node[aria-label="${name}"]`);
      node.setPointerCapture = () => {};
      for (const [type, x, y] of [["pointerdown", 100, 100], ["pointermove", 100 + dx, 100 + dy], ["pointerup", 100 + dx, 100 + dy]])
        node.dispatchEvent(new app.PointerEvent(type, {bubbles: true, button: 0, pointerId: 7, clientX: x, clientY: y}));
    };
    for (const [name, dx, dy] of [["接地 ground1", 25, 30], ["電容 capacitor1", 30, 20]]) {
      drag(name, dx, dy);
      const saved = JSON.parse(JSON.stringify(data));
      const router = WireRouter.create(saved.components, saved.wires);
      const parent = router.route(2), branch = router.route(3);
      assert(parent && branch, "移動後主線與分支均應可繞線");
      const point = WireRouter.pointAt(parent, saved.wires[3].branch.fraction);
      const source = WireRouter.port(saved.components.find(part => part.id === "ground1"), "p");
      assert(near(branch[0].x, source.x) && near(branch[0].y, source.y) &&
        near(branch.at(-1).x, point.x) && near(branch.at(-1).y, point.y), "元件、接點與分支必須保持連接");
      if (name === "接地 ground1") assert(point.x === source.x && branch.length === 2,
        "水平移動接地時接點應隨之滑動，並維持垂直線段");
      assert(saved.wires.every((wire, i) => router.validManual(i, wire.route)), "保存的線路須能重新載入");
      assert(app.eval("CircuitEngine.generate(model)").includes("connect(ground1.p, voltage1.n)"), "分支電氣連接必須保留");
    }
    app.loadSample();
  });
  test("ground dragging updates its visible branch continuously in both directions", () => {
    for (const [dx, dy] of [[48, 0], [-48, 0], [0, 48], [48, 48]]) {
      app.loadSample();
      const data = app.eval("model"), code = app.eval("CircuitEngine.generate(model)");
      const node = doc.querySelector('.node[aria-label="接地 ground1"]'), scale = app.eval("view.scale");
      node.setPointerCapture = () => {};
      node.dispatchEvent(new app.PointerEvent("pointerdown", {bubbles:true, button:0, pointerId:12, clientX:100, clientY:100}));
      for (const ratio of [0.5, 1]) {
        node.dispatchEvent(new app.PointerEvent("pointermove", {bubbles:true, button:0, pointerId:12,
          clientX:100 + dx * scale * ratio, clientY:100 + dy * scale * ratio}));
        const router = WireRouter.create(data.components, data.wires), route = router.route(3);
        const point = WireRouter.pointAt(router.route(2), data.wires[3].branch.fraction);
        const port = WireRouter.port(data.components.find(part => part.id === "ground1"), "p");
        assert(route && router.validManual(3, route) && route[0].x === port.x && route[0].y === port.y &&
          route.at(-1).x === point.x && route.at(-1).y === point.y && point.x === port.x,
          "拖曳過程中接地端點與主線節點應連接並對齊");
        const visible = $("wires").querySelectorAll("path.wire")[3].getAttribute("d");
        assert(visible.includes(`${port.x} ${port.y}`) && visible.includes(`${point.x} ${point.y}`),
          "畫出的分支應與實際路由一致");
      }
      node.dispatchEvent(new app.PointerEvent("pointerup", {bubbles:true, button:0, pointerId:12,
        clientX:100 + dx * scale, clientY:100 + dy * scale}));
      assert(app.eval("CircuitEngine.generate(model)") === code, "拖曳不得改變電氣連線");
    }
    app.loadSample();
  });
  test("moving an unrelated obstacle reroutes only when it blocks a wire", () => {
    app.eval(`model = {components: [
      {id:"a",type:"resistor",value:1,x:0,y:0,rotation:270},
      {id:"b",type:"resistor",value:1,x:500,y:0,rotation:270},
      {id:"block",type:"resistor",value:1,x:220,y:200,rotation:0}],
      wires:[{from:{id:"a",port:"n"},to:{id:"b",port:"p"}}],stopTime:1}`);
    app.render(); app.fitView();
    const node = doc.querySelector('.node[aria-label="電阻 block"]'), scale = app.eval("view.scale");
    node.setPointerCapture = () => {};
    for (const [type, y] of [["pointerdown", 300], ["pointermove", 300 - 200 * scale], ["pointerup", 300 - 200 * scale]])
      node.dispatchEvent(new app.PointerEvent(type, {bubbles: true, button: 0, pointerId: 7, clientX: 100, clientY: y}));
    const data = app.eval("model"), router = WireRouter.create(data.components, data.wires), route = router.route(0);
    assert(route && route.length > 2 && router.validManual(0, route), "元件擋住原路徑時應重新繞線");
    assert(route[0].x === 120 && route.at(-1).x === 500, "重新繞線不得改變電氣端點");
    app.loadSample();
  });
  test("wire deletion requires confirmation", () => {
    app.showResults({names: ["time", "capacitor1.v"], columns: [[0, 1], [0, 5]], timeIndex: 0});
    const count = $("count").textContent;
    app.confirm = () => false;
    $("wires").querySelector("path").dispatchEvent(new app.MouseEvent("click", {bubbles: true}));
    assert($("count").textContent === count && $("workspace-count").textContent === "2", "取消刪除不應更動連線或結果");
    app.confirm = () => true;
    $("wires").querySelector("path").dispatchEvent(new app.MouseEvent("click", {bubbles: true}));
    assert($("count").textContent.includes("3 條連線") && $("workspace-count").textContent === "0", "確認後應刪除連線並清除舊結果");
  });
  test("blocked endpoint shows and clears a warning", () => {
    app.loadSample();
    const node = doc.querySelector('.node[aria-label="直流電壓源 voltage1"]');
    app.addComponent("ground", parseFloat(node.style.left), parseFloat(node.style.top) - 12);
    assert(!$("wire-warning").hidden && $("wires").querySelector(".wire-unrouted"), "無法繞線時應顯示警告");
    app.removeSelected();
    assert($("wire-warning").hidden && !$("wires").querySelector(".wire-unrouted"), "移開障礙後警告應消失");
  });
  test("zoom keeps the selected screen point fixed", () => {
    const rect = $("canvas").getBoundingClientRect();
    const x = 120, y = 90, before = app.canvasPoint(rect.left + x, rect.top + y);
    app.zoomAt(2, x, y);
    const after = app.canvasPoint(rect.left + x, rect.top + y);
    assert(near(before.x, after.x) && near(before.y, after.y), "縮放錨點偏移");
  });
  test("fill view includes all components, including negative positions", () => {
    app.addComponent("resistor", -1200, -600);
    app.addComponent("capacitor", 1200, 700);
    $("fit-view").click();
    const rect = $("canvas").getBoundingClientRect();
    for (const node of doc.querySelectorAll(".node")) {
      const bounds = node.getBoundingClientRect();
      assert(bounds.left >= rect.left && bounds.right <= rect.right && bounds.top >= rect.top && bounds.bottom <= rect.bottom, "元件超出畫布");
    }
  });
  test("view changes preserve simulation results", () => {
    app.showResults({names: ["time", "capacitor1.v"], columns: [[0, 1], [0, 5]], timeIndex: 0});
    $("zoom-in").click(); $("zoom-out").click(); $("fit-view").click();
    assert($("workspace-count").textContent === "2" && $("result-state").textContent === "模擬完成", "變更視角不應清除結果");
  });
  test("empty canvas fit resets zoom", () => {
    app.confirm = () => true;
    $("clear").click(); $("fit-view").click();
    assert($("zoom-level").textContent === "100%", "空畫布未還原視角");
    assert($("canvas-world").style.transform === "translate(0px, 0px) scale(1)", "空畫布位置未還原");
  });
  test("old orientation and manual routes survive model import", async () => {
    async function importModel(data) {
      const transfer = new app.DataTransfer();
      transfer.items.add(new app.File([JSON.stringify(data)], "model.json", {type: "application/json"}));
      $("load").files = transfer.files;
      $("load").dispatchEvent(new app.Event("change", {bubbles: true}));
      for (let i = 0; i < 50 && $("load").value; i++) await new Promise(resolve => setTimeout(resolve, 10));
    }
    const components = [
      {id: "a", type: "resistor", value: 1, x: 0, y: 0},
      {id: "b", type: "resistor", value: 1, x: 500, y: 0}
    ];
    const wire = {from: {id: "a", port: "n"}, to: {id: "b", port: "p"}};
    await importModel({components, wires: [wire], stopTime: 1});
    assert(doc.querySelector('.node[aria-label="電阻 a"] .symbol g').getAttribute("transform").includes("rotate(0)"), "舊模型方向未保留");
    const saved = app.eval("JSON.parse(JSON.stringify(model))");
    saved.components[1].x = 500;
    saved.wires[0].route = [{x: 120, y: 36}, {x: 132, y: 36}, {x: 132, y: 100},
      {x: 488, y: 100}, {x: 488, y: 36}, {x: 500, y: 36}];
    await importModel(saved);
    assert($("wires").querySelector("path").getAttribute("d").includes("132 96"), "手動線路未對齊格點");
    assert($("message").textContent.includes("已對齊格點") && app.eval("model.components[1].x") === 504,
      "舊模型匯入應顯示格點調整結果");
    const invalid = JSON.parse(JSON.stringify(saved));
    invalid.wires[0].route[1].y = 99;
    await importModel(invalid);
    assert($("message").textContent.includes("手動線路格式或座標無效"), "錯誤手動線路應被拒絕");
    assert($("wires").querySelector("path").getAttribute("d").includes("132 96"), "匯入失敗不得更改原模型");
    app.loadSample();
    app.confirm = () => true;
    $("optimize-layout").click();
    const withBranch = app.eval("JSON.parse(JSON.stringify(model))");
    await importModel(withBranch);
    assert(app.eval("model.wires[3].branch.parent") === 2 && $("wires").querySelector(".wire-junction"),
      "分支應隨模型匯入並保留接點");
    withBranch.wires[3].branch.parent = 3;
    await importModel(withBranch);
    assert($("message").textContent.includes("線路分支資料無效"), "循環分支應被拒絕");
    assert(app.eval("model.wires[3].branch.parent") === 2, "匯入失敗不得改變原分支");
  });

  let failures = 0;
  for (const [name, run] of tests) {
    try { await run(); output.textContent += `PASS ${name}\n`; }
    catch (error) { failures++; output.textContent += `FAIL ${name}: ${error.message}\n`; }
  }
  output.dataset.failures = String(failures);
});
