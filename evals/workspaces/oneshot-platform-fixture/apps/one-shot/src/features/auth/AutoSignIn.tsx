import { useSignIn } from '@clerk/clerk-react';
import { useEffect, useRef, useState } from 'react';
import { OneShotLogo } from '@/features/app/OneShotLogo';

type AutoSignInProps = {
  onFallback: () => void;
};

function isAutoSignInEnabled() {
  if (import.meta.env.PROD) return false;
  const flag = String(import.meta.env.VITE_DEV_AUTO_SIGNIN ?? '').trim().toLowerCase();
  if (!flag) return true;
  return flag === '1' || flag === 'true';
}

export function AutoSignIn({ onFallback }: AutoSignInProps) {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const attemptedRef = useRef(false);

  const email = String(import.meta.env.VITE_DEV_AUTO_SIGNIN_EMAIL || 'test+clerk_test@test.com').trim();
  const otpCode = String(import.meta.env.VITE_DEV_AUTO_SIGNIN_OTP || '424242').trim();
  const enabled = isAutoSignInEnabled();

  useEffect(() => {
    if (!enabled) {
      onFallback();
      return;
    }
    if (!isLoaded || attemptedRef.current || !signIn) return;
    if (!email || !otpCode) {
      setStatus('error');
      return;
    }

    attemptedRef.current = true;
    let cancelled = false;

    const signInClient = signIn;

    async function run() {
      try {
        const created = await signInClient.create({
          strategy: 'email_code',
          identifier: email,
        });

        if (created.status === 'complete' && created.createdSessionId) {
          await setActive?.({ session: created.createdSessionId });
          return;
        }

        const emailCodeFactor = created.supportedFirstFactors?.find(
          (factor) =>
            factor.strategy === 'email_code' &&
            'emailAddressId' in factor &&
            typeof factor.emailAddressId === 'string',
        );

        if (!emailCodeFactor || !('emailAddressId' in emailCodeFactor)) {
          throw new Error('Email code factor unavailable for dev auto sign-in account.');
        }

        await signInClient.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: emailCodeFactor.emailAddressId,
        });

        const attempt = await signInClient.attemptFirstFactor({
          strategy: 'email_code',
          code: otpCode,
        });

        if (attempt.status === 'complete' && attempt.createdSessionId) {
          await setActive?.({ session: attempt.createdSessionId });
          return;
        }

        throw new Error(`Dev auto sign-in did not complete (status: ${attempt.status}).`);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error('[AutoSignIn] failed:', message);
        setStatus('error');
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [email, enabled, isLoaded, onFallback, otpCode, setActive, signIn]);

  useEffect(() => {
    if (status === 'error') {
      onFallback();
    }
  }, [onFallback, status]);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <OneShotLogo className="h-10 w-10" aria-label="One Shot" />
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
        <p className="text-sm">Signing in automatically...</p>
      </div>
    </div>
  );
}
