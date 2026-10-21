import { describe, expect, it } from "vitest";
import { shouldSampleRequest } from "../src/http/observability";

describe("request log sampling", () => {
  it("always samples server errors and respects the rate for other responses", () => {
    expect(shouldSampleRequest(500, 0, 0.99)).toBe(true);
    expect(shouldSampleRequest(200, 0.1, 0.05)).toBe(true);
    expect(shouldSampleRequest(200, 0.1, 0.5)).toBe(false);
    expect(shouldSampleRequest(404, 0, 0)).toBe(false);
  });
});
