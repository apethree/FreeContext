export type ChannelConnectMode = "native" | "relay" | "plugin";

export type ChannelConfigField = {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "url";
  required: boolean;
  helpText?: string;
};

export type ChannelDefinition = {
  id: string;
  label: string;
  docsUrl: string;
  icon: string;
  connectMode: ChannelConnectMode;
  backendType: string;
  configFields: ChannelConfigField[];
};

const DOCS_BASE = "https://docs.openclaw.ai/channels";

const GENERIC_PLUGIN_FIELDS: ChannelConfigField[] = [
  {
    key: "providerUrl",
    label: "Provider URL (optional)",
    placeholder: "https://provider.example.com",
    type: "url",
    required: false,
  },
  {
    key: "accountId",
    label: "Account ID (optional)",
    placeholder: "workspace/account/phone id",
    type: "text",
    required: false,
  },
  {
    key: "accessToken",
    label: "Access Token (optional)",
    placeholder: "token / api key",
    type: "password",
    required: false,
  },
  {
    key: "targetId",
    label: "Default Target (optional)",
    placeholder: "channel/user/group/thread target",
    type: "text",
    required: false,
  },
  {
    key: "headers",
    label: "Custom Headers",
    placeholder: '{"X-Custom": "value"}',
    type: "text",
    required: false,
    helpText: "Optional JSON object of extra HTTP headers.",
  },
];

export const CHANNEL_CATALOG: ChannelDefinition[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    docsUrl: `${DOCS_BASE}/whatsapp`,
    icon: "whatsapp",
    connectMode: "plugin",
    backendType: "whatsapp",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "telegram",
    label: "Telegram",
    docsUrl: `${DOCS_BASE}/telegram`,
    icon: "telegram",
    connectMode: "native",
    backendType: "telegram",
    configFields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "123456:AA...",
        type: "password",
        required: true,
      },
      {
        key: "chatId",
        label: "Chat ID",
        placeholder: "@channel or numeric id",
        type: "text",
        required: true,
      },
    ],
  },
  {
    id: "discord",
    label: "Discord",
    docsUrl: `${DOCS_BASE}/discord`,
    icon: "discord",
    connectMode: "native",
    backendType: "discord",
    configFields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "MTIz...",
        type: "password",
        required: true,
        helpText: "Bot → Reset Token in Discord Developer Portal",
      },
      {
        key: "channelId",
        label: "Default Channel ID",
        placeholder: "e.g. 123456789012345678",
        type: "text",
        required: false,
        helpText: "Optional. Used when no target is specified in the message.",
      },
    ],
  },
  {
    id: "irc",
    label: "IRC",
    docsUrl: `${DOCS_BASE}/irc`,
    icon: "irc",
    connectMode: "plugin",
    backendType: "irc",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "slack",
    label: "Slack",
    docsUrl: `${DOCS_BASE}/slack`,
    icon: "slack",
    connectMode: "native",
    backendType: "slack",
    configFields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "xoxb-...",
        type: "password",
        required: true,
        helpText: "OAuth & Permissions → Bot User OAuth Token",
      },
      {
        key: "appToken",
        label: "App Token",
        placeholder: "xapp-...",
        type: "password",
        required: false,
        helpText: "Socket Mode → App-Level Tokens (for Socket Mode inbound)",
      },
      {
        key: "channel",
        label: "Default Channel",
        placeholder: "#support-live",
        type: "text",
        required: true,
        helpText: "Channel for outbound replies",
      },
    ],
  },
  {
    id: "feishu",
    label: "Feishu",
    docsUrl: `${DOCS_BASE}/feishu`,
    icon: "feishu",
    connectMode: "plugin",
    backendType: "feishu",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "googlechat",
    label: "Google Chat",
    docsUrl: `${DOCS_BASE}/googlechat`,
    icon: "googlechat",
    connectMode: "plugin",
    backendType: "googlechat",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "mattermost",
    label: "Mattermost",
    docsUrl: `${DOCS_BASE}/mattermost`,
    icon: "mattermost",
    connectMode: "plugin",
    backendType: "mattermost",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "signal",
    label: "Signal",
    docsUrl: `${DOCS_BASE}/signal`,
    icon: "signal",
    connectMode: "plugin",
    backendType: "signal",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "bluebubbles",
    label: "BlueBubbles",
    docsUrl: `${DOCS_BASE}/bluebubbles`,
    icon: "bluebubbles",
    connectMode: "plugin",
    backendType: "bluebubbles",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "imessage",
    label: "iMessage (Legacy)",
    docsUrl: `${DOCS_BASE}/imessage`,
    icon: "imessage",
    connectMode: "plugin",
    backendType: "imessage",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "msteams",
    label: "Microsoft Teams",
    docsUrl: `${DOCS_BASE}/msteams`,
    icon: "msteams",
    connectMode: "plugin",
    backendType: "msteams",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "synology-chat",
    label: "Synology Chat",
    docsUrl: `${DOCS_BASE}/synology-chat`,
    icon: "synology-chat",
    connectMode: "plugin",
    backendType: "synology-chat",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "line",
    label: "LINE",
    docsUrl: `${DOCS_BASE}/line`,
    icon: "line",
    connectMode: "plugin",
    backendType: "line",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "nextcloud-talk",
    label: "Nextcloud Talk",
    docsUrl: `${DOCS_BASE}/nextcloud-talk`,
    icon: "nextcloud-talk",
    connectMode: "plugin",
    backendType: "nextcloud-talk",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "matrix",
    label: "Matrix",
    docsUrl: `${DOCS_BASE}/matrix`,
    icon: "matrix",
    connectMode: "plugin",
    backendType: "matrix",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "nostr",
    label: "Nostr",
    docsUrl: `${DOCS_BASE}/nostr`,
    icon: "nostr",
    connectMode: "plugin",
    backendType: "nostr",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "tlon",
    label: "Tlon",
    docsUrl: `${DOCS_BASE}/tlon`,
    icon: "tlon",
    connectMode: "plugin",
    backendType: "tlon",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "twitch",
    label: "Twitch",
    docsUrl: `${DOCS_BASE}/twitch`,
    icon: "twitch",
    connectMode: "plugin",
    backendType: "twitch",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "zalo",
    label: "Zalo",
    docsUrl: `${DOCS_BASE}/zalo`,
    icon: "zalo",
    connectMode: "plugin",
    backendType: "zalo",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "zalouser",
    label: "Zalo Personal",
    docsUrl: `${DOCS_BASE}/zalouser`,
    icon: "zalouser",
    connectMode: "plugin",
    backendType: "zalouser",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
  {
    id: "webchat",
    label: "WebChat",
    docsUrl: "https://docs.openclaw.ai/web/webchat",
    icon: "webchat",
    connectMode: "native",
    backendType: "webchat",
    configFields: GENERIC_PLUGIN_FIELDS,
  },
];

export function getChannelDefinition(type: string): ChannelDefinition | null {
  return CHANNEL_CATALOG.find((item) => item.id === type) ?? null;
}

export function inferCatalogTypeFromChannelId(channelId: string): string | null {
  const id = channelId.trim().toLowerCase();
  if (!id) return null;

  let bestMatch: string | null = null;
  for (const item of CHANNEL_CATALOG) {
    if (id === item.id || id.startsWith(`${item.id}-`)) {
      if (!bestMatch || item.id.length > bestMatch.length) {
        bestMatch = item.id;
      }
    }
  }
  return bestMatch;
}

export function resolveChannelCatalogType(rawType: string, channelId: string): string {
  const normalizedType = rawType.trim().toLowerCase();
  if (normalizedType && getChannelDefinition(normalizedType)) {
    return normalizedType;
  }

  const inferred = inferCatalogTypeFromChannelId(channelId);
  if (inferred) return inferred;
  if (normalizedType) return normalizedType;
  return "webhook";
}

export function nextChannelId(type: string, ids: string[]): string {
  const pattern = new RegExp(`^${type.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}-(\\d+)$`);
  let max = 0;
  let hasBase = false;
  for (const id of ids) {
    if (id === type) {
      hasBase = true;
      continue;
    }
    const match = pattern.exec(id);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > max) max = value;
  }
  if (!hasBase && max === 0) return type;
  return `${type}-${max + 1}`;
}

export function buildConfigFromValues(
  definition: ChannelDefinition,
  values: Record<string, string>,
  systemPrompt: string,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of definition.configFields) {
    const value = values[field.key]?.trim();
    if (!value) continue;
    if (field.key === "headers") {
      try {
        config.headers = JSON.parse(value);
      } catch {
        config.headers = value;
      }
      continue;
    }
    config[field.key] = value;
  }
  const trimmedSystem = systemPrompt.trim();
  if (trimmedSystem) config.system = trimmedSystem;
  return config;
}

export function buildSeedInstanceIds(): string[] {
  return CHANNEL_CATALOG.map((item) => item.id);
}

export function getChannelSetupInstructions(definition: ChannelDefinition): string[] {
  switch (definition.id) {
    case "discord":
      return [
        "Discord Developer Portal → Applications → New Application.",
        "Bot → Add Bot → Reset Token → copy token.",
        "OAuth2 → URL Generator → scope 'bot' → invite to your server.",
        "Bot → Privileged Gateway Intents → enable Message Content Intent.",
      ];
    case "telegram":
      return [
        "Open @BotFather in Telegram → send /newbot → follow prompts → copy bot token.",
        "Add your bot to a group/channel, or get your DM chat ID via @userinfobot.",
        "Paste Bot Token + Chat ID below and connect.",
      ];
    case "slack":
      return [
        "api.slack.com/apps → Create New App → From scratch.",
        "Socket Mode → Enable → generate App-Level Token with connections:write scope → copy xapp- token.",
        "OAuth & Permissions → Bot Token Scopes: chat:write, channels:read, im:read → Install to workspace → copy xoxb- token.",
        "Event Subscriptions → Subscribe to bot events: message.channels, message.im, app_mention.",
      ];
    case "whatsapp":
      return [
        "WhatsApp is handled by the gateway channel runtime; there is no separate runtime install path.",
        "Enter the provider/account details required by your deployment below.",
        "Connect and run a probe before enabling production traffic.",
        "If probe returns unsupported, the WhatsApp runtime is not enabled in this deployment yet.",
      ];
    case "signal":
      return [
        "Signal uses the gateway channel runtime and may require a linked Signal account or bridge in the deployment.",
        "Enter the connection details below.",
        "Connect and run a probe before enabling production traffic.",
        "If probe returns unsupported, Signal runtime support is not enabled in this deployment yet.",
      ];
    case "bluebubbles":
      return [
        "Install BlueBubbles server on your Mac (bluebubbles.app) — enable Private API + webhook.",
        "In BlueBubbles → Settings → Webhooks, add your One Shot gateway inbound URL.",
        "Copy the BlueBubbles server URL and password.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "imessage":
      return [
        "Legacy iMessage requires macOS + imsg relay. Use BlueBubbles for new setups (recommended).",
        "This channel uses gateway-side runtime support rather than a separate runtime install.",
        "Connect and run a probe before enabling production traffic.",
        "If probe returns unsupported, iMessage runtime support is not enabled in this deployment yet.",
      ];
    case "irc":
      return [
        "IRC is handled by the gateway channel runtime.",
        "Enter the server, account, and target details required by your deployment.",
        "Connect and run a probe before enabling production traffic.",
        "If probe returns unsupported, IRC runtime support is not enabled in this deployment yet.",
      ];
    case "feishu":
      return [
        "Create a Feishu/Lark app at open.feishu.cn → enable Bot capability.",
        "Collect the app credentials required by the provider.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "googlechat":
      return [
        "Create a Google Chat app in Google Cloud Console → enable Chat API.",
        "Collect the webhook or service credentials required by your deployment.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "mattermost":
      return [
        "Create a Mattermost bot account and generate a bot token.",
        "Collect the server URL and bot token for your workspace.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "msteams":
      return [
        "Register an Azure Bot Framework app in Azure Portal → note App ID + Password.",
        "Collect the app credentials and tenant details required by Microsoft Teams.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "synology-chat":
      return [
        "In Synology Chat → Integration → create incoming + outgoing webhooks.",
        "Copy outgoing webhook token and set the incoming webhook URL to your One Shot gateway inbound endpoint.",
        "Enter the connection details below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "line":
      return [
        "Create a LINE Messaging API channel at developers.line.biz → enable webhooks.",
        "Copy Channel Access Token + Channel Secret.",
        "Enter the credentials below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "nextcloud-talk":
      return [
        "Register a bot in Nextcloud Talk: php occ talk:bot:install <name> <secret> <inbound-url> <description>.",
        "Collect the base URL and bot secret from your Nextcloud deployment.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "matrix":
      return [
        "Create a Matrix bot account on your homeserver and generate an access token.",
        "Collect the homeserver URL and access token.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "nostr":
      return [
        "Generate a Nostr keypair (nsec/npub) for the bot identity.",
        "Collect the private key and relay configuration for the bot identity.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "tlon":
      return [
        "Ensure your Urbit ship is running and accessible.",
        "Collect the ship URL and access code required by your deployment.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "twitch":
      return [
        "Register a Twitch application at dev.twitch.tv → generate bot OAuth token.",
        "Collect the client ID and bot token required by Twitch.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "zalo":
      return [
        "Register a Zalo Official Account bot at developers.zalo.me.",
        "Collect the app credentials required by Zalo.",
        "Enter them below for the gateway channel runtime.",
        "Connect and run a probe before enabling production traffic.",
      ];
    case "zalouser":
      return [
        "Zalo Personal uses the gateway channel runtime rather than a separate runtime install.",
        "Complete any account pairing required by your deployment and enter the details below.",
        "Connect and run a probe before enabling production traffic.",
        "If probe returns unsupported, Zalo Personal runtime support is not enabled in this deployment yet.",
      ];
    case "webchat":
      return [
        "WebChat runs over the OpenClaw Gateway WebSocket — no third-party credentials needed.",
        "Embed the OpenClaw WebChat widget on your site using your gateway URL and tenant token.",
        "Use this entry to configure routing and session behavior.",
      ];
    default:
      if (definition.connectMode === "plugin") {
        return [
          "This channel is routed through the gateway's bundled channel runtime.",
          "Collect the provider credentials or account identifiers required by the channel platform.",
          "Connect and run a probe before going live.",
          "If probe returns unsupported, this channel runtime is not enabled in the current deployment.",
        ];
      }
      return [
        "Configure this channel in the gateway using the linked docs.",
        "Collect required credentials and paste them below.",
        "Connect and verify with a test message.",
      ];
  }
}
