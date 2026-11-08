"use strict";

const definitions = {
  voltage: {name: "直流電壓源", english: "DC Voltage", icon: "⊕", parameter: "電壓 V", unit: "V", value: 5},
  resistor: {name: "電阻", english: "Resistor", icon: "▱", parameter: "電阻 R", unit: "Ω", value: 1000},
  capacitor: {name: "電容", english: "Capacitor", icon: "⊣", parameter: "電容 C", unit: "F", value: 0.0001},
  ground: {name: "接地", english: "Ground", icon: "⏚"}
};
const $ = id => document.getElementById(id);
let model = {components: [], wires: [], stopTime: 1};
let selected = null;
let pending = null;
let revision = 0;
let codeTimer;
let noticeTimer;

function notify(text, error = false) {
  const box = $("message");
  box.textContent = text;
  box.classList.toggle("error", error);
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, error ? 15000 : 4000);
}

async function post(path, body) {
  if (path === "/api/model") return {code: CircuitEngine.generate(body)};
  if (path === "/api/simulate") return CircuitEngine.simulate(body, text => {
    $("compiler-status").textContent = text;
  });
  throw new Error("不支援的操作。");
}

function invalidate() {
  revision++;
  $("plot-empty").hidden = false;
  $("plot-area").hidden = true;
  $("result-state").textContent = "尚未執行";
  clearTimeout(codeTimer);
  const current = revision;
  codeTimer = setTimeout(async () => {
    try {
      const result = await post("/api/model", model);
      if (current === revision) $("code").textContent = result.code;
    } catch (error) {
      if (current === revision) $("code").textContent = `無法產生程式碼：${error.message}`;
    }
  }, 100);
}

function portPosition(endpoint) {
  const item = model.components.find(part => part.id === endpoint.id);
  if (!item) return null;
  return {x: item.x + (endpoint.port === "p" ? 0 : 120), y: item.y + 36};
}

function drawWires() {
  const svg = $("wires");
  svg.replaceChildren();
  for (const [index, wire] of model.wires.entries()) {
    const a = portPosition(wire.from), b = portPosition(wire.to);
    if (!a || !b) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const mid = (a.x + b.x) / 2;
    path.setAttribute("d", `M ${a.x} ${a.y} H ${mid} V ${b.y} H ${b.x}`);
    path.setAttribute("class", "wire");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = "點擊刪除此連線";
    path.append(title);
    path.addEventListener("click", event => {
      event.stopPropagation();
      model.wires.splice(index, 1);
      render();
      invalidate();
    });
    svg.append(path);
  }
}

function connect(endpoint) {
  if (!pending) {
    pending = endpoint;
    $("wire-hint").textContent = "請選擇另一個端點";
  } else {
    const a = `${pending.id}.${pending.port}`, b = `${endpoint.id}.${endpoint.port}`;
    const exists = model.wires.some(w => {
      const from = `${w.from.id}.${w.from.port}`, to = `${w.to.id}.${w.to.port}`;
      return (from === a && to === b) || (from === b && to === a);
    });
    if (a === b) notify("請選擇不同的端點。", true);
    else if (exists) notify("這條連線已存在。", true);
    else {
      model.wires.push({from: pending, to: endpoint});
      invalidate();
    }
    pending = null;
    $("wire-hint").textContent = "READY";
  }
  render();
}

function makeNode(item) {
  const def = definitions[item.type];
  const node = document.createElement("div");
  node.className = "node" + (item.id === selected ? " selected" : "");
  node.style.left = item.x + "px";
  node.style.top = item.y + "px";
  node.setAttribute("aria-label", `${def.name} ${item.id}`);
  const icon = document.createElement("span");
  icon.className = "component-icon";
  icon.textContent = def.icon;
  const details = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = item.id;
  const value = document.createElement("small");
  value.textContent = def.parameter ? `${item.value} ${def.unit}` : def.name;
  details.append(name, value);
  node.append(icon, details);
  for (const port of item.type === "ground" ? ["p"] : ["p", "n"]) {
    const button = document.createElement("button");
    button.className = `port ${port}` + (pending && pending.id === item.id && pending.port === port ? " active" : "");
    button.title = `${item.id}.${port}`;
    button.setAttribute("aria-label", `連接 ${item.id}.${port}`);
    button.addEventListener("pointerdown", event => event.stopPropagation());
    button.addEventListener("click", event => { event.stopPropagation(); connect({id: item.id, port}); });
    node.append(button);
  }
  node.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.stopPropagation();
    selected = item.id;
    renderProperties();
    document.querySelectorAll(".node").forEach(element => element.classList.remove("selected"));
    node.classList.add("selected");
    const startX = event.clientX, startY = event.clientY, x = item.x, y = item.y;
    let moved = false;
    node.setPointerCapture(event.pointerId);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", end, {once: true});
    node.addEventListener("pointercancel", end, {once: true});
    function move(e) {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      item.x = Math.max(8, Math.min($("canvas").clientWidth - 128, x + dx));
      item.y = Math.max(8, Math.min($("canvas").clientHeight - 80, y + dy));
      node.style.left = item.x + "px";
      node.style.top = item.y + "px";
      drawWires();
    }
    function end() {
      node.removeEventListener("pointermove", move);
      if (moved) invalidate();
    }
  });
  return node;
}

function renderProperties() {
  const container = $("properties");
  container.replaceChildren();
  const item = model.components.find(part => part.id === selected);
  if (!item) {
    container.className = "properties-empty";
    const icon = document.createElement("span"); icon.textContent = "◇";
    const title = document.createElement("strong"); title.textContent = "尚未選取元件";
    const hint = document.createElement("p"); hint.textContent = "點擊元件查看其屬性";
    container.append(icon, title, hint);
    return;
  }
  container.className = "properties-form";
  const def = definitions[item.type];
  const label = document.createElement("label"); label.textContent = "元件名稱";
  const detail = document.createElement("div"); detail.className = "detail"; detail.textContent = item.id;
  const kindLabel = document.createElement("label"); kindLabel.textContent = "類型";
  const kind = document.createElement("div"); kind.className = "detail"; kind.textContent = def.name;
  container.append(label, detail, kindLabel, kind);
  if (def.parameter) {
    const valueLabel = document.createElement("label"); valueLabel.textContent = `${def.parameter} (${def.unit})`;
    const input = document.createElement("input"); input.type = "number"; input.step = "any"; input.value = item.value;
    input.addEventListener("change", () => {
      if (input.value.trim() === "" || !Number.isFinite(Number(input.value)) || ((item.type === "resistor" || item.type === "capacitor") && Number(input.value) <= 0)) {
        notify("請輸入有效的數值；電阻與電容必須大於零。", true);
        input.value = item.value;
        return;
      }
      item.value = Number(input.value);
      render();
      invalidate();
    });
    container.append(valueLabel, input);
  }
}

function render() {
  const canvas = $("canvas");
  canvas.querySelectorAll(".node").forEach(node => node.remove());
  for (const item of model.components) canvas.append(makeNode(item));
  $("empty").hidden = model.components.length > 0;
  $("count").textContent = `${model.components.length} 個元件 · ${model.wires.length} 條連線`;
  drawWires();
  renderProperties();
}

function addComponent(type, x, y) {
  let index = 1;
  while (model.components.some(item => item.id === type + index)) index++;
  const component = {id: type + index, type, x: Math.max(8, Math.min($("canvas").clientWidth - 128, x)), y: Math.max(8, Math.min($("canvas").clientHeight - 80, y))};
  if (definitions[type].parameter) component.value = definitions[type].value;
  model.components.push(component);
  selected = component.id;
  render();
  invalidate();
}

function loadSample() {
  const width = $("canvas").clientWidth;
  const right = Math.max(160, Math.min(width - 135, 480));
  const middle = Math.max(140, Math.round(right / 2));
  model = {
    components: [
      {id: "voltage1", type: "voltage", value: 5, x: 25, y: 110},
      {id: "resistor1", type: "resistor", value: 1000, x: middle, y: 45},
      {id: "capacitor1", type: "capacitor", value: 0.0001, x: right, y: 150},
      {id: "ground1", type: "ground", x: middle, y: 270}
    ],
    wires: [
      {from: {id: "voltage1", port: "p"}, to: {id: "resistor1", port: "p"}},
      {from: {id: "resistor1", port: "n"}, to: {id: "capacitor1", port: "p"}},
      {from: {id: "capacitor1", port: "n"}, to: {id: "voltage1", port: "n"}},
      {from: {id: "ground1", port: "p"}, to: {id: "voltage1", port: "n"}}
    ],
    stopTime: 1
  };
  $("stop-time").value = model.stopTime;
  selected = null; pending = null; $("wire-hint").textContent = "READY";
  render(); invalidate();
}

function drawPlot(result) {
  const svg = $("plot");
  svg.replaceChildren();
  const times = result.points.map(p => p[0]), values = result.points.map(p => p[1]);
  const minT = Math.min(...times), maxT = Math.max(...times), minV = Math.min(...values), maxV = Math.max(...values);
  const spanT = maxT - minT || 1, spanV = maxV - minV || 1;
  for (let i = 1; i < 4; i++) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0"); line.setAttribute("x2", "600");
    line.setAttribute("y1", String(i * 47.5)); line.setAttribute("y2", String(i * 47.5));
    line.setAttribute("stroke", "#eef1f6"); svg.append(line);
  }
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", result.points.map(([t, v]) => `${(t - minT) / spanT * 590 + 5},${180 - (v - minV) / spanV * 170}`).join(" "));
  line.setAttribute("fill", "none"); line.setAttribute("stroke", "#607bf3"); line.setAttribute("stroke-width", "2.5"); line.setAttribute("vector-effect", "non-scaling-stroke"); svg.append(line);
  $("plot-label").textContent = `${result.variable}  ·  電壓 (V)　 ${minV.toPrecision(4)} – ${maxV.toPrecision(4)}`;
  $("plot-range").replaceChildren();
  for (const text of [`${minT.toPrecision(3)} s`, `時間 (s)`, `${maxT.toPrecision(3)} s`]) {
    const span = document.createElement("span"); span.textContent = text; $("plot-range").append(span);
  }
  $("plot-empty").hidden = true; $("plot-area").hidden = false; $("result-state").textContent = "模擬完成";
}

for (const [type, def] of Object.entries(definitions)) {
  const button = document.createElement("button");
  button.className = "library-item"; button.draggable = true;
  const icon = document.createElement("span"); icon.className = "component-icon"; icon.textContent = def.icon;
  const text = document.createElement("span"), name = document.createElement("strong"), english = document.createElement("small");
  name.textContent = def.name; english.textContent = def.english; text.append(name, english); button.append(icon, text);
  button.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", type));
  button.addEventListener("click", () => addComponent(type, 30 + model.components.length * 20, 30 + model.components.length * 20));
  $("library").append(button);
}
$("canvas").addEventListener("dragover", event => event.preventDefault());
$("canvas").addEventListener("drop", event => {
  event.preventDefault();
  const type = event.dataTransfer.getData("text/plain");
  if (!Object.hasOwn(definitions, type)) return;
  const rect = $("canvas").getBoundingClientRect();
  addComponent(type, event.clientX - rect.left - 60, event.clientY - rect.top - 36);
});
$("canvas").addEventListener("click", event => {
  if (event.target === $("canvas") || event.target === $("wires")) {
    selected = null; pending = null; $("wire-hint").textContent = "READY"; render();
  }
});
function removeSelected() {
  if (!selected) return;
  model.components = model.components.filter(item => item.id !== selected);
  model.wires = model.wires.filter(wire => wire.from.id !== selected && wire.to.id !== selected);
  selected = null; pending = null; $("wire-hint").textContent = "READY"; render(); invalidate();
}
$("delete").addEventListener("click", removeSelected);
document.addEventListener("keydown", event => {
  if ((event.key === "Delete" || event.key === "Backspace") && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault(); removeSelected();
  }
  if (event.key === "Escape") { pending = null; $("wire-hint").textContent = "READY"; render(); }
});
$("clear").addEventListener("click", () => {
  if (!confirm("確定要清空畫布？")) return;
  model.components = []; model.wires = []; selected = null; pending = null; $("wire-hint").textContent = "READY"; render(); invalidate();
});
$("sample").addEventListener("click", () => {
  if (model.components.length && !confirm("載入範例會取代目前的模型，確定繼續？")) return;
  loadSample();
});
$("stop-time").addEventListener("change", event => {
  const value = Number(event.target.value);
  if (!event.target.value || !Number.isFinite(value) || value <= 0 || value > 1e6) {
    notify("結束時間必須大於 0 且不超過 1000000 秒。", true); event.target.value = model.stopTime; return;
  }
  model.stopTime = value; invalidate();
});
$("simulate").addEventListener("click", async () => {
  const button = $("simulate"), current = revision;
  $("compiler-status").classList.remove("error");
  button.disabled = true; button.textContent = "模擬中…"; $("result-state").textContent = "執行中";
  try {
    const result = await post("/api/simulate", model);
    if (current === revision) { drawPlot(result); notify("OpenModelica 模擬完成。"); }
    else notify("模型已變更，已忽略舊的模擬結果。");
  } catch (error) {
    if (current === revision) $("result-state").textContent = "模擬失敗";
    $("compiler-status").textContent = "OpenModelica 模擬失敗";
    $("compiler-status").classList.add("error");
    notify(error.message, true);
  } finally { button.disabled = false; button.textContent = "▶　執行模擬"; }
});
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("code").textContent); notify("已複製 Modelica 程式碼。"); }
  catch (error) { notify(`複製失敗：${error.message}`, true); }
});
$("save").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(model, null, 2)], {type: "application/json"}));
  const link = document.createElement("a"); link.href = url; link.download = "circuit.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("load").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 256000) throw new Error("檔案超過大小上限。");
    const candidate = JSON.parse(await file.text());
    await post("/api/model", candidate);
    if (typeof candidate.stopTime !== "number" || !Number.isFinite(candidate.stopTime) || candidate.stopTime <= 0 || candidate.stopTime > 1e6 ||
        candidate.components.some(item => !Number.isFinite(item.x) || !Number.isFinite(item.y) || item.x < 0 || item.y < 0 || item.x > 10000 || item.y > 10000)) {
      throw new Error("元件位置或模擬時間無效。");
    }
    model = candidate; selected = null; pending = null; $("wire-hint").textContent = "READY"; $("stop-time").value = model.stopTime;
    render(); invalidate(); notify("模型已匯入。");
  } catch (error) { notify(`匯入失敗：${error.message}`, true); }
  finally { event.target.value = ""; }
});
loadSample();
