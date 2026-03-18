import { atom } from 'jotai';

export type ReviewIssueStatus = 'open' | 'fixing' | 'fixed' | 'verified' | 'wont_fix';
export type ReviewSeverity = 'critical' | 'major' | 'minor' | 'suggestion';

export type ReviewIssue = {
  id: string;
  description: string;
  severity: ReviewSeverity;
  category: string;
  status: ReviewIssueStatus;
  annotationId: string;
};

export type ReviewSessionState = {
  active: boolean;
  sessionId: string;
  url: string;
  iteration: number;
  maxIterations: number;
  status: 'idle' | 'reviewing' | 'sending' | 'waiting' | 'fixing' | 'verifying' | 'complete';
  issues: ReviewIssue[];
  agentMessages: string[];
};

export const reviewSessionAtom = atom<ReviewSessionState>({
  active: false,
  sessionId: '',
  url: '',
  iteration: 0,
  maxIterations: 5,
  status: 'idle',
  issues: [],
  agentMessages: [],
});
