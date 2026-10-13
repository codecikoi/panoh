import { createHmac, timingSafeEqual } from "node:crypto";

export interface InitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface ValidatedInitData {
  user: InitDataUser;
  authDate: number;
  queryId?: string;
  startParam?: string;
}

/**
 * Validates Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Returns null when the signature is invalid or the data is older than maxAgeSec.
 */
export function validateInitData(initData: string, botToken: string, maxAgeSec = 60 * 60 * 24): ValidatedInitData | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const dataCheckString = pairs.join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return null;
  if (Date.now() / 1000 - authDate > maxAgeSec) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;
  let user: InitDataUser;
  try {
    user = JSON.parse(rawUser) as InitDataUser;
  } catch {
    return null;
  }
  if (typeof user.id !== "number") return null;

  return {
    user,
    authDate,
    queryId: params.get("query_id") ?? undefined,
    startParam: params.get("start_param") ?? undefined,
  };
}

/** Builds a signed initData string. Useful for tests and local dashboard development. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  params.set("hash", hash);
  return params.toString();
}
