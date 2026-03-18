/**
 * Gateway channel plugins — direct platform API implementations.
 *
 * Each plugin wraps one messaging platform using its public REST API with
 * per-tenant config stored in PostgreSQL (not a local config file).
 * We use openclaw as a dependency for channel type IDs and config schemas;
 * delivery is implemented here via plain fetch against each platform's API.
 */
import type {
  ChannelPlugin,
  ApplyInput,
  ApplyResult,
  ProbeInput,
  ProbeResult,
  SendInput,
  SendResult,
  DestroyInput,
  NormalizeInput,
  NormalizeResult,
} from "./channel-plugin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "string" ? v : "";
}

function payloadText(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.text === "string") return p.text;
    if (typeof p.content === "string") return p.content;
    if (typeof p.body === "string") return p.body;
  }
  return JSON.stringify(payload ?? {});
}

// ---------------------------------------------------------------------------
// Telegram
// Config: { token: string }
// targetId: chat_id (number as string)
// ---------------------------------------------------------------------------

class TelegramPlugin implements ChannelPlugin {
  readonly type = "telegram";

  private base(token: string) {
    return `https://api.telegram.org/bot${token}`;
  }

  async apply(input: ApplyInput): Promise<ApplyResult> {
    const token = str(input.config, "token");
    if (!token) return { ok: false, error: "missing telegram token" };
    try {
      const res = await fetch(`${this.base(token)}/getMe`);
      const json = (await res.json()) as { ok: boolean; result?: { id: number; username?: string } };
      if (!json.ok) return { ok: false, error: "telegram getMe failed" };
      return { ok: true, state: { id: json.result?.id, username: json.result?.username } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const token = str(input.config, "token");
    if (!token) return { ok: false, error: "missing telegram token" };
    const start = Date.now();
    try {
      const res = await fetch(`${this.base(token)}/getMe`);
      const json = (await res.json()) as { ok: boolean; result?: unknown };
      return { ok: json.ok, elapsedMs: Date.now() - start, detail: json.result };
    } catch (err) {
      return { ok: false, elapsedMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(input: SendInput): Promise<SendResult> {
    const token = str(input.config, "token");
    if (!token) return { ok: false, error: "missing telegram token" };
    try {
      const res = await fetch(`${this.base(token)}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: input.targetId, text: payloadText(input.payload) }),
      });
      const json = (await res.json()) as { ok: boolean; result?: { message_id?: number }; description?: string };
      if (!json.ok) return { ok: false, error: json.description ?? "telegram sendMessage failed" };
      return { ok: true, deliveryId: String(json.result?.message_id ?? "") };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async destroy(_input: DestroyInput): Promise<void> {
    // no teardown needed
  }

  async normalizeInbound(input: NormalizeInput): Promise<NormalizeResult> {
    try {
      const p = input.payload as Record<string, unknown>;
      const msg = (p.message ?? p.edited_message ?? p.channel_post) as Record<string, unknown> | undefined;
      if (!msg) return { ok: false, error: "no message in payload" };
      const from = msg.from as Record<string, unknown> | undefined;
      const text = typeof msg.text === "string" ? msg.text : "";
      const senderId = String(from?.id ?? "");
      const firstName = typeof from?.first_name === "string" ? from.first_name : "";
      const lastName = typeof from?.last_name === "string" ? ` ${from.last_name}` : "";
      const senderName = `${firstName}${lastName}`.trim() || senderId;
      return { ok: true, text, senderId, senderName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// Slack
// Config: { botToken: string }
// targetId: channel ID (e.g. C0123456789)
// ---------------------------------------------------------------------------

class SlackPlugin implements ChannelPlugin {
  readonly type = "slack";

  async apply(input: ApplyInput): Promise<ApplyResult> {
    const token = str(input.config, "botToken");
    if (!token) return { ok: false, error: "missing slack botToken" };
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
      const json = (await res.json()) as { ok: boolean; user_id?: string; team?: string; error?: string };
      if (!json.ok) return { ok: false, error: json.error ?? "slack auth.test failed" };
      return { ok: true, state: { userId: json.user_id, team: json.team } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const token = str(input.config, "botToken");
    if (!token) return { ok: false, error: "missing slack botToken" };
    const start = Date.now();
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
      const json = (await res.json()) as { ok: boolean; user_id?: string; team?: string };
      return { ok: json.ok, elapsedMs: Date.now() - start, detail: { userId: json.user_id, team: json.team } };
    } catch (err) {
      return { ok: false, elapsedMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(input: SendInput): Promise<SendResult> {
    const token = str(input.config, "botToken");
    if (!token) return { ok: false, error: "missing slack botToken" };
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ channel: input.targetId, text: payloadText(input.payload) }),
      });
      const json = (await res.json()) as { ok: boolean; ts?: string; error?: string };
      if (!json.ok) return { ok: false, error: json.error ?? "slack postMessage failed" };
      return { ok: true, deliveryId: json.ts };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async destroy(_input: DestroyInput): Promise<void> {
    // no teardown needed
  }

  async normalizeInbound(input: NormalizeInput): Promise<NormalizeResult> {
    try {
      const p = input.payload as Record<string, unknown>;
      const event = p.event as Record<string, unknown> | undefined;
      const msg = event ?? p;
      const text = typeof msg.text === "string" ? msg.text : "";
      const senderId = typeof msg.user === "string" ? msg.user : "";
      return { ok: true, text, senderId, senderName: senderId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// Discord
// Config: { botToken: string }
// targetId: channel ID (snowflake)
// ---------------------------------------------------------------------------

class DiscordPlugin implements ChannelPlugin {
  readonly type = "discord";

  private readonly apiBase = "https://discord.com/api/v10";

  async apply(input: ApplyInput): Promise<ApplyResult> {
    const token = str(input.config, "botToken");
    if (!token) return { ok: false, error: "missing discord botToken" };
    try {
      const res = await fetch(`${this.apiBase}/users/@me`, {
        headers: { Authorization: `Bot ${token}` },
      });
      if (!res.ok) return { ok: false, error: `discord /users/@me returned ${res.status}` };
      const json = (await res.json()) as { id?: string; username?: string };
      return { ok: true, state: { id: json.id, username: json.username } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const token = str(input.config, "botToken");
    if (!token) return { ok: false, error: "missing discord botToken" };
    const start = Date.now();
    try {
      const res = await fetch(`${this.apiBase}/users/@me`, {
        headers: { Authorization: `Bot ${token}` },
      });
      const json = (await res.json()) as { id?: string; username?: string };
      return { ok: res.ok, elapsedMs: Date.now() - start, detail: json };
    } catch (err) {
      return { ok: false, elapsedMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(input: SendInput): Promise<SendResult> {
    const token = str(input.config, "botToken");
    if (!token) return { ok: false, error: "missing discord botToken" };
    try {
      const res = await fetch(`${this.apiBase}/channels/${input.targetId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ content: payloadText(input.payload) }),
      });
      const json = (await res.json()) as { id?: string; code?: number; message?: string };
      if (!res.ok) return { ok: false, error: json.message ?? `discord returned ${res.status}` };
      return { ok: true, deliveryId: json.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async destroy(_input: DestroyInput): Promise<void> {
    // no teardown needed
  }

  async normalizeInbound(input: NormalizeInput): Promise<NormalizeResult> {
    try {
      const p = input.payload as Record<string, unknown>;
      // Discord sends interaction payloads or message create events
      const text = typeof p.content === "string" ? p.content : "";
      const author = p.author as Record<string, unknown> | undefined;
      const senderId = typeof author?.id === "string" ? author.id : "";
      const senderName = typeof author?.username === "string" ? author.username : senderId;
      return { ok: true, text, senderId, senderName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// Google Chat
// Config: { webhookUrl: string }
// targetId: (unused for webhook-based delivery)
// ---------------------------------------------------------------------------

class GoogleChatPlugin implements ChannelPlugin {
  readonly type = "googlechat";

  async apply(input: ApplyInput): Promise<ApplyResult> {
    const url = str(input.config, "webhookUrl");
    if (!url) return { ok: false, error: "missing googlechat webhookUrl" };
    return { ok: true };
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const url = str(input.config, "webhookUrl");
    if (!url) return { ok: false, error: "missing googlechat webhookUrl" };
    // Can't probe a one-way webhook without sending
    return { ok: true, elapsedMs: 0, detail: { skipped: true } };
  }

  async send(input: SendInput): Promise<SendResult> {
    const url = str(input.config, "webhookUrl");
    if (!url) return { ok: false, error: "missing googlechat webhookUrl" };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: payloadText(input.payload) }),
      });
      if (!res.ok) return { ok: false, error: `googlechat webhook returned ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async destroy(_input: DestroyInput): Promise<void> {
    // no teardown needed
  }

  async normalizeInbound(input: NormalizeInput): Promise<NormalizeResult> {
    try {
      const p = input.payload as Record<string, unknown>;
      const msg = p.message as Record<string, unknown> | undefined;
      const text = typeof msg?.text === "string" ? msg.text : "";
      const sender = p.user as Record<string, unknown> | undefined;
      const senderId = typeof sender?.name === "string" ? sender.name : "";
      const senderName = typeof sender?.displayName === "string" ? sender.displayName : senderId;
      return { ok: true, text, senderId, senderName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// WhatsApp  (remote-capable via Baileys — runs in-process on the gateway)
//
// The gateway host maintains the WhatsApp Web socket (Baileys) and persists
// credentials on a persistent volume.  QR-code login is initiated via a
// dedicated gateway RPC method; the plugin manages the socket lifecycle.
//
// Config: { authDir: string, accountId?: string }
// targetId: WhatsApp JID  (e.g. "41796666864@s.whatsapp.net")
// ---------------------------------------------------------------------------

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { normalizeWhatsAppTarget } from "openclaw/plugin-sdk";

type WaEntry = {
  sock: WASocket;
  close: () => void;
};

/** Per-tenant WhatsApp socket state held in memory for the process lifetime. */
const waSockets = new Map<string, WaEntry>();

function waKey(tenantId: string, cfg: Record<string, unknown>): string {
  const accountId = typeof cfg.accountId === "string" ? cfg.accountId : "default";
  return `${tenantId}:${accountId}`;
}

/** Ensure a JID ends with @s.whatsapp.net if it's a plain phone number. */
function toJid(target: string): string {
  const normalized = normalizeWhatsAppTarget(target);
  if (normalized) return normalized;
  // Fallback: if target looks like a plain number, append the suffix
  if (/^\d+$/.test(target)) return `${target}@s.whatsapp.net`;
  return target;
}

class WhatsAppPlugin implements ChannelPlugin {
  readonly type = "whatsapp";

  async apply(input: ApplyInput): Promise<ApplyResult> {
    const authDir = str(input.config, "authDir");
    if (!authDir) {
      return { ok: false, error: "whatsapp: authDir must be set (persistent volume path for Baileys creds)" };
    }

    const key = waKey(input.tenantId, input.config);
    const existing = waSockets.get(key);
    if (existing) {
      return { ok: true, state: { active: true, reconnected: false } };
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const sock = makeWASocket({ auth: state, printQRInTerminal: false });

      sock.ev.on("creds.update", saveCreds);

      // Wrap in a promise that resolves once connected (or rejects on fatal close)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("whatsapp: connection timeout (30s)")), 30_000);

        sock.ev.on("connection.update", (update) => {
          if (update.connection === "open") {
            clearTimeout(timer);
            resolve();
          }
          if (update.connection === "close") {
            const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
            // If logged out, reject. Otherwise the reconnect loop handles it.
            if (statusCode === DisconnectReason.loggedOut) {
              clearTimeout(timer);
              waSockets.delete(key);
              reject(new Error("whatsapp: logged out — re-link via QR"));
            }
          }
        });
      });

      waSockets.set(key, {
        sock,
        close: () => { sock.end(undefined); waSockets.delete(key); },
      });

      return { ok: true, state: { active: true } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const key = waKey(input.tenantId, input.config);
    const start = Date.now();
    const entry = waSockets.get(key);
    if (!entry) {
      return { ok: false, elapsedMs: Date.now() - start, error: "no active whatsapp session — link via QR login first" };
    }
    return { ok: true, elapsedMs: Date.now() - start, detail: { source: "tenant-session" } };
  }

  async send(input: SendInput): Promise<SendResult> {
    const key = waKey(input.tenantId, input.config);
    const entry = waSockets.get(key);
    if (!entry) {
      return { ok: false, error: "no active whatsapp session — link via QR login first" };
    }

    const jid = toJid(input.targetId);
    try {
      const sent = await entry.sock.sendMessage(jid, { text: payloadText(input.payload) });
      return { ok: true, deliveryId: sent?.key?.id ?? undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async destroy(input: DestroyInput): Promise<void> {
    const key = waKey(input.tenantId, input.config);
    const entry = waSockets.get(key);
    if (entry) {
      entry.close();
    }
  }

  async normalizeInbound(input: NormalizeInput): Promise<NormalizeResult> {
    try {
      const p = input.payload as Record<string, unknown>;
      // OpenClaw WebInboundMessage shape
      const body = typeof p.body === "string" ? p.body : "";
      const senderJid = typeof p.senderJid === "string" ? p.senderJid : (typeof p.from === "string" ? p.from : "");
      const senderName = typeof p.senderName === "string" ? p.senderName
        : (typeof p.pushName === "string" ? p.pushName : senderJid);
      return { ok: true, text: body, senderId: senderJid, senderName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// IRC  (remote-capable — standard TCP/TLS connection from the gateway)
//
// Not yet implemented. IRC does not require a local daemon; the gateway can
// connect directly to IRC servers.  Placeholder until we wire up an IRC client.
//
// Config: { server: string, port?: number, nick: string, password?: string, tls?: boolean }
// targetId: channel name or nick (e.g. "#general")
// ---------------------------------------------------------------------------

class IrcPlugin implements ChannelPlugin {
  readonly type = "irc";

  async apply(_input: ApplyInput): Promise<ApplyResult> {
    return { ok: false, error: "irc: not yet implemented in the cloud gateway (no architectural blocker)" };
  }

  async probe(_input: ProbeInput): Promise<ProbeResult> {
    return { ok: false, error: "irc: not yet implemented in the cloud gateway" };
  }

  async send(_input: SendInput): Promise<SendResult> {
    return { ok: false, error: "irc: not yet implemented in the cloud gateway" };
  }

  async destroy(_input: DestroyInput): Promise<void> {}

  async normalizeInbound(_input: NormalizeInput): Promise<NormalizeResult> {
    return { ok: false, error: "irc: not yet implemented in the cloud gateway" };
  }
}

// ---------------------------------------------------------------------------
// Signal  (requires signal-cli sidecar — HTTP JSON-RPC + SSE)
//
// The gateway talks to signal-cli via its HTTP API.  signal-cli must run
// as a sidecar process (or a separate service) accessible at the configured
// httpUrl.  This is NOT a local-only limitation — signal-cli can run on
// any Linux host alongside the gateway.
//
// Config: { httpUrl: string, signalNumber: string }
// targetId: phone number (E.164)
// ---------------------------------------------------------------------------

class SignalPlugin implements ChannelPlugin {
  readonly type = "signal";

  async apply(input: ApplyInput): Promise<ApplyResult> {
    const httpUrl = str(input.config, "httpUrl");
    if (!httpUrl) return { ok: false, error: "signal: httpUrl required (signal-cli JSON-RPC endpoint)" };
    try {
      const res = await fetch(`${httpUrl.replace(/\/$/, "")}/v1/about`);
      if (!res.ok) return { ok: false, error: `signal-cli returned ${res.status}` };
      const json = (await res.json()) as Record<string, unknown>;
      return { ok: true, state: { version: json.version } };
    } catch (err) {
      return { ok: false, error: `signal-cli unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const httpUrl = str(input.config, "httpUrl");
    if (!httpUrl) return { ok: false, error: "signal: httpUrl required" };
    const start = Date.now();
    try {
      const res = await fetch(`${httpUrl.replace(/\/$/, "")}/v1/about`);
      return { ok: res.ok, elapsedMs: Date.now() - start };
    } catch (err) {
      return { ok: false, elapsedMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(input: SendInput): Promise<SendResult> {
    const httpUrl = str(input.config, "httpUrl");
    const signalNumber = str(input.config, "signalNumber");
    if (!httpUrl) return { ok: false, error: "signal: httpUrl required" };
    if (!signalNumber) return { ok: false, error: "signal: signalNumber required" };
    try {
      const res = await fetch(`${httpUrl.replace(/\/$/, "")}/v2/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: payloadText(input.payload),
          number: signalNumber,
          recipients: [input.targetId],
        }),
      });
      const json = (await res.json()) as { timestamp?: string };
      if (!res.ok) return { ok: false, error: `signal-cli send returned ${res.status}` };
      return { ok: true, deliveryId: json.timestamp };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async destroy(_input: DestroyInput): Promise<void> {}

  async normalizeInbound(input: NormalizeInput): Promise<NormalizeResult> {
    try {
      const p = input.payload as Record<string, unknown>;
      const envelope = (p.envelope ?? p) as Record<string, unknown>;
      const dataMsg = envelope.dataMessage as Record<string, unknown> | undefined;
      const text = typeof dataMsg?.message === "string" ? dataMsg.message : "";
      const senderId = typeof envelope.source === "string" ? envelope.source : "";
      const senderName = typeof envelope.sourceName === "string" ? envelope.sourceName : senderId;
      return { ok: true, text, senderId, senderName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// iMessage  (requires macOS runtime — either local or remote Mac via SSH)
//
// iMessage needs a Mac-side runtime (imsg CLI or BlueBubbles).  The gateway
// can talk to a remote Mac bridge, but the Mac must exist somewhere.
// Not a cloud-native channel — stub until Mac bridge integration is wired.
//
// Config: { cliPath?: string, remoteHost?: string, service?: "imessage" | "sms" }
// ---------------------------------------------------------------------------

class IMessagePlugin implements ChannelPlugin {
  readonly type = "imessage";

  async apply(_input: ApplyInput): Promise<ApplyResult> {
    return { ok: false, error: "imessage: requires macOS runtime (imsg CLI or BlueBubbles). Remote Mac bridge is supported but not yet configured." };
  }

  async probe(_input: ProbeInput): Promise<ProbeResult> {
    return { ok: false, error: "imessage: macOS runtime not configured" };
  }

  async send(_input: SendInput): Promise<SendResult> {
    return { ok: false, error: "imessage: macOS runtime not configured" };
  }

  async destroy(_input: DestroyInput): Promise<void> {}

  async normalizeInbound(_input: NormalizeInput): Promise<NormalizeResult> {
    return { ok: false, error: "imessage: macOS runtime not configured" };
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function createGatewayChannelPlugins(): Map<string, ChannelPlugin> {
  const plugins = new Map<string, ChannelPlugin>();

  const all: ChannelPlugin[] = [
    new TelegramPlugin(),
    new SlackPlugin(),
    new DiscordPlugin(),
    new GoogleChatPlugin(),
    new WhatsAppPlugin(),
    new SignalPlugin(),
    new IrcPlugin(),
    new IMessagePlugin(),
  ];

  for (const plugin of all) {
    plugins.set(plugin.type, plugin);
  }

  return plugins;
}
