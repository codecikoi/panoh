import { describe, expect, it } from "vitest";
import { signInitData, validateInitData } from "./initData.js";

describe("initData", () => {
  const token = "123456:ABC-DEF";
  const now = Math.floor(Date.now() / 1000);
  const fields = { auth_date: String(now), query_id: "AAH", user: JSON.stringify({ id: 42, first_name: "Zoir", language_code: "ru" }) };

  it("validates a correctly signed payload", () => {
    const signed = signInitData(fields, token);
    const result = validateInitData(signed, token);
    expect(result?.user.id).toBe(42);
    expect(result?.user.language_code).toBe("ru");
  });

  it("rejects tampering, wrong tokens and stale payloads", () => {
    const signed = signInitData(fields, token);
    expect(validateInitData(signed.replace("Zoir", "Mallory"), token)).toBeNull();
    expect(validateInitData(signed, "other:token")).toBeNull();
    const old = signInitData({ ...fields, auth_date: String(now - 100_000) }, token);
    expect(validateInitData(old, token)).toBeNull();
    expect(validateInitData("garbage", token)).toBeNull();
  });
});
