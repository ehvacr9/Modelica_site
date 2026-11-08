"use strict";

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function fails(fn) { try { fn(); } catch (error) { return; } throw new Error("預期輸入被拒絕"); }
const csv = text => new TextEncoder().encode(text);

test("parses all variables and quoted array names", () => {
  const result = CircuitEngine.parseCsv(csv('"time","x[1,2]","der(x)"\r\n0,1,-1\r\n1,2,3\r\n'));
  assert(result.names.join("|") === "time|x[1,2]|der(x)", "變數名稱錯誤");
  assert(result.timeIndex === 0 && result.columns[1][1] === 2 && result.columns[2][1] === 3, "資料欄位錯誤");
});
test("rejects malformed or missing values", () => {
  for (const text of ['"time","x"\n0,\n', '"time","x"\n0\n', '"time","x"\n0,NaN\n', '"time","x"\n0,1,2\n', '"time","x"\n"0,1\n', '"time","time"\n0,1\n', '"x"\n1\n']) {
    fails(() => CircuitEngine.parseCsv(csv(text)));
  }
});
test("validates connections", () => {
  fails(() => CircuitEngine.generate({components: [{id:"g", type:"ground"}], wires: [], stopTime:1}, true));
});
test("validates branch parent, position and electrical target", () => {
  const model = {components: [{id:"a",type:"ground"}, {id:"b",type:"ground"}, {id:"c",type:"ground"}],
    wires: [{from:{id:"a",port:"p"},to:{id:"b",port:"p"}},
      {from:{id:"c",port:"p"},to:{id:"a",port:"p"},branch:{parent:0,fraction:0.5}}],stopTime:1};
  assert(CircuitEngine.generate(model).includes("connect(c.p, a.p)"), "分支應生成有效連接");
  for (const branch of [{parent:1,fraction:0.5},{parent:0,fraction:0},{parent:0,fraction:2},{parent:99,fraction:0.5}]) {
    model.wires[1].branch = branch; fails(() => CircuitEngine.generate(model));
  }
  model.wires[1].branch = {parent:0,fraction:0.5};
  model.wires[1].to = {id:"c",port:"p"};
  fails(() => CircuitEngine.generate(model));
});
test("accepts event timestamps but rejects decreasing time", () => {
  const result = CircuitEngine.parseCsv(csv('"time","x"\n0,1\n0.5,2\n0.5,3\n1,4\n'));
  assert(result.columns[1][2] === 3, "事件點資料錯誤");
  fails(() => CircuitEngine.parseCsv(csv('"time","x"\n0,1\n1,2\n0.5,3\n')));
});

const output = document.getElementById("results");
let failures = 0;
for (const [name, run] of tests) {
  try { run(); output.textContent += `PASS ${name}\n`; }
  catch (error) { failures++; output.textContent += `FAIL ${name}: ${error.message}\n`; }
}
output.dataset.failures = String(failures);
