import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";

const bindings = env as unknown as Env;

describe("local Cloudflare bindings", () => {
  it("round-trips a row through D1", async () => {
    await bindings.DB.exec("CREATE TABLE IF NOT EXISTS smoke (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await bindings.DB.prepare("INSERT INTO smoke (id, value) VALUES (?, ?)").bind("one", "hello").run();
    const row = await bindings.DB.prepare("SELECT value FROM smoke WHERE id = ?")
      .bind("one")
      .first<{ value: string }>();
    expect(row?.value).toBe("hello");
  });

  it("round-trips an object through R2", async () => {
    await bindings.R2.put("smoke/hello.txt", "hello");
    const object = await bindings.R2.get("smoke/hello.txt");
    expect(await object?.text()).toBe("hello");
    await bindings.R2.delete("smoke/hello.txt");
  });
});
