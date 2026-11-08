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
    for (const [toggle, panel] of [["toggle-library", "library-panel"], ["toggle-inspector", "inspector-panel"]]) {
      $(toggle).click(); assert($(panel).hidden, `${panel} 未收合`);
      $(toggle).click(); assert(!$(panel).hidden, `${panel} 未展開`);
    }
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
    app.showResults({names: ["time", "capacitor1.v", "x"], timeIndex: 0,
      columns: [[0, 0.5, 0.5, 1], [0, 1, 2, 4], [1, 2, 3, 5]]});
    $("tab-plotting").click();
    assert($("replay-progress").value === "10000", "初始應顯示完整曲線");
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
    assert($("workspace-variables").textContent === finalValues, "工作區最終值不應變動");
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

  let failures = 0;
  for (const [name, run] of tests) {
    try { run(); output.textContent += `PASS ${name}\n`; }
    catch (error) { failures++; output.textContent += `FAIL ${name}: ${error.message}\n`; }
  }
  output.dataset.failures = String(failures);
});
