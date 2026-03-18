import type { AppMode } from "@/features/app/types";

export type ModeNavItem = {
  id: string;
  label: string;
  description?: string;
  desktopOnly?: boolean;
  iconKey:
    | "skills"
    | "templates"
    | "style-lab"
    | "oneshot"
    | "openclaw-demo"
    | "openclaw-hosted-phase"
    | "assistant-chat"
    | "web-test"
    | "ghost-layer"
    | "cloud-inspector"
    | "chats-inbox"
    | "chats-manage-channels"
    | "mail-inbox"
    | "mail-connect";
};

export type ModeConfig = {
  label: string;
  navItems: ModeNavItem[];
  showHarnesses: boolean;
  /** HSL accent color for the mode (e.g. "220 70% 55%") */
  color: string;
};

export const MODE_ORDER: AppMode[] = [
  "work",
  "finance",
  "social",
  "health",
  "chats",
  "mail",
];

export const MODE_CONFIG: Record<AppMode, ModeConfig> = {
  work: {
    label: "Work",
    color: "220 70% 55%",
    showHarnesses: true,
    navItems: [
      {
        id: "skills",
        label: "Skills",
        description: "Browse and manage AI skills and capabilities.",
        iconKey: "skills",
      },
      {
        id: "templates",
        label: "Templates",
        description: "Curated starter templates and shared harnesses.",
        iconKey: "templates",
      },
      {
        id: "style-lab",
        label: "Style Lab",
        description: "Capsule-candy component showcase and visual experiments.",
        iconKey: "style-lab",
      },
      {
        id: "oneshot",
        label: "One Shot",
        description: "Single-pass AI agent execution pipeline.",
        iconKey: "oneshot",
      },
      {
        id: "openclaw-demo",
        label: "OpenClaw Demo",
        description: "Live demo of OpenClaw server stack.",
        iconKey: "openclaw-demo",
        desktopOnly: true,
      },
      {
        id: "openclaw-hosted-phase",
        label: "Hosted Phase Test",
        description: "Test hosted phase OAuth and runtime wiring.",
        iconKey: "openclaw-hosted-phase",
        desktopOnly: true,
      },
      {
        id: "assistant-chat",
        label: "Global Assistant",
        description: "Primary multi-provider global assistant workspace.",
        iconKey: "assistant-chat",
      },
      {
        id: "web-test",
        label: "Web Test",
        description: "Browser-based testing harness.",
        iconKey: "web-test",
        desktopOnly: true,
      },
      {
        id: "ghost-layer",
        label: "Ghost Layer",
        description: "Annotate websites for human ↔ LLM review workflows.",
        iconKey: "ghost-layer",
        desktopOnly: true,
      },
      {
        id: "cloud-inspector",
        label: "Cloud Inspector",
        description: "Inspect cloud gateway tenant/session/token state.",
        iconKey: "cloud-inspector",
      },
    ],
  },
  finance: {
    label: "Finance",
    color: "160 55% 45%",
    showHarnesses: false,
    navItems: [],
  },
  social: {
    label: "Social",
    color: "35 75% 55%",
    showHarnesses: false,
    navItems: [],
  },
  health: {
    label: "Health",
    color: "350 65% 55%",
    showHarnesses: false,
    navItems: [],
  },
  chats: {
    label: "Chats",
    color: "270 55% 55%",
    showHarnesses: false,
    navItems: [
      {
        id: "chats-inbox",
        label: "Inbox",
        description: "Review approvals, escalations, and contact timelines.",
        iconKey: "chats-inbox",
      },
    ],
  },
  mail: {
    label: "Mail",
    color: "198 74% 46%",
    showHarnesses: false,
    navItems: [
      {
        id: "mail-inbox",
        label: "Inbox",
        description: "Review all connected mailbox threads and approvals in one place.",
        iconKey: "mail-inbox",
      },
      {
        id: "mail-connect",
        label: "Connect Mail",
        description: "Connect providers and configure CapZero Mail identities.",
        iconKey: "mail-connect",
      },
    ],
  },
};
