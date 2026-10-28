import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { test } from "node:test";
import { ensureR2Object, r2ImportCredentials } from "./import-r2.mjs";

const credentials = { accessKeyId: "testaccesskey", secretAccessKey: "test-secret-never-log" };
const content = Buffer.from("immutable import payload");
const accountId = "0123456789abcdef0123456789abcdef";

async function store(t, { initial, raceReads = 0, errorStatus, redirect } = {}) {
  const state = { body: initial, writes: 0, rejectedWrites: 0, requests: [], missingReads: 0 };
  const waiting = [];
  const server = http.createServer(async (req, res) => {
    state.requests.push({ method: req.method, path: req.url, headers: req.headers });
    if (redirect) {
      res.writeHead(307, { location: redirect });
      res.end();
      return;
    }
    if (errorStatus) {
      res.writeHead(errorStatus);
      res.end(`${req.headers.authorization} ${credentials.secretAccessKey}`);
      return;
    }
    if (req.method === "GET") {
      if (raceReads && state.missingReads < raceReads) {
        state.missingReads += 1;
        waiting.push(res);
        if (waiting.length === raceReads) {
          for (const response of waiting) {
            response.writeHead(404);
            response.end();
          }
        }
        return;
      }
      res.writeHead(state.body === undefined ? 404 : 200);
      res.end(state.body);
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.headers["if-none-match"] !== "*") {
      res.writeHead(400);
      res.end("Conditional write required");
      return;
    }
    if (state.body !== undefined) {
      state.rejectedWrites += 1;
      res.writeHead(412);
    } else {
      state.body = Buffer.concat(chunks);
      state.writes += 1;
      res.writeHead(200);
    }
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const upload = (body = content) =>
    ensureR2Object({
      accountId,
      bucket: "workshop-client-staging",
      key: "assets/space unicode-诗.json",
      body,
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: body.length,
      credentials,
      endpoint,
    });
  return { state, upload, endpoint };
}

test("identical existing bytes are reused without PUT", async (t) => {
  const { state, upload } = await store(t, { initial: content });
  assert.equal((await upload()).disposition, "reused");
  assert.deepEqual(state.body, content);
  assert.deepEqual(
    state.requests.map((request) => request.method),
    ["GET"],
  );
});

test("different existing bytes are never overwritten, even at equal length", async (t) => {
  const original = Buffer.alloc(content.length, 120);
  const { state, upload } = await store(t, { initial: original });
  await assert.rejects(upload(), /existing object mismatch/);
  assert.deepEqual(state.body, original);
  assert.equal(state.writes, 0);
  assert.deepEqual(
    state.requests.map((request) => request.method),
    ["GET"],
  );
});

test("absent objects use a signed conditional PUT and verify actual bytes", async (t) => {
  const { state, upload } = await store(t);
  assert.equal((await upload()).disposition, "created");
  assert.deepEqual(state.body, content);
  assert.equal(state.writes, 1);
  assert.deepEqual(
    state.requests.map((request) => request.method),
    ["GET", "PUT", "GET"],
  );
  const put = state.requests[1];
  assert.equal(put.path, "/workshop-client-staging/assets/space%20unicode-%E8%AF%97.json");
  assert.equal(put.headers["if-none-match"], "*");
  assert.equal(put.headers["x-amz-content-sha256"], createHash("sha256").update(content).digest("hex"));
  assert.match(put.headers.authorization, /SignedHeaders=host;if-none-match;x-amz-content-sha256;x-amz-date/);
  assert.match(put.headers.authorization, /\/auto\/s3\/aws4_request/);
  assert.ok(!JSON.stringify(state.requests).includes(credentials.secretAccessKey));
});

test("concurrent identical imports converge after 412 without overwriting", async (t) => {
  const { state, upload } = await store(t, { raceReads: 2 });
  const results = await Promise.all([upload(), upload()]);
  assert.deepEqual(results.map((result) => result.disposition).sort(), ["created", "reused"]);
  assert.equal(state.writes, 1);
  assert.equal(state.rejectedWrites, 1);
  assert.deepEqual(state.body, content);
});

test("a competing different writer wins once; loser fails closed after 412", async (t) => {
  const { state, upload } = await store(t, { raceReads: 2 });
  const other = Buffer.from("different import payload");
  const results = await Promise.allSettled([upload(), upload(other)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.match(rejected.reason.message, /existing object mismatch/);
  const winner = results[0].status === "fulfilled" ? content : other;
  assert.deepEqual(state.body, winner);
  assert.equal(state.writes, 1);
  assert.equal(state.rejectedWrites, 1);
});

test("server errors cannot leak reflected credentials or trigger a write", async (t) => {
  const { state, upload } = await store(t, { errorStatus: 403 });
  await assert.rejects(upload(), (error) => {
    assert.equal(error.message, "R2 GET failed (HTTP 403)");
    assert.ok(!error.stack.includes(credentials.accessKeyId));
    assert.ok(!error.stack.includes(credentials.secretAccessKey));
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(state.writes, 0);
});

test("redirects never forward signed credentials to another origin", async (t) => {
  const destination = await store(t);
  const source = await store(t, { redirect: destination.endpoint });
  await assert.rejects(source.upload(), /R2 GET failed \(HTTP 307\)/);
  assert.equal(destination.state.requests.length, 0);
});

test("API tokens and generic AWS variables cannot substitute for dedicated S3 credentials", () => {
  assert.throws(
    () =>
      r2ImportCredentials({
        STAGING_IMPORT_TOKEN: "not-an-s3-credential",
        AWS_ACCESS_KEY_ID: credentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      }),
    /requires dedicated/,
  );
  assert.deepEqual(
    r2ImportCredentials({
      STAGING_IMPORT_R2_ACCESS_KEY_ID: credentials.accessKeyId,
      STAGING_IMPORT_R2_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    }),
    credentials,
  );
});
