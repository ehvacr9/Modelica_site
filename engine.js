"use strict";

const CircuitEngine = (() => {
  const types = {
    voltage: ["Modelica.Electrical.Analog.Sources.ConstantVoltage", "V", ["p", "n"]],
    resistor: ["Modelica.Electrical.Analog.Basic.Resistor", "R", ["p", "n"]],
    capacitor: ["Modelica.Electrical.Analog.Basic.Capacitor", "C", ["p", "n"]],
    ground: ["Modelica.Electrical.Analog.Basic.Ground", null, ["p"]]
  };

  function generate(data, simulation = false) {
    if (!data || !Array.isArray(data.components) || !Array.isArray(data.wires) ||
        data.components.length > 100 || data.wires.length > 300) throw new Error("元件或連線格式無效，或超出數量上限。");
    const parts = new Map(), connected = new Set(), pairs = new Set();
    const lines = ["model CircuitPrototype"];
    for (const part of data.components) {
      if (!part || typeof part.id !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(part.id) ||
          parts.has(part.id) || !Object.hasOwn(types, part.type)) throw new Error("元件名稱重複或類型無效。");
      const [cls, parameter, ports] = types[part.type];
      parts.set(part.id, {kind: part.type, ports});
      let modifier = "";
      if (parameter) {
        const value = part.value;
        if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12 ||
            (["resistor", "capacitor"].includes(part.type) && value <= 0)) throw new Error(`${part.id} 的參數無效。`);
        modifier = `(${parameter}=${value})`;
      }
      lines.push(`  ${cls} ${part.id}${modifier};`);
    }
    lines.push("equation");
    for (const wire of data.wires) {
      const endpoints = [wire?.from, wire?.to];
      for (const end of endpoints) {
        if (!end || typeof end.id !== "string" || !parts.has(end.id) ||
            !parts.get(end.id).ports.includes(end.port)) throw new Error("連線包含不存在的元件或端點。");
      }
      const [a, b] = endpoints.map(end => `${end.id}.${end.port}`);
      const pair = [a, b].sort().join("|");
      if (a === b || pairs.has(pair)) throw new Error("連線不可重複或連接至自身。");
      pairs.add(pair); connected.add(a); connected.add(b);
      lines.push(`  connect(${a}, ${b});`);
    }
    lines.push("end CircuitPrototype;");
    if (simulation) {
      if (![...parts.values()].some(p => p.kind === "ground")) throw new Error("模擬前請加入接地元件。");
      const missing = [];
      for (const [id, part] of parts) for (const port of part.ports) if (!connected.has(`${id}.${port}`)) missing.push(`${id}.${port}`);
      if (missing.length) throw new Error("模擬前請連接所有端點：" + missing.join(", "));
      if (![...parts.values()].some(p => p.kind === "capacitor")) throw new Error("目前的結果圖需要至少一個電容。");
      if (typeof data.stopTime !== "number" || !Number.isFinite(data.stopTime) || data.stopTime <= 0 || data.stopTime > 1e6)
        throw new Error("模擬時間必須大於 0 且不超過 1000000 秒。");
    }
    return lines.join("\n") + "\n";
  }

  function parseCsv(bytes, variable) {
    const rows = new TextDecoder().decode(bytes).trim().split(/\r?\n/);
    const headers = rows[0].split(",").map(s => s.trim().replace(/^"|"$/g, ""));
    const time = headers.indexOf("time"), value = headers.indexOf(variable);
    if (time < 0 || value < 0) throw new Error("模擬結果缺少時間或電容電壓欄位。");
    if (rows.length < 2 || rows.length > 10001) throw new Error("模擬結果點數無效。");
    return rows.slice(1).map(row => {
      const fields = row.split(",");
      const t = Number(fields[time]), v = Number(fields[value]);
      if (fields[time] === undefined || fields[value] === undefined || !Number.isFinite(t) || !Number.isFinite(v))
        throw new Error("模擬結果包含無效數值。");
      return [t, v];
    });
  }

  async function simulate(data, status) {
    const code = generate(data, true);
    const variable = data.components.find(part => part.type === "capacitor").id + ".v";
    const worker = new Worker(new URL("./vendor/omc_worker.js", document.baseURI), {type: "module"});
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        let stage = 0;
        timer = setTimeout(() => reject(new Error("OpenModelica 執行逾時（180 秒）。")), 180000);
        worker.onerror = event => reject(new Error(`OpenModelica 載入失敗：${event.message || "請檢查網路連線及編譯器資源。"}`));
        worker.onmessageerror = () => reject(new Error("OpenModelica 回傳資料無法讀取。"));
        worker.onmessage = event => {
          const msg = event.data;
          if (msg.kind === "progress") {
            status(msg.total ? `下載模擬資源 ${Math.round(msg.done / msg.total * 100)}%` : "下載模擬資源…");
            return;
          }
          if (msg.kind === "ready") {
            if (!msg.ok) { reject(new Error(msg.error || "OpenModelica 初始化失敗。")); return; }
            status(`OpenModelica ${msg.version || ""} 模擬中`);
            worker.postMessage({cmd: "eval", src: "loadModel(Modelica)"});
          } else if (msg.kind === "done") {
            if (stage === 0 || stage === 1) {
              if (msg.result !== "true") { reject(new Error(msg.error || msg.result || "載入模型失敗。")); return; }
              stage++;
              const src = stage === 1 ? `loadString(${JSON.stringify(code)})` :
                `simulate(CircuitPrototype, stopTime=${data.stopTime}, numberOfIntervals=500, outputFormat="csv")`;
              worker.postMessage({cmd: "eval", src});
            } else {
              if (!/resultFile\s*=\s*"[^"]+_res\.csv"/.test(msg.result || "")) {
                reject(new Error(`OpenModelica 模擬失敗：\n${msg.error || msg.result || "未產生結果"}`)); return;
              }
              worker.postMessage({cmd: "vfsGet", id: 1, path: "CircuitPrototype_res.csv"});
            }
          } else if (msg.kind === "vfsResult") {
            if (!msg.bytes) { reject(new Error("無法讀取模擬結果檔。")); return; }
            resolve(msg.bytes);
          }
        };
        status("載入 OpenModelica 與 Modelica 函式庫…");
        worker.postMessage({cmd: "init"});
      });
      status("OpenModelica 模擬完成");
      return {points: parseCsv(response, variable), variable};
    } finally {
      clearTimeout(timer);
      worker.terminate();
    }
  }
  return {generate, simulate};
})();
