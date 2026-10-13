import dns from "node:dns";
import https from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { HttpsProxyAgent } from "https-proxy-agent";
import { log } from "@madat/core";

/**
 * Networking for the Telegram client (grammY uses node-fetch with an https.Agent).
 *
 * Some networks (ISP filters, corporate or VPN resolvers) answer `api.telegram.org` with a bogus
 * private IP while the real servers stay reachable. The custom lookup below detects that and
 * resolves through DNS-over-HTTPS instead. `TELEGRAM_PROXY=http://user:pass@host:port` routes
 * everything through an HTTP(S) proxy instead.
 */

const DOH_PROVIDERS = [
  "https://cloudflare-dns.com/dns-query?type=A&name=",
  "https://dns.google/resolve?type=A&name=",
];
const STATIC_FALLBACK: Record<string, string[]> = {
  "api.telegram.org": ["149.154.166.110", "149.154.167.220"],
};
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { addresses: string[]; expires: number }>();

export function isBogusAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

async function resolveViaDoh(hostname: string): Promise<string[]> {
  for (const provider of DOH_PROVIDERS) {
    try {
      const res = await fetch(provider + encodeURIComponent(hostname), {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { Answer?: { type: number; data: string }[] };
      const addresses = (data.Answer ?? [])
        .filter((a) => a.type === 1 && isIP(a.data) === 4 && !isBogusAddress(a.data))
        .map((a) => a.data);
      if (addresses.length) return addresses;
    } catch (err) {
      log.debug("doh: provider failed", { provider, err });
    }
  }
  return STATIC_FALLBACK[hostname] ?? [];
}

function systemLookup(hostname: string): Promise<string[]> {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true, family: 4 }, (err, addresses) => {
      if (err || !addresses?.length) return resolve([]);
      resolve(addresses.map((a) => a.address));
    });
  });
}

export async function resolveHost(hostname: string): Promise<string[]> {
  const cached = cache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.addresses;
  let addresses = await systemLookup(hostname);
  if (!addresses.length || addresses.some(isBogusAddress)) {
    const doh = await resolveViaDoh(hostname);
    if (doh.length) {
      log.warn("dns: system resolver gave no usable address, using DNS-over-HTTPS", { hostname, system: addresses, doh });
      addresses = doh;
    }
  }
  if (addresses.length) cache.set(hostname, { addresses, expires: Date.now() + CACHE_TTL_MS });
  return addresses;
}

/** dns.lookup-compatible resolver for Node's http(s) agents. */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  const all = typeof options === "object" && options !== null && options.all === true;
  resolveHost(hostname)
    .then((addresses) => {
      if (!addresses.length) {
        const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
        return callback(err, all ? [] : "", 4);
      }
      if (all) return callback(null, addresses.map((address) => ({ address, family: 4 })));
      callback(null, addresses[0]!, 4);
    })
    .catch((err: NodeJS.ErrnoException) => callback(err, all ? [] : "", 4));
};

export function createTelegramAgent(proxyUrl?: string): https.Agent {
  if (proxyUrl) {
    log.info("telegram: using proxy", { proxy: proxyUrl.replace(/\/\/.*@/, "//***@") });
    return new HttpsProxyAgent(proxyUrl, { keepAlive: true });
  }
  return new https.Agent({ keepAlive: true, lookup: safeLookup, timeout: 20_000 });
}
