import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { parseCompanionPushArgs, pushCompanionVersion } from "./push-companion-version.mjs";

const args = [
  "--script",
  "character-manager",
  "--version",
  "0.3.4",
  "--name",
  "角色管理库",
  "--url",
  "https://example.org/v0.3.4.js",
];

test("defaults only to localhost and rejects unsafe origins, credentials and unknown inputs", () => {
  assert.equal(parseCompanionPushArgs(args).origin, "http://localhost:8787");
  assert.equal(
    parseCompanionPushArgs([...args, "--origin", "https://workshop.example"]).origin,
    "https://workshop.example",
  );
  for (const origin of [
    "http://remote.example",
    "https://owner:token@workshop.example",
    "https://workshop.example/path",
    "https://workshop.example/?token=x",
  ]) {
    assert.throws(() => parseCompanionPushArgs([...args, "--origin", origin]));
  }
  assert.throws(() => parseCompanionPushArgs([...args, "--token", "secret"]));
  assert.throws(() => parseCompanionPushArgs([...args, "--version", "new"]));
  assert.throws(() => parseCompanionPushArgs(args.slice(0, -1)));
  assert.throws(() => parseCompanionPushArgs([...args.slice(0, -1), "https://user:secret@example.org/file.js"]));
});

test("pushes through real local HTTP and verifies anonymous exact-version read", async () => {
  const requests = [];
  const record = {
    scriptId: "character-manager",
    version: "0.3.4",
    displayName: "角色管理库",
    downloadUrl: "https://example.org/v0.3.4.js",
    releaseId: "release-1",
    publishedAt: "2026-10-26T00:00:00.000Z",
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.writeHead(req.method === "PUT" ? 201 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(record));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const options = parseCompanionPushArgs([...args, "--origin", `http://127.0.0.1:${server.address().port}`]);
    assert.deepEqual(await pushCompanionVersion(options, "local-owner-session"), record);
    assert.deepEqual(
      requests.map(({ method, url, authorization }) => ({ method, url, authorization })),
      [
        {
          method: "PUT",
          url: "/api/v1/companion-scripts/character-manager/versions/0.3.4",
          authorization: "Bearer local-owner-session",
        },
        { method: "GET", url: "/api/v1/companion-scripts/character-manager/versions/0.3.4", authorization: undefined },
      ],
    );
    assert.deepEqual(JSON.parse(requests[0].body), options.input);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("does not disclose tokens or accept rejected or mismatching reads", async () => {
  const options = parseCompanionPushArgs(args);
  await assert.rejects(pushCompanionVersion(options, ""), /owner session token/);
  await assert.rejects(
    pushCompanionVersion(options, "secret", async () => new Response("private", { status: 403 })),
    /^Error: Companion push rejected \(HTTP 403\)$/,
  );
  await assert.rejects(
    pushCompanionVersion(options, "secret", async () => Response.json({ version: "wrong" })),
    /differs from published record/,
  );
});
