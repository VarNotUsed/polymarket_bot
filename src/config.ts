export type Config = {
  dbPath: string;
  pollIntervalMs: number;
  pageSize: number;
  maxPagesPerPoll: number;
  overlapSeconds: number;
  cashThreshold: number; // USD-ish (CASH filter)
  minOpenMinutes: number;

  backfillDays: number;

  discordToken: string;
  discordAlertUserId: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${v}`);
  return n;
}

export function loadConfig(): Config {
  const dbPath = arg("db") ?? process.env.DB_PATH ?? "./scanner.sqlite";
  const pollIntervalMs = num(arg("pollMs") ?? process.env.POLL_MS, 30_000);

  const pageSize = Math.min(
    Math.max(num(arg("pageSize") ?? process.env.PAGE_SIZE, 500), 50),
    2_000
  );

  const maxPagesPerPoll = Math.min(
    Math.max(num(arg("maxPages") ?? process.env.MAX_PAGES, 200), 10),
    1_000
  );

  const overlapSeconds = Math.min(
    Math.max(num(arg("overlapSec") ?? process.env.OVERLAP_SEC, 6 * 3600), 300),
    7 * 86400
  );

  const cashThreshold = num(
    arg("cashThreshold") ?? process.env.CASH_THRESHOLD,
    10_000
  );

  const minOpenMinutes = num(
    arg("minOpenMinutes") ?? process.env.MIN_OPEN_MINUTES,
    10
  );

  const backfillDays = num(arg("backfillDays") ?? process.env.BACKFILL_DAYS, 7);

  const discordToken = arg("discordToken") ?? process.env.DISCORD_TOKEN!;
  const discordAlertUserId = arg("discordUserId") ?? process.env.DISCORD_ALERT_USER_ID!;

  if (!discordToken) throw new Error("DISCORD_TOKEN fehlt");
  if (!discordAlertUserId) throw new Error("DISCORD_ALERT_USER_ID fehlt");

  return {
    dbPath,
    pollIntervalMs,
    pageSize,
    maxPagesPerPoll,
    overlapSeconds,
    cashThreshold,
    minOpenMinutes,
    backfillDays,
    discordToken,
    discordAlertUserId
  };
}
