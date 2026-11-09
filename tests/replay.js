"use strict";

const output = document.getElementById("results");
document.getElementById("app").addEventListener("load", event => {
  const app = event.target.contentWindow, doc = app.document;
  const $ = id => doc.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  let callback = null, frameId = 0;
  app.requestAnimationFrame = fn => { callback = fn; return ++frameId; };
  app.cancelAnimationFrame = () => { callback = null; };
  const frame = timestamp => {
    assert(callback !== null, "未排定動畫");
    const fn = callback; callback = null; fn(timestamp);
  };
  const input = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new app.Event("input", {bubbles: true}));
  };

  test("view tabs and result controls have the intended placement", () => {
    assert($("model-view").compareDocumentPosition($("tab-model-view")) & app.Node.DOCUMENT_POSITION_FOLLOWING, "視圖分頁應在畫布後");
    assert($("inspector-panel").contains($("replay-play")), "重播控制應在右側欄");
    assert(doc.querySelector(".replay-panel").compareDocumentPosition(doc.querySelector(".workspace-panel")) & app.Node.DOCUMENT_POSITION_FOLLOWING, "重播控制應在變數工作區上方");
    assert($("tab-plotting").textContent === "結果", "結果頁名稱錯誤");
    $("tab-code-view").click();
    assert(!$("code-view").hidden && $("model-view").hidden, "程式碼視圖切換失敗");
    $("tab-model-view").click();
    assert(!$("model-view").hidden && $("code-view").hidden, "模型視圖切換失敗");
    assert(!$("toggle-library") && !$("toggle-inspector"), "不應顯示側欄收合按鈕");
    assert(!$("library-panel").hidden && !$("inspector-panel").hidden, "側欄應保持展開");
    assert($("replay-speed").value === "1", "播放速度預設應為 1 倍");
  });
  test("tabs hide settings and initial controls are disabled", () => {
    assert($("result-sidebar").hidden && !$("model-settings").hidden, "建模頁不應顯示結果側欄");
    $("tab-plotting").click();
    assert($("model-settings").hidden && !$("result-sidebar").hidden, "結果頁側欄不正確");
    for (const id of ["replay-play", "replay-pause", "replay-speed", "replay-progress"]) assert($(id).disabled, `${id} 應停用`);
    $("tab-modeling").click();
    assert(!$("model-settings").hidden && $("result-sidebar").hidden, "建模設定或側欄未恢復");
  });
  test("playing, speed, pause and seeking preserve final values", () => {
    app.showResults({names: ["time", "capacitor1.v", "x", "capacitor1.p.i", "der(capacitor1.v)", "resistor1.LossPower", "resistor1.R_actual", "capacitor1.n.v"], timeIndex: 0,
      columns: [[0, 0.5, 0.5, 1], [0, 1, 2, 4], [1, 2, 3, 5], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 0, 0, 0]]});
    $("tab-plotting").click();
    assert($("replay-progress").value === "10000", "初始應顯示完整曲線");
    assert($("plot-y-title").textContent === "電壓 (V)", "電壓單位錯誤");
    assert([...$("plot-y-ticks").children].map(tick => tick.textContent).join(",") === "4,3,2,1,0", "縱軸刻度錯誤");
    const finalValues = $("workspace-variables").textContent;
    $("replay-speed").value = "0.5";
    $("replay-play").click();
    assert($("replay-progress").value === "0", "播放應從頭開始");
    frame(1000); frame(1500);
    assert($("replay-progress").value === "2500", "播放速度錯誤");
    assert($("plot").querySelector("polyline").getAttribute("points").split(" ").length === 2, "曲線應內插至目前時間");
    $("replay-pause").click();
    assert(callback === null && $("replay-play").disabled === false, "暫停失敗");
    input("replay-progress", "5000");
    const points = $("plot").querySelector("polyline").getAttribute("points");
    assert(points.split(" ").length === 4 && !points.includes("NaN"), "重複時間點顯示錯誤");
    doc.querySelector('[data-index="2"]').click();
    assert($("replay-progress").value === "5000" && $("plot-label").textContent.startsWith("x"), "切換變數後時間不一致");
    assert($("plot-y-title").textContent === "物理量與單位未知", "未知單位不應猜測");
    assert($("workspace-variables").textContent === finalValues, "工作區最終值不應變動");
  });
  test("axis labels follow variable units and constant signals", () => {
    for (const [index, title] of [[0, "時間 (s)"], [3, "電流 (A)"], [4, "電壓變化率 (V/s)"], [5, "損耗功率 (W)"], [6, "電阻 (Ω)"], [7, "電壓 (V)"]]) {
      doc.querySelector(`[data-index="${index}"]`).click();
      assert($("plot-y-title").textContent === title, `縱軸應為 ${title}`);
      assert($("plot").getAttribute("aria-label").includes(title), "圖表無障礙標籤應包含單位");
    }
    assert([...$("plot-y-ticks").children].map(tick => tick.textContent).join(",") === "1,0.5,0,-0.5,-1", "常數訊號的縱軸錯誤");
    assert($("plot").querySelector("polyline").getAttribute("points").split(" ").every(point => point.endsWith(",95")), "常數訊號應置於縱軸中央");
  });
  test("playback completes, restarts, and pauses on tab change", () => {
    $("replay-speed").value = "2";
    $("replay-play").click(); frame(2000); frame(2250);
    assert($("replay-progress").value === "10000" && callback === null, "未自動停止於結尾");
    $("replay-play").click();
    assert($("replay-progress").value === "0", "重播未回到開頭");
    $("tab-modeling").click();
    assert(callback === null && !$("model-settings").hidden, "離開繪圖頁未暫停");
  });
  test("model changes clear results and disable playback", () => {
    $("stop-time").value = "2";
    $("stop-time").dispatchEvent(new app.Event("change", {bubbles: true}));
    assert($("replay-play").disabled && $("workspace-count").textContent === "0", "模型變更未清除結果");
  });
  test("axis ticks remain distinct for a small range around a large value", () => {
    app.showResults({names: ["time", "capacitor1.v"], timeIndex: 0,
      columns: [[0, 1], [1000, 1000.0001]]});
    const ticks = [...$("plot-y-ticks").children].map(tick => tick.textContent);
    assert(new Set(ticks).size === 5 && Number(ticks[0]) > Number(ticks[4]), "刻度不應因四捨五入變成相同數值");
  });
  test("meter readings appear in the workspace with correct plot units", () => {
    app.addComponent("voltmeter", 720, 0);
    app.addComponent("ammeter", 900, 0);
    app.showResults({names:["time", "voltmeter1.v", "ammeter1.i"], timeIndex:0,
      columns:[[0,1],[0,5],[0,0.005]]});
    assert($("workspace-variables").textContent.includes("voltmeter1.v") &&
      $("workspace-variables").textContent.includes("ammeter1.i"), "工作區缺少量測數值");
    $("tab-plotting").click();
    doc.querySelector('[data-index="1"]').click();
    assert($("plot-y-title").textContent === "電壓 (V)", "電壓表曲線單位錯誤");
    doc.querySelector('[data-index="2"]').click();
    assert($("plot-y-title").textContent === "電流 (A)", "電流表曲線單位錯誤");
  });

  let failures = 0;
  for (const [name, run] of tests) {
    try { run(); output.textContent += `PASS ${name}\n`; }
    catch (error) { failures++; output.textContent += `FAIL ${name}: ${error.message}\n`; }
  }
  output.dataset.failures = String(failures);
});
