import type { MiddlewareHandler } from "hono";
import { env, validateInitData, type InitDataUser } from "@budgie/core";

export type AuthVariables = { tgUser: InitDataUser };

/**
 * Authenticates Telegram Mini App requests: `Authorization: tma <initData>`.
 * Outside production, `X-Debug-User: <telegram user id>` is accepted for local dashboard development.
 */
export function initDataAuth(botToken: string): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const [scheme, ...rest] = header.split(" ");
    if (scheme?.toLowerCase() === "tma" && rest.length) {
      const validated = validateInitData(rest.join(" "), botToken);
      if (!validated) return c.json({ error: "invalid init data" }, 401);
      c.set("tgUser", validated.user);
      return next();
    }
    const debug = c.req.header("x-debug-user");
    if (debug && env().NODE_ENV !== "production") {
      c.set("tgUser", { id: Number(debug), first_name: "Debug" });
      return next();
    }
    return c.json({ error: "unauthorized" }, 401);
  };
}
