export type ApiProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'moonshot'
  | 'minimax'
  | 'zai';

export type ManagedOauthProvider = 'claude' | 'openai' | 'gemini';
export type OauthProviderId = ManagedOauthProvider;

export type ConnectedAccountsSecrets = {
  apiKeys: Partial<Record<ApiProviderId, string>>;
  proxyTokens: Record<string, string>;
};

export type ChatProviderSelection =
  | 'auto'
  | 'proxy'
  | `api:${ApiProviderId}`
  | `proxy:${string}`;

export type ProxyProfileMeta = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
};

export type ConnectedAccountsState = {
  defaultApiProvider: ApiProviderId;
  defaultOauthProvider: OauthProviderId;
  defaultChatProvider: ChatProviderSelection;
  defaultChatModel: string;
  secrets: ConnectedAccountsSecrets;
  proxyProfiles: ProxyProfileMeta[];
  activeProxyProfileId: string;
};

export type ProxyAuthStatus = {
  claude: number;
  openai: number;
  gemini: number;
};

export type ProxyHealthResult = {
  healthy: boolean;
  latency_ms: number | null;
  status_code: number | null;
  error: string;
};

export const DEFAULT_CONNECTED_ACCOUNTS_STATE: ConnectedAccountsState = {
  defaultApiProvider: 'openai',
  defaultOauthProvider: 'openai',
  defaultChatProvider: 'auto',
  defaultChatModel: '',
  secrets: {
    apiKeys: {},
    proxyTokens: {},
  },
  proxyProfiles: [],
  activeProxyProfileId: '',
};
