"use strict";

const output = document.getElementById("results");
document.getElementById("app").addEventListener("load", event => {
  const app = event.target.contentWindow, doc = app.document;
  const $ = id => doc.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const near = (a, b) => Math.abs(a - b) < 0.001;

  test("rotation updates both terminals and obstacle-avoiding routes", () => {
    const components = [{id: "a", x: 0, y: 0}, {id: "b", x: 500, y: 200}];
    const wires = [{from: {id: "a", port: "n"}, to: {id: "b", port: "p"}}];
    const expected = [[120, 36, 0, 36], [60, 72, 60, 0], [0, 36, 120, 36], [60, 0, 60, 72]];
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
  test("voltage polarity stays upright and ground has one terminal at every rotation", () => {
    const expectedPolarity = [
      "M 47 36 h 8 M 51 32 v 8 M 65 36 h 8",
      "M 56 27 h 8 M 60 23 v 8 M 56 45 h 8",
      "M 65 36 h 8 M 69 32 v 8 M 47 36 h 8",
      "M 56 45 h 8 M 60 41 v 8 M 56 27 h 8"
    ];
    for (const [index, angle] of [0, 90, 180, 270].entries()) {
      const voltage = app.symbol("voltage", angle);
      assert(voltage.querySelector("g").getAttribute("transform").includes(`rotate(${angle})`), "電壓源符號方向錯誤");
      assert(voltage.querySelector(":scope > path").getAttribute("d") === expectedPolarity[index], "電壓源極性方向錯誤");
      const ground = app.symbol("ground", angle);
      assert(ground.querySelector("g").getAttribute("transform").includes(`rotate(${angle})`), "接地符號方向錯誤");
      const part = {x: 0, y: 0, rotation: angle};
      const p = WireRouter.port(part, "p");
      assert([p.x, p.y].join(",") === [[0, 36], [60, 0], [120, 36], [60, 72]][index].join(","), "接地端點方向錯誤");
    }
    assert(doc.querySelectorAll('.node[aria-label="接地 ground1"] .port').length === 1, "接地應只有一個端點");
  });
  test("property rotation preserves upright labels and simulation results", () => {
    const node = doc.querySelector('.node[aria-label="電阻 resistor1"]');
    node.setPointerCapture = () => {};
    node.dispatchEvent(new app.PointerEvent("pointerdown", {button: 0, bubbles: true}));
    app.showResults({names: ["time", "capacitor1.v"], columns: [[0, 1], [0, 5]], timeIndex: 0});
    const select = doc.querySelector('[aria-label="元件方向"]');
    select.value = "90"; select.dispatchEvent(new app.Event("change", {bubbles: true}));
    const updated = doc.querySelector('.node[aria-label="電阻 resistor1"]');
    assert(updated.querySelector(".symbol g").getAttribute("transform").includes("rotate(90)"), "符號未旋轉");
    assert(updated.querySelector(".node-label").style.transform === "", "文字不應跟隨符號旋轉");
    const port = updated.querySelector(".port.p");
    assert(port.style.left === "60px" && port.style.top === "0px", "畫布端點未旋轉");
    assert($("workspace-count").textContent === "2", "旋轉不應清除模擬結果");
    doc.querySelector('[aria-label="元件方向"]').value = "0";
    doc.querySelector('[aria-label="元件方向"]').dispatchEvent(new app.Event("change", {bubbles: true}));
  });
  test("wires avoid moved components and retain endpoint connections", () => {
    const components = [
      {id: "a", x: 0, y: 0}, {id: "b", x: 500, y: 0}, {id: "obstacle", x: 250, y: 0}
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
    app.addComponent("ground", parseFloat(node.style.left) - 20, parseFloat(node.style.top));
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

  let failures = 0;
  for (const [name, run] of tests) {
    try { run(); output.textContent += `PASS ${name}\n`; }
    catch (error) { failures++; output.textContent += `FAIL ${name}: ${error.message}\n`; }
  }
  output.dataset.failures = String(failures);
});
