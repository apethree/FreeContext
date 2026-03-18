import { useQuery } from '@tanstack/react-query';

export type LocalAuthProfile = {
  profileId: string;
  provider: string;
  type: string;
  hasAccess: boolean;
  hasRefresh: boolean;
  expires: number | null;
  email: string | null;
};

export const authProfilesQueryKey = ['one-shot', 'auth-profiles'] as const;

export function useAuthProfiles() {
  return useQuery({
    queryKey: authProfilesQueryKey,
    queryFn: async () => await window.appShell.pipelineListAuthProfiles(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
