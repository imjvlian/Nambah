#!/usr/bin/env node
// Daftar webhook Telegram ke bot.
//
// Dijalankan ulang setiap kali domain berubah atau secret dirotasi:
//   node scripts/telegram-set-webhook.mjs
//   node scripts/telegram-set-webhook.mjs --url https://nambah.example --secret <rahasia>
//
// Tanpa --url, PUBLIC_BASE_URL dari .env.local dipakai.
//
// Perintah lain:
//   node scripts/telegram-set-webhook.mjs --info      tampilkan webhook sekarang
//   node scripts/telegram-set-webhook.mjs --delete   lepaskan webhook

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function readEnvFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    env[line.slice(0, index).trim()] = line
      .slice(index + 1)
      .trim()
      .replace(/^"|"$/g, "");
  }
  return env;
}

const fileEnv = parseEnv(readEnvFile(join(root, ".env.local")));
const env = { ...fileEnv, ...process.env };

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const flagValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const token = env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN belum ada di .env.local atau environment.");
  process.exit(1);
}

const api = `https://api.telegram.org/bot${token}`;

async function call(method, body) {
  const response = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok && payload?.ok === true, payload };
}

async function showInfo() {
  const { ok, payload } = await call("getWebhookInfo", {});
  if (!ok) {
    console.error("Gagal membaca getWebhookInfo:", JSON.stringify(payload));
    process.exit(1);
  }

  const info = payload.result;
  console.log("url                    :", info.url || "(belum di-set)");
  console.log("pending_update_count   :", info.pending_update_count);
  console.log("last_error_message     :", info.last_error_message || "-");
  if (info.last_error_date) {
    console.log("last_error_date        :", new Date(info.last_error_date * 1000).toISOString());
  }
  if (Array.isArray(info.allowed_updates) && info.allowed_updates.length > 0) {
    console.log("allowed_updates        :", info.allowed_updates.join(", "));
  }
}

async function removeWebhook() {
  const { ok, payload } = await call("deleteWebhook", { drop_pending_updates: true });
  if (!ok) {
    console.error("Gagal melepas webhook:", JSON.stringify(payload));
    process.exit(1);
  }
  console.log("Webhook dilepas.");
}

async function setWebhook() {
  const secret = flagValue("--secret") ?? env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error(
      "Secret webhook wajib. Isi TELEGRAM_WEBHOOK_SECRET di .env.local atau pakai --secret.",
    );
    process.exit(1);
  }

  const baseUrl = (
    flagValue("--url") ??
    env.PUBLIC_BASE_URL ??
    env.NEXT_PUBLIC_SITE_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  if (!baseUrl) {
    console.error(
      "URL webhook belum ada. Isi PUBLIC_BASE_URL di .env.local atau pakai --url https://domain-anda.",
    );
    process.exit(1);
  }

  const url = `${baseUrl}/api/telegram/webhook`;
  const { ok, payload } = await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });

  if (!ok) {
    console.error("Gagal memasang webhook:", JSON.stringify(payload));
    process.exit(1);
  }

  console.log("Webhook terpasang di:");
  console.log(`  ${url}`);
  console.log("");
  console.log("Verifikasi:");
  console.log("  node scripts/telegram-set-webhook.mjs --info");
  console.log("");
  console.log("Uji dari chat admin bot:");
  console.log("  /status");
  console.log("  /saldo");
}

if (hasFlag("--delete")) {
  await removeWebhook();
} else if (hasFlag("--info")) {
  await showInfo();
} else {
  await setWebhook();
}