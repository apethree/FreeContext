export type MailConnectorStatus = "connected" | "syncing" | "error";

export type ConnectedMailbox = {
  id: string;
  provider: string;
  displayName: string;
  address: string;
  status: MailConnectorStatus;
  unread: number;
  pendingApprovals: number;
  lastSyncLabel: string;
};

export type MailConnector = {
  id: string;
  provider: string;
  description: string;
  hint: string;
  connected: boolean;
  recommended?: boolean;
};

export const CONNECTED_MAILBOXES: ConnectedMailbox[] = [
  {
    id: "capzero-primary",
    provider: "CapZero Mail",
    displayName: "CapZero Personal",
    address: "narya@capzero.com",
    status: "connected",
    unread: 8,
    pendingApprovals: 2,
    lastSyncLabel: "Synced 10s ago",
  },
  {
    id: "gmail-work",
    provider: "Gmail",
    displayName: "Work Gmail",
    address: "narya.work@gmail.com",
    status: "syncing",
    unread: 24,
    pendingApprovals: 5,
    lastSyncLabel: "Syncing now",
  },
  {
    id: "outlook-ops",
    provider: "Outlook",
    displayName: "Ops Outlook",
    address: "ops@narya.co",
    status: "error",
    unread: 3,
    pendingApprovals: 0,
    lastSyncLabel: "Auth refresh required",
  },
];

export const MAIL_CONNECTORS: MailConnector[] = [
  {
    id: "capzero",
    provider: "CapZero Mail",
    description: "Get a clean @capzero.com mailbox managed by your agent.",
    hint: "Best for hands-off inbox management with simple approvals.",
    connected: true,
    recommended: true,
  },
  {
    id: "gmail",
    provider: "Gmail",
    description: "Connect personal or workspace Gmail accounts.",
    hint: "OAuth sync with labels and thread history.",
    connected: true,
  },
  {
    id: "outlook",
    provider: "Outlook",
    description: "Bring in Outlook and Microsoft 365 mailboxes.",
    hint: "Ideal for enterprise team inboxes.",
    connected: true,
  },
  {
    id: "icloud",
    provider: "iCloud Mail",
    description: "Connect Apple iCloud inboxes for unified triage.",
    hint: "Works well for personal correspondence.",
    connected: false,
  },
  {
    id: "imap",
    provider: "IMAP",
    description: "Connect legacy or private-hosted mail providers.",
    hint: "Use app password credentials when OAuth is unavailable.",
    connected: false,
  },
];
