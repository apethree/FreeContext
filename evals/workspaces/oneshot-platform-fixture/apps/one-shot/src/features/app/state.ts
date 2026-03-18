import { atom } from 'jotai';
import { DEFAULT_APP_STATE } from '@/features/app/defaults';
import type { AppShellState } from '@/features/app/types';

export const appShellStateAtom = atom<AppShellState>(DEFAULT_APP_STATE);
export const appShellHydratedAtom = atom(false);
