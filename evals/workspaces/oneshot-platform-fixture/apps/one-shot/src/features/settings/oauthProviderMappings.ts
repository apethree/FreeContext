import type { OauthProviderId } from '@/features/settings/connectedAccountsTypes';
import claudeLogo from '@/features/settings/assets/claude-logo.svg';
import geminiLogo from '@/features/settings/assets/gemini-logo.svg';
import openaiLogo from '@/features/settings/assets/openai-logo.svg';

export type OAuthLaunchProvider = 'openai-codex' | 'anthropic' | 'google-gemini-cli';
export type OAuthCloudProvider = 'openai' | 'anthropic' | 'gemini';

export type ManagedOAuthProviderMeta = {
  id: OauthProviderId;
  label: string;
  logoSrc: string;
  hint: string;
  launchProvider: OAuthLaunchProvider;
  cloudProvider: OAuthCloudProvider;
};

export const MANAGED_OAUTH_PROVIDERS: ManagedOAuthProviderMeta[] = [
  {
    id: 'openai',
    label: 'ChatGPT',
    logoSrc: openaiLogo,
    hint: 'Use your browser to finish connecting this account.',
    launchProvider: 'openai-codex',
    cloudProvider: 'openai',
  },
  {
    id: 'claude',
    label: 'Claude',
    logoSrc: claudeLogo,
    hint: 'Use your browser to finish connecting this account.',
    launchProvider: 'anthropic',
    cloudProvider: 'anthropic',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    logoSrc: geminiLogo,
    hint: 'Use your browser to finish connecting this account.',
    launchProvider: 'google-gemini-cli',
    cloudProvider: 'gemini',
  },
];

export const OAUTH_PROVIDER_META: Record<OauthProviderId, ManagedOAuthProviderMeta> = {
  openai: MANAGED_OAUTH_PROVIDERS[0],
  claude: MANAGED_OAUTH_PROVIDERS[1],
  gemini: MANAGED_OAUTH_PROVIDERS[2],
};
