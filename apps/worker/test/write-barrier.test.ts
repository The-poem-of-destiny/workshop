import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { barrierControl, withWriteBarrier } from "../src/write-barrier";

function isolatedEnv(): Env {
  const bindings = env as unknown as Env;
  const namespace = bindings.WRITE_BARRIER;
  const id = namespace.idFromName(crypto.randomUUID());
  return {
    ...bindings,
    MAINTENANCE_TOKEN: "test-operator-secret",
    WRITE_BARRIER: { idFromName: () => id, get: () => namespace.get(id) } as unknown as Env["WRITE_BARRIER"],
  };
}

function control(bindings: Env, action?: "close" | "open", token = "test-operator-secret") {
  return barrierControl(
    new Request("https://example.test/api/v1/maintenance", {
      method: action ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}` },
      ...(action ? { body: JSON.stringify({ action }) } : {}),
    }),
    bindings,
  );
}

describe("maintenance barrier", () => {
  it("requires operator authentication and blocks admission until reopened", async () => {
    const bindings = isolatedEnv();
    expect((await control(bindings, "close", "incorrect")).status).toBe(401);
    expect(await (await control(bindings, "close")).json()).toMatchObject({ closed: true, drained: true });
    let executed = false;
    expect(
      await withWriteBarrier(bindings, "request", async () => {
        executed = true;
      }),
    ).toEqual({ admitted: false });
    expect(executed).toBe(false);
    expect((await control(bindings, "open")).status).toBe(200);
    expect(await withWriteBarrier(bindings, "request", async () => 42)).toEqual({ admitted: true, value: 42 });
  });

  it("rejects a null action body without changing barrier state", async () => {
    const bindings = isolatedEnv();
    await control(bindings, "close");
    const response = await barrierControl(
      new Request("https://example.test/api/v1/maintenance", {
        method: "POST",
        headers: { authorization: "Bearer test-operator-secret", "content-type": "application/json" },
        body: "null",
      }),
      bindings,
    );
    expect(response.status).toBe(400);
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
  });

  it("does not report drained while admitted work is running", async () => {
    const bindings = isolatedEnv();
    let started!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operation = withWriteBarrier(bindings, "test", async () => {
      started();
      await hold;
    });
    await entered;
    expect(await (await control(bindings, "close")).json()).toMatchObject({ closed: true, drained: false });
    expect((await control(bindings, "open")).status).toBe(409);
    finish();
    await operation;
    expect(await (await control(bindings)).json()).toMatchObject({ closed: true, drained: true });
  });

  it("keeps uncertain operations outstanding even when their caller handles the failure", async () => {
    const bindings = isolatedEnv();
    await expect(
      withWriteBarrier(bindings, "storage", async () => {
        throw new Error("unknown outcome");
      }),
    ).rejects.toThrow("unknown outcome");
    expect(await (await control(bindings, "close")).json()).toMatchObject({ closed: true, drained: false });
    expect((await control(bindings, "open")).status).toBe(409);
  });
});
