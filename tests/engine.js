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
