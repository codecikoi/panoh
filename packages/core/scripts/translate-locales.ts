/**
 * Generates machine translations of the English locale for every supported language that has no file yet.
 *   pnpm locales:translate                          # only missing locales
 *   pnpm locales:translate --force                  # regenerate every machine-translated locale (hand-written ones are kept)
 *   pnpm locales:translate ru de                    # only the listed locales
 *   pnpm locales:translate --missing                # add keys that existing machine-translated locales lack
 *   pnpm locales:translate --keys=bot.name,help     # re-translate these keys in existing machine-translated locales
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { en } from "../src/i18n/locales/en.js";
import { SUPPORTED_LOCALES, languageName } from "../src/i18n/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(here, "../src/i18n/locales");
const HAND_WRITTEN = new Set(["en", "ru", "uz"]);

const args = process.argv.slice(2);
const force = args.includes("--force");
const missing = args.includes("--missing");
const forcedKeys = (args.find((a) => a.startsWith("--keys="))?.slice("--keys=".length).split(",") ?? []).filter(Boolean);
const only = args.filter((a) => !a.startsWith("--"));

const client = new Anthropic();
const keys = Object.keys(en) as (keyof typeof en)[];
/** Telegram limits for the bot profile (characters); translations get a little headroom. */
const LIMITS: Partial<Record<keyof typeof en, number>> = { "bot.name": 64, "bot.short_description": 120, "bot.description": 512 };
const Schema = z.object({ translations: z.array(z.object({ key: z.string(), value: z.string() })) });

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

async function translate(locale: string, subset: (keyof typeof en)[] = keys): Promise<Record<string, string>> {
  const name = languageName(locale, "en");
  const source = subset.map((k) => ({ key: k, value: en[k] }));
  // Streamed: a whole locale needs a large max_tokens, which the SDK refuses to send without streaming.
  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `You translate UI strings of a friendly Telegram bot for family budgeting from English into ${name} (${locale}).
Rules: keep every {placeholder} exactly as is; keep emoji, HTML tags (<b>, <i>, <code>, <s>) and newlines; keep bot commands like /summary untouched;
keep "Madat" as the product name; use natural, warm, concise wording a native speaker would use in a chat app; keep "HTML entities" unchanged.
Hard length limits (characters, Telegram rejects longer): bot.name ≤ 60, bot.short_description ≤ 110, bot.description ≤ 490. Shorten the wording rather than exceed them.
Return every key exactly once.`,
    messages: [{ role: "user", content: JSON.stringify(source) }],
    output_config: { effort: "medium", format: betaZodOutputFormat(Schema) },
  });
  const response = await stream.finalMessage();
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = response.stop_reason === "end_turn" ? Schema.safeParse(JSON.parse(text)) : undefined;
  if (!parsed?.success) throw new Error(`translation failed for ${locale}: ${response.stop_reason}`);
  const result: Record<string, string> = {};
  for (const { key, value } of parsed.data.translations) result[key] = value;
  for (const k of subset) {
    const limit = LIMITS[k];
    if (result[k] && limit && [...result[k]!].length > limit) {
      console.warn(`  ${locale}: "${k}" is ${[...result[k]!].length} characters (limit ${limit}), falling back to English`);
      result[k] = en[k];
    }
    if (!result[k] || placeholders(result[k]!).join() !== placeholders(en[k]).join()) {
      console.warn(`  ${locale}: falling back to English for "${k}"`);
      result[k] = en[k];
    }
  }
  return result;
}

function render(locale: string, table: Record<string, string>): string {
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])},`).join("\n");
  return `// Machine-translated from en.ts by scripts/translate-locales.ts. Review before relying on it.\nimport type { LocaleStrings } from "./en.js";\n\nexport const ${locale}: LocaleStrings = {\n${body}\n};\n`;
}

async function writeRegistry(): Promise<void> {
  const files = (await readdir(localesDir)).filter((f) => /^[a-z]{2}\.ts$/.test(f)).map((f) => f.replace(".ts", "")).sort();
  const imports = files.map((code) => (code === "en" ? `import { en, type LocaleStrings } from "./en.js";` : `import { ${code} } from "./${code}.js";`));
  const content = `${imports.join("\n")}\n\n// Hand-written: en, ru, uz. Others are generated by \`pnpm locales:translate\`.\nexport const LOCALES: Record<string, LocaleStrings> = {\n${files.map((c) => `  ${c},`).join("\n")}\n};\n`;
  await writeFile(path.join(localesDir, "index.ts"), content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces the listed entries in a locale file in place and appends the ones it does not have yet. */
async function patchLocale(locale: string, table: Record<string, string>): Promise<void> {
  const file = path.join(localesDir, `${locale}.ts`);
  let source = await readFile(file, "utf8");
  const appended: string[] = [];
  for (const [key, value] of Object.entries(table)) {
    const entry = new RegExp(`(\\n\\s*${escapeRegExp(JSON.stringify(key))}:)\\s*"(?:[^"\\\\]|\\\\.)*",`);
    if (entry.test(source)) source = source.replace(entry, (_m, head: string) => `${head} ${JSON.stringify(value)},`);
    else appended.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  }
  if (appended.length) {
    const end = source.lastIndexOf("};");
    source = `${source.slice(0, end)}${appended.join("\n")}\n${source.slice(end)}`;
  }
  await writeFile(file, source);
}

if (missing || forcedKeys.length) {
  for (const k of forcedKeys) if (!(k in en)) throw new Error(`unknown key: ${k}`);
  const files = (await readdir(localesDir)).filter((f) => /^[a-z]{2}\.ts$/.test(f)).map((f) => f.replace(".ts", ""));
  const targets = files.filter((l) => !HAND_WRITTEN.has(l) && (!only.length || only.includes(l))).sort();
  for (const locale of targets) {
    const mod = (await import(path.join(localesDir, `${locale}.ts`))) as Record<string, Record<string, string>>;
    const table = mod[locale] ?? {};
    const subset = keys.filter((k) => forcedKeys.includes(k) || (missing && !(k in table)));
    if (!subset.length) continue;
    process.stdout.write(`- ${locale}: ${subset.length} key(s)... `);
    await patchLocale(locale, await translate(locale, subset));
    console.log("ok");
  }
  process.exit(0);
}

const existing = new Set((await readdir(localesDir)).filter((f) => /^[a-z]{2}\.ts$/.test(f)).map((f) => f.replace(".ts", "")));
const targets = (only.length ? only : [...SUPPORTED_LOCALES]).filter((l) => !HAND_WRITTEN.has(l) && (force || !existing.has(l)));
console.log(`Translating ${targets.length} locale(s): ${targets.join(", ") || "none"}`);
for (const locale of targets) {
  process.stdout.write(`- ${locale} (${languageName(locale, "en")})... `);
  const table = await translate(locale);
  await writeFile(path.join(localesDir, `${locale}.ts`), render(locale, table));
  console.log("ok");
}
await writeRegistry();
console.log("Registry updated:", (await readFile(path.join(localesDir, "index.ts"), "utf8")).split("\n").filter((l) => l.startsWith("  ")).length, "locales");
