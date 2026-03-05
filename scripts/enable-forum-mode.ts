/**
 * One-shot script to enable forum/topics mode on a Telegram supergroup.
 *
 * Requires MTProto personal API credentials (not bot API):
 *   TELEGRAM_PERSONAL_API_ID, TELEGRAM_PERSONAL_API_HASH
 *
 * Also needs TELEGRAM_CHAT_ID from .env.
 *
 * Usage:
 *   npx tsx scripts/enable-forum-mode.ts
 */

import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import readline from "node:readline/promises";

const apiId = Number(process.env.TELEGRAM_PERSONAL_API_ID);
const apiHash = process.env.TELEGRAM_PERSONAL_API_HASH;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!apiId || !apiHash || !chatId) {
  console.error("Missing TELEGRAM_PERSONAL_API_ID, TELEGRAM_PERSONAL_API_HASH, or TELEGRAM_CHAT_ID");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const session = new StringSession(process.env.TELEGRAM_SESSION ?? "");
const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 3,
});

await client.start({
  phoneNumber: async () => await rl.question("Phone number: "),
  password: async () => await rl.question("2FA password: "),
  phoneCode: async () => await rl.question("Code: "),
  onError: (err) => console.error(err),
});

console.log("Session string (save to TELEGRAM_SESSION env var):");
console.log(client.session.save());

// Resolve the chat entity
const entity = await client.getEntity(chatId);

if (!(entity instanceof Api.Channel)) {
  console.error("Chat is not a supergroup/channel. Cannot enable forum mode.");
  await client.disconnect();
  process.exit(1);
}

// Enable forum mode
try {
  await client.invoke(
    new Api.channels.ToggleForum({
      channel: entity,
      enabled: true,
    }),
  );
  console.log(`Forum mode enabled on chat ${chatId}`);
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("FORUM_ALREADY_ENABLED") || msg.includes("already")) {
    console.log("Forum mode already enabled.");
  } else {
    throw error;
  }
}

await client.disconnect();
rl.close();
