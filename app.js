"use strict";

const definitions = {
  voltage: {name: "直流電壓源", parameter: "電壓 V", unit: "V", value: 5},
  resistor: {name: "電阻", parameter: "電阻 R", unit: "Ω", value: 1000},
  capacitor: {name: "電容", parameter: "電容 C", unit: "F", value: 0.0001},
  ground: {name: "接地"}
};
const $ = id => document.getElementById(id);
let model = {components: [], wires: [], stopTime: 1};
let selected = null;
let pending = null;
let revision = 0;
let codeTimer;
let noticeTimer;
let simulationResult = null;
let selectedVariable = null;
let replayTime = 0;
let replayFrame = null;
let replayLastFrame = null;
const positionLimit = 1000000;
const view = {x: 0, y: 0, scale: 1};

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
  clearResults();
  $("result-state").textContent = "尚未執行";
  $("compiler-status").textContent = "模擬時載入 OpenModelica";
  $("compiler-status").classList.remove("error");
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

function clearResults() {
  pauseReplay();
  simulationResult = null;
  selectedVariable = null;
  replayTime = 0;
  updateReplayControls();
  $("plot-empty").hidden = false;
  $("plot-area").hidden = true;
  $("plot").replaceChildren();
  $("workspace-variables").replaceChildren();
  $("workspace-empty").hidden = false;
  $("workspace-count").textContent = "0";
}

function activateTab(tabId, choices) {
  for (const [id, panel] of choices) {
    const active = id === tabId;
    $(id).classList.toggle("active", active);
    $(id).setAttribute("aria-selected", String(active));
    $(id).tabIndex = active ? 0 : -1;
    $(panel).hidden = !active;
  }
  if (choices === primaryTabs) {
    $("model-settings").hidden = tabId === "tab-plotting";
    $("result-sidebar").hidden = tabId !== "tab-plotting";
    if (tabId !== "tab-plotting") pauseReplay();
  }
  if (choices === viewTabs) $("canvas-navigation").hidden = tabId !== "tab-model-view";
}

const primaryTabs = [["tab-modeling", "modeling"], ["tab-plotting", "plotting"]];
const viewTabs = [["tab-model-view", "model-view"], ["tab-code-view", "code-view"]];
function wireTabs(choices) {
  for (const [id] of choices) {
    $(id).addEventListener("click", () => activateTab(id, choices));
    $(id).addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = choices.findIndex(([name]) => name === id);
      const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + choices.length) % choices.length;
      activateTab(choices[next][0], choices);
      $(choices[next][0]).focus();
    });
  }
}
wireTabs(primaryTabs);
wireTabs(viewTabs);

function updateView() {
  $("canvas-world").style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  $("zoom-level").textContent = `${Number((view.scale * 100).toPrecision(3))}%`;
  $("canvas").style.backgroundSize = `${20 * view.scale}px ${20 * view.scale}px`;
  $("canvas").style.backgroundPosition = `${view.x}px ${view.y}px`;
}

function canvasPoint(clientX, clientY) {
  const rect = $("canvas").getBoundingClientRect();
  return {x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale};
}

function zoomAt(scale, x, y) {
  const next = Math.max(0.00001, Math.min(4, scale));
  const ratio = next / view.scale;
  view.x = x - (x - view.x) * ratio;
  view.y = y - (y - view.y) * ratio;
  view.scale = next;
  updateView();
}

function fitView() {
  const canvas = $("canvas");
  if (!model.components.length) {
    view.x = 0; view.y = 0; view.scale = 1;
  } else {
    const minX = Math.min(...model.components.map(item => item.x));
    const minY = Math.min(...model.components.map(item => item.y));
    const maxX = Math.max(...model.components.map(item => item.x + 120));
    const maxY = Math.max(...model.components.map(item => item.y + 72));
    const margin = 30;
    view.scale = Math.min(2, Math.max(0.00001, (canvas.clientWidth - 2 * margin) / (maxX - minX)),
      Math.max(0.00001, (canvas.clientHeight - 2 * margin) / (maxY - minY)));
    view.x = (canvas.clientWidth - (maxX - minX) * view.scale) / 2 - minX * view.scale;
    view.y = (canvas.clientHeight - (maxY - minY) * view.scale) / 2 - minY * view.scale;
  }
  updateView();
}

function portPosition(endpoint) {
  const item = model.components.find(part => part.id === endpoint.id);
  if (!item) return null;
  return WireRouter.port(item, endpoint.port);
}

function symbol(type, rotation = 0) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 120 72");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("symbol");
  const group = document.createElementNS(ns, "g");
  group.setAttribute("transform", `translate(60 36) rotate(${rotation})`);
  const shapes = {
    resistor: ["M -36 0 H -27 L -23 -9 L -15 9 L -7 -9 L 1 9 L 9 -9 L 17 9 L 23 -9 L 27 0 H 36"],
    capacitor: ["M -36 0 H -7 M -7 -17 V 17 M 7 -17 V 17 M 7 0 H 36"],
    voltage: ["M -36 0 H -19 M 19 0 H 36", "M -19 0 A 19 19 0 1 0 19 0 A 19 19 0 1 0 -19 0"],
    ground: ["M -36 0 H -6 M -6 -17 V 17 M 1 -11 V 11 M 8 -5 V 5"]
  };
  for (const data of shapes[type]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", data);
    group.append(path);
  }
  svg.append(group);
  if (type === "voltage") {
    const offsets = [[-9, 0], [0, -9], [9, 0], [0, 9]];
    const [dx, dy] = offsets[rotation / 90];
    const plusX = 60 + dx, plusY = 36 + dy, minusX = 60 - dx, minusY = 36 - dy;
    const polarity = document.createElementNS(ns, "path");
    polarity.setAttribute("d", `M ${plusX - 4} ${plusY} h 8 M ${plusX} ${plusY - 4} v 8 M ${minusX - 4} ${minusY} h 8`);
    svg.append(polarity);
  }
  if (rotation % 180 === 0) {
    const leads = document.createElementNS(ns, "path");
    let data = "M 0 36 H 24";
    if (type !== "ground") data += " M 96 36 H 120";
    if (rotation === 180 && type === "ground") data = "M 96 36 H 120";
    leads.setAttribute("d", data);
    svg.append(leads);
  }
  return svg;
}

function drawWires() {
  const svg = $("wires");
  svg.replaceChildren();
  const router = WireRouter.create(model.components, model.wires);
  const failed = [];
  for (const [index, wire] of model.wires.entries()) {
    const a = portPosition(wire.from), b = portPosition(wire.to);
    if (!a || !b) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const points = router.route(index);
    if (!points) failed.push(`${wire.from.id}.${wire.from.port} ↔ ${wire.to.id}.${wire.to.port}`);
    const route = points || [a, {x: (a.x + b.x) / 2, y: a.y}, {x: (a.x + b.x) / 2, y: b.y}, b];
    path.setAttribute("d", route.map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`).join(" "));
    path.setAttribute("class", points ? "wire" : "wire wire-unrouted");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = "點擊後確認是否刪除連線";
    path.append(title);
    path.addEventListener("click", event => {
      event.stopPropagation();
      if (!confirm(`確定刪除連線 ${wire.from.id}.${wire.from.port} ↔ ${wire.to.id}.${wire.to.port}？`)) return;
      model.wires.splice(index, 1);
      render();
      invalidate();
    });
    svg.append(path);
  }
  $("wire-warning").hidden = !failed.length;
  $("wire-warning").textContent = failed.length ? `無法繞開鄰近或重疊元件的連線：${failed.join("、")}。請移開元件。` : "";
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
    $("wire-hint").textContent = "就緒";
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
  const icon = symbol(item.type, item.rotation || 0);
  const details = document.createElement("div");
  details.className = "node-label";
  const name = document.createElement("strong");
  name.textContent = item.id;
  const value = document.createElement("small");
  value.textContent = def.parameter ? `${item.value} ${def.unit}` : def.name;
  details.append(name, value);
  node.append(icon, details);
  for (const port of item.type === "ground" ? ["p"] : ["p", "n"]) {
    const button = document.createElement("button");
    button.className = `port ${port}` + (pending && pending.id === item.id && pending.port === port ? " active" : "");
    const position = WireRouter.port(item, port);
    button.style.left = `${position.x - item.x}px`;
    button.style.top = `${position.y - item.y}px`;
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
      if (!moved) return;
      item.x = Math.max(-positionLimit, Math.min(positionLimit, x + dx / view.scale));
      item.y = Math.max(-positionLimit, Math.min(positionLimit, y + dy / view.scale));
      node.style.left = item.x + "px";
      node.style.top = item.y + "px";
      drawWires();
    }
    function end() {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", end);
      node.removeEventListener("pointercancel", end);
      if (Math.abs(item.x) === positionLimit || Math.abs(item.y) === positionLimit) notify("元件已達畫布座標上限。", true);
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
  const rotationLabel = document.createElement("label");
  rotationLabel.textContent = "方向（順時針）";
  const rotation = document.createElement("select");
  rotation.setAttribute("aria-label", "元件方向");
  for (const angle of [0, 90, 180, 270]) {
    const option = document.createElement("option");
    option.value = String(angle); option.textContent = `${angle}°`;
    rotation.append(option);
  }
  rotation.value = String(item.rotation || 0);
  rotation.addEventListener("change", () => {
    item.rotation = Number(rotation.value);
    render();
  });
  container.append(rotationLabel, rotation);
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
  const canvas = $("canvas-world");
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
  if (Math.abs(x) > positionLimit || Math.abs(y) > positionLimit) {
    notify("元件位置超出畫布座標範圍，請先平移或填滿視窗。", true);
    return;
  }
  const component = {id: type + index, type, x, y};
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
  selected = null; pending = null; $("wire-hint").textContent = "就緒";
  render(); fitView(); invalidate();
}

function variableQuantity(name) {
  if (name === "time") return {quantity: "時間", unit: "s"};
  const derivative = /^der\((.+)\)$/.exec(name);
  const parts = (derivative ? derivative[1] : name).split(".");
  const component = model.components.find(item => item.id === parts[0]);
  if (!component) return null;
  const field = parts.slice(1).join(".");
  let quantity = null;
  if (["v", "p.v", "n.v"].includes(field) && !(component.type === "ground" && field !== "p.v"))
    quantity = {quantity: "電壓", unit: "V"};
  else if (["i", "p.i", "n.i"].includes(field) && !(component.type === "ground" && field !== "p.i"))
    quantity = {quantity: "電流", unit: "A"};
  else if (field === "LossPower" && ["resistor", "capacitor"].includes(component.type))
    quantity = {quantity: "損耗功率", unit: "W"};
  else if (field === "R_actual" && component.type === "resistor")
    quantity = {quantity: "電阻", unit: "Ω"};
  if (!quantity || !derivative) return quantity;
  return {quantity: `${quantity.quantity}變化率`, unit: `${quantity.unit}/s`};
}

function drawPlot(result) {
  const svg = $("plot");
  svg.replaceChildren();
  const times = result.points.map(p => p[0]), values = result.points.map(p => p[1]);
  const minT = Math.min(...times), maxT = Math.max(...times), minV = Math.min(...values), maxV = Math.max(...values);
  const padding = minV === maxV ? Math.max(Math.abs(minV) * 0.05, 1) : 0;
  const bottomV = minV - padding, topV = maxV + padding;
  const spanT = maxT - minT || 1, spanV = topV - bottomV;
  $("plot-y-ticks").replaceChildren();
  const tickValues = Array.from({length: 5}, (_, i) => topV - i * spanV / 4);
  let tickLabels;
  for (let precision = 4; precision <= 17; precision++) {
    tickLabels = tickValues.map(value => Number(value.toPrecision(precision)).toString());
    if (new Set(tickLabels).size === tickValues.length) break;
  }
  for (let i = 0; i <= 4; i++) {
    const y = 10 + i * 42.5;
    const tick = document.createElement("span");
    tick.style.top = `${y / 190 * 100}%`;
    tick.textContent = tickLabels[i];
    $("plot-y-ticks").append(tick);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0"); line.setAttribute("x2", "600");
    line.setAttribute("y1", String(y)); line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "#eef1f6"); svg.append(line);
  }
  const visible = [];
  for (const point of result.points) {
    if (point[0] <= replayTime) visible.push(point);
    else {
      const previous = visible.at(-1);
      if (previous && point[0] > previous[0]) {
        const ratio = (replayTime - previous[0]) / (point[0] - previous[0]);
        visible.push([replayTime, previous[1] + ratio * (point[1] - previous[1])]);
      }
      break;
    }
  }
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", visible.map(([t, v]) => `${(t - minT) / spanT * 590 + 5},${180 - (v - bottomV) / spanV * 170}`).join(" "));
  line.setAttribute("fill", "none"); line.setAttribute("stroke", "#607bf3"); line.setAttribute("stroke-width", "2.5"); line.setAttribute("vector-effect", "non-scaling-stroke"); svg.append(line);
  if (visible.length) {
    const [t, v] = visible.at(-1);
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("cx", String((t - minT) / spanT * 590 + 5));
    marker.setAttribute("cy", String(180 - (v - bottomV) / spanV * 170));
    marker.setAttribute("r", "3"); marker.setAttribute("fill", "#536eef"); svg.append(marker);
  }
  $("plot-label").textContent = `${result.variable}　 ${minV.toPrecision(4)} – ${maxV.toPrecision(4)}`;
  const metadata = variableQuantity(result.variable);
  $("plot-y-title").textContent = metadata ? `${metadata.quantity} (${metadata.unit})` : "物理量與單位未知";
  svg.setAttribute("aria-label", `${result.variable}：${$("plot-y-title").textContent}，隨時間變化圖`);
  $("plot-range").replaceChildren();
  for (const text of [`${minT.toPrecision(3)} s`, `時間 (s)`, `${maxT.toPrecision(3)} s`]) {
    const span = document.createElement("span"); span.textContent = text; $("plot-range").append(span);
  }
  $("plot-empty").hidden = true; $("plot-area").hidden = false;
}

function showVariable(index, openPlotting = true) {
  if (!simulationResult) return;
  selectedVariable = index;
  document.querySelectorAll(".workspace-variable").forEach(button => {
    button.classList.toggle("active", Number(button.dataset.index) === index);
    button.setAttribute("aria-pressed", String(Number(button.dataset.index) === index));
  });
  drawSelectedVariable();
  if (openPlotting) activateTab("tab-plotting", primaryTabs);
}

function drawSelectedVariable() {
  const times = simulationResult.columns[simulationResult.timeIndex];
  const values = simulationResult.columns[selectedVariable];
  drawPlot({variable: simulationResult.names[selectedVariable], points: times.map((time, i) => [time, values[i]])});
}

function updateReplayControls() {
  const available = !!simulationResult;
  $("replay-play").disabled = !available || replayFrame !== null;
  $("replay-pause").disabled = !available || replayFrame === null;
  $("replay-speed").disabled = !available;
  $("replay-progress").disabled = !available;
  if (!available) {
    $("replay-progress").value = "0";
    $("replay-time").textContent = "尚無資料";
    return;
  }
  const times = simulationResult.columns[simulationResult.timeIndex];
  const first = times[0], last = times.at(-1), span = last - first;
  $("replay-progress").value = String(span ? Math.round((replayTime - first) / span * 10000) : 0);
  $("replay-time").textContent = `${Number(replayTime.toPrecision(6))} / ${Number(last.toPrecision(6))} 秒`;
}

function pauseReplay() {
  if (replayFrame !== null) cancelAnimationFrame(replayFrame);
  replayFrame = null;
  replayLastFrame = null;
  updateReplayControls();
}

function redrawReplay() {
  updateReplayControls();
  if (simulationResult && selectedVariable !== null) drawSelectedVariable();
}

$("replay-play").addEventListener("click", () => {
  if (!simulationResult || replayFrame !== null) return;
  const times = simulationResult.columns[simulationResult.timeIndex];
  const first = times[0], last = times.at(-1);
  if (replayTime >= last) replayTime = first;
  replayLastFrame = null;
  const tick = timestamp => {
    if (replayLastFrame !== null) {
      replayTime = Math.min(last, replayTime + (timestamp - replayLastFrame) / 1000 * Number($("replay-speed").value));
    }
    replayLastFrame = timestamp;
    if (replayTime >= last) {
      replayFrame = null;
      replayLastFrame = null;
      redrawReplay();
      return;
    }
    replayFrame = requestAnimationFrame(tick);
    redrawReplay();
  };
  replayFrame = requestAnimationFrame(tick);
  redrawReplay();
});
$("replay-pause").addEventListener("click", pauseReplay);
$("replay-progress").addEventListener("input", event => {
  if (!simulationResult) return;
  const times = simulationResult.columns[simulationResult.timeIndex];
  replayTime = times[0] + (times.at(-1) - times[0]) * Number(event.target.value) / 10000;
  replayLastFrame = null;
  redrawReplay();
});
$("replay-speed").addEventListener("change", () => { replayLastFrame = null; });

function showResults(result) {
  simulationResult = result;
  replayTime = result.columns[result.timeIndex].at(-1);
  updateReplayControls();
  const body = $("workspace-variables");
  body.replaceChildren();
  result.names.forEach((name, index) => {
    const row = document.createElement("tr"), nameCell = document.createElement("td"), valueCell = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button"; button.className = "workspace-variable"; button.dataset.index = String(index);
    button.textContent = name; button.title = `繪製 ${name}`; button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => showVariable(index));
    nameCell.append(button);
    const value = result.columns[index].at(-1);
    valueCell.textContent = Number(value.toPrecision(7)).toString();
    valueCell.title = String(value);
    row.append(nameCell, valueCell); body.append(row);
  });
  $("workspace-count").textContent = String(result.names.length);
  $("workspace-empty").hidden = true;
  const capacitor = model.components.find(item => item.type === "capacitor");
  const preferred = capacitor ? result.names.indexOf(`${capacitor.id}.v`) : -1;
  const index = preferred >= 0 ? preferred : result.names.findIndex((_, i) => i !== result.timeIndex);
  if (index >= 0) showVariable(index, false);
  $("result-state").textContent = "模擬完成";
}

for (const [type, def] of Object.entries(definitions)) {
  const button = document.createElement("button");
  button.className = "library-item"; button.draggable = true;
  const icon = document.createElement("span"); icon.className = "component-icon"; icon.append(symbol(type));
  const text = document.createElement("span"), name = document.createElement("strong");
  name.textContent = def.name; text.append(name); button.append(icon, text);
  button.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", type));
  button.addEventListener("click", () => {
    activateTab("tab-modeling", primaryTabs); activateTab("tab-model-view", viewTabs);
    const canvas = $("canvas"), rect = canvas.getBoundingClientRect();
    const center = canvasPoint(rect.left + canvas.clientWidth / 2, rect.top + canvas.clientHeight / 2);
    addComponent(type, center.x - 60, center.y - 36);
  });
  $("library").append(button);
}
$("canvas").addEventListener("dragover", event => event.preventDefault());
$("canvas").addEventListener("drop", event => {
  event.preventDefault();
  const type = event.dataTransfer.getData("text/plain");
  if (!Object.hasOwn(definitions, type)) return;
  const point = canvasPoint(event.clientX, event.clientY);
  addComponent(type, point.x - 60, point.y - 36);
});
let panned = false;
$("canvas").addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.target !== $("canvas")) return;
  const canvas = $("canvas"), startX = event.clientX, startY = event.clientY, x = view.x, y = view.y;
  panned = false;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("panning");
  function move(e) {
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) panned = true;
    if (!panned) return;
    view.x = x + dx; view.y = y + dy;
    updateView();
  }
  function end() {
    canvas.classList.remove("panning");
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", end);
    canvas.removeEventListener("pointercancel", end);
  }
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
});
$("canvas").addEventListener("wheel", event => {
  event.preventDefault();
  const rect = $("canvas").getBoundingClientRect();
  zoomAt(view.scale * Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.002),
    event.clientX - rect.left, event.clientY - rect.top);
}, {passive: false});
for (const [id, factor] of [["zoom-in", 1.25], ["zoom-out", 1 / 1.25]]) {
  $(id).addEventListener("click", () => {
    const canvas = $("canvas");
    zoomAt(view.scale * factor, canvas.clientWidth / 2, canvas.clientHeight / 2);
  });
}
$("fit-view").addEventListener("click", fitView);
$("canvas").addEventListener("click", event => {
  if (panned) { panned = false; return; }
  if (event.target === $("canvas")) {
    selected = null; pending = null; $("wire-hint").textContent = "就緒"; render();
  }
});
function removeSelected() {
  if (!selected) return;
  model.components = model.components.filter(item => item.id !== selected);
  model.wires = model.wires.filter(wire => wire.from.id !== selected && wire.to.id !== selected);
  selected = null; pending = null; $("wire-hint").textContent = "就緒"; render(); invalidate();
}
$("delete").addEventListener("click", removeSelected);
document.addEventListener("keydown", event => {
  if ((event.key === "Delete" || event.key === "Backspace") && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault(); removeSelected();
  }
  if (event.key === "Escape") { pending = null; $("wire-hint").textContent = "就緒"; render(); }
});
$("clear").addEventListener("click", () => {
  if (!confirm("確定要清空畫布？")) return;
  model.components = []; model.wires = []; selected = null; pending = null; $("wire-hint").textContent = "就緒"; render(); invalidate();
});
$("sample").addEventListener("click", () => {
  if (model.components.length && !confirm("載入範例會取代目前的模型，確定繼續？")) return;
  activateTab("tab-modeling", primaryTabs); activateTab("tab-model-view", viewTabs);
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
  clearResults();
  $("compiler-status").classList.remove("error");
  button.disabled = true; button.textContent = "模擬中…"; $("result-state").textContent = "執行中";
  try {
    const result = await post("/api/simulate", model);
    if (current === revision) { showResults(result); notify("OpenModelica 模擬完成；請切換到結果頁，在變數工作區選擇變數。"); }
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
        candidate.components.some(item => !Number.isFinite(item.x) || !Number.isFinite(item.y) || Math.abs(item.x) > positionLimit || Math.abs(item.y) > positionLimit)) {
      throw new Error("元件位置或模擬時間無效。");
    }
    if (candidate.components.some(item => item.rotation !== undefined && ![0, 90, 180, 270].includes(item.rotation)))
      throw new Error("元件方向必須為 0、90、180 或 270 度。");
    model = candidate; selected = null; pending = null; $("wire-hint").textContent = "就緒"; $("stop-time").value = model.stopTime;
    activateTab("tab-modeling", primaryTabs); activateTab("tab-model-view", viewTabs);
    render(); fitView(); invalidate(); notify("模型已匯入。");
  } catch (error) { notify(`匯入失敗：${error.message}`, true); }
  finally { event.target.value = ""; }
});
loadSample();
