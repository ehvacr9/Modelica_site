"use strict";

const output = document.getElementById("results");
document.getElementById("app").addEventListener("load", event => {
  const app = event.target.contentWindow, doc = app.document;
  const $ = id => doc.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const near = (a, b) => Math.abs(a - b) < 0.001;

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
