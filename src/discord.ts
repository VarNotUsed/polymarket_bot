import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  type MessageCreateOptions
} from "discord.js";
import { fmtMoney } from "./utils";

export type AlertPayload = {
  score: number;
  flags: string[];
  proxyWallet: string;
  walletAgeDays: number;
  notional24h: number;
  totalTrades: number;
  topMarketShare7d: number;
  uniqueEvents7d: number;
};

export function createDiscord(token: string, userId: string) {
  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
  });

  let readyResolve!: () => void;
  let readyReject!: (e: unknown) => void;
  const readyPromise = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  client.once(Events.ClientReady, () => {
    console.log(`Bot ready as ${client.user?.tag}`);
    readyResolve();
  });

  client.on("error", (e) => readyReject(e));

  client.login(token).catch((e) => readyReject(e));

  // ---- DM command handler: !alive / !ping ----
  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (msg.author.bot) return;
      if (!msg.channel.isDMBased()) return;

      // optional: nur ein bestimmter User darf Commands benutzen
      if (msg.author.id !== userId) return;

      const text = msg.content.trim();

      if (text === "!alive") {
        await msg.reply("alive ✅");
        return;
      }
    } catch (e) {
      console.error("discord message handler error:", e);
    }
  });

  async function sendDM(payload: string | MessageCreateOptions): Promise<void> {
    await readyPromise;
    const user = await client.users.fetch(userId);
    await user.send(payload);
  }

  async function sendAlertDM(a: AlertPayload): Promise<void> {
    const walletUrl = `https://polymarket.com/@${a.proxyWallet}?tab=positions&via=history`;

    const embed = new EmbedBuilder()
      .setTitle("🚨 ALERT")
      .setColor(0xed4245)
      .addFields(
        { name: "Score", value: String(a.score), inline: true },
        { name: "Flags", value: a.flags.join(", ") || "—", inline: true },
        { name: "Wallet", value: `[${a.proxyWallet}](${walletUrl})` },
        { name: "Wallet Age", value: `${a.walletAgeDays.toFixed(2)} days`, inline: true },
        { name: "Notional (24h)", value: `$${fmtMoney(a.notional24h)}`, inline: true },
        { name: "Total Trades", value: String(a.totalTrades), inline: true },
        { name: "Top Market Share (7d)", value: `${(a.topMarketShare7d * 100).toFixed(0)}%`, inline: true },
        { name: "Unique Events (7d)", value: String(a.uniqueEvents7d), inline: true }
      )
      .setTimestamp();

    await sendDM({ embeds: [embed] });
  }

  return { sendDM, sendAlertDM };
}
