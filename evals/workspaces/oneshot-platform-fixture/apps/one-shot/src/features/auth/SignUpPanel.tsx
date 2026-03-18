import { useSignUp } from '@clerk/clerk-react';
import { FormEvent, useMemo, useState } from 'react';
import { FaApple, FaGithub } from 'react-icons/fa';
import { FcGoogle } from 'react-icons/fc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { getClerkErrorMessage } from '@/features/auth/clerkError';

type SignUpPanelProps = {
  onSignedIn: () => void;
  compact?: boolean;
};

type AuthProvider = 'google' | 'github' | 'apple';

export function SignUpPanel({ onSignedIn, compact = false }: SignUpPanelProps) {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [showOtpStep, setShowOtpStep] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isReady = isLoaded && !!signUp;

  const maskedEmail = useMemo(() => {
    const trimmed = email.trim();
    const [localPart, domain] = trimmed.split('@');
    if (!localPart || !domain) return trimmed;
    if (localPart.length <= 2) return `${localPart[0] ?? ''}*@${domain}`;
    return `${localPart.slice(0, 2)}***@${domain}`;
  }, [email]);

  const setActiveAndFinish = async (sessionId?: string | null) => {
    if (!sessionId || !setActive) return;
    await setActive({ session: sessionId });
    onSignedIn();
  };

  const startOAuth = async (provider: AuthProvider) => {
    if (!isReady || !signUp) return;
    setErrorMessage('');
    try {
      await signUp.authenticateWithRedirect({
        strategy: `oauth_${provider}`,
        redirectUrl: '/#/sso-callback',
        redirectUrlComplete: '/#/home',
      });
    } catch (error) {
      setErrorMessage(getClerkErrorMessage(error));
    }
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!isReady || !signUp || isSubmitting || normalizedEmail.length === 0) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await signUp.create({
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        emailAddress: normalizedEmail,
      });
      await signUp.prepareEmailAddressVerification({
        strategy: 'email_code',
      });
      setShowOtpStep(true);
    } catch (error) {
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitOtp = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!isReady || !signUp || isSubmitting || normalizedCode.length !== 6) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const attempt = await signUp.attemptEmailAddressVerification({
        code: normalizedCode,
      });
      if (attempt.status === 'complete') {
        await setActiveAndFinish(attempt.createdSessionId);
        return;
      }
      setErrorMessage('Verification is incomplete. Please try again.');
    } catch (error) {
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={compact ? 'grid gap-1.5 text-xs sm:text-sm' : 'grid gap-[clamp(0.5rem,1.2vh,1rem)] text-sm'}>
      <div className={compact ? 'mx-auto flex w-full max-w-[248px] gap-1.5 sm:max-w-[280px]' : 'mx-auto flex w-full max-w-[280px] gap-2 sm:max-w-[320px]'}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={compact ? 'h-7 flex-1 sm:h-8' : 'h-8 flex-1 sm:h-9'}
          aria-label="Continue with Apple"
          onClick={() => startOAuth('apple')}
        >
          <FaApple className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={compact ? 'h-7 flex-1 sm:h-8' : 'h-8 flex-1 sm:h-9'}
          aria-label="Continue with GitHub"
          onClick={() => startOAuth('github')}
        >
          <FaGithub className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={compact ? 'h-7 flex-1 sm:h-8' : 'h-8 flex-1 sm:h-9'}
          aria-label="Continue with Google"
          onClick={() => startOAuth('google')}
        >
          <FcGoogle className="size-4" />
        </Button>
      </div>

      <div className={compact ? 'flex items-center gap-1.5 text-[11px] text-muted-foreground' : 'flex items-center gap-2 text-xs text-muted-foreground'}>
        <Separator className="flex-1" />
        <span>or continue with</span>
        <Separator className="flex-1" />
      </div>

      {showOtpStep ? (
        <form
          className={
            compact
              ? 'grid gap-2 pb-0'
              : 'mt-[clamp(0.2rem,0.8vh,0.75rem)] grid gap-[clamp(0.55rem,1.1vh,0.95rem)] pb-[clamp(0rem,0.5vh,0.45rem)]'
          }
          onSubmit={submitOtp}
        >
          <div className={compact ? 'grid gap-1' : 'grid gap-1.5'}>
            <Label className={compact ? 'text-xs font-medium sm:text-sm' : 'text-sm font-medium'} htmlFor="signup-otp">
              Verification code
            </Label>
            <p className={compact ? 'text-[11px] text-muted-foreground' : 'text-xs text-muted-foreground'}>
              Enter the 6-digit code sent to {maskedEmail}.
            </p>
            <InputOTP id="signup-otp" maxLength={6} value={code} onChange={(value) => setCode(value)}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
          <Button
            type="submit"
            variant="default"
            className={
              compact
                ? 'h-8 w-40 justify-center self-center bg-neutral-700 text-white hover:bg-neutral-600'
                : 'mt-[clamp(0.15rem,0.7vh,0.6rem)] h-9 w-52 justify-center self-center bg-neutral-700 text-white hover:bg-neutral-600'
            }
          >
            {isSubmitting ? 'Verifying...' : 'Continue'}
          </Button>
          <Button
            type="button"
            variant="link"
            className={compact ? 'px-0 text-[11px]' : 'px-0 text-xs'}
            onClick={() => setShowOtpStep(false)}
          >
            Use a different email
          </Button>
        </form>
      ) : (
        <form
          className={
            compact
              ? 'grid gap-2 pb-0'
              : 'mt-[clamp(0.2rem,0.8vh,0.75rem)] grid gap-[clamp(0.55rem,1.1vh,0.95rem)] pb-[clamp(0rem,0.5vh,0.45rem)]'
          }
          onSubmit={submitEmail}
        >
          <div className={compact ? 'grid grid-cols-2 gap-1' : 'grid grid-cols-2 gap-1.5 sm:gap-2'}>
            <div className={compact ? 'grid gap-1' : 'grid gap-1.5'}>
              <Label className={compact ? 'text-xs font-medium sm:text-sm' : 'text-sm font-medium'} htmlFor="signup-first-name">
                First name
              </Label>
              <Input
                className={compact ? 'h-7 text-xs sm:h-8 sm:text-sm' : 'h-8 text-sm sm:h-9'}
                id="signup-first-name"
                name="signup-first-name"
                type="text"
                autoComplete="given-name"
                placeholder="First name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className={compact ? 'grid gap-1' : 'grid gap-1.5'}>
              <Label className={compact ? 'text-xs font-medium sm:text-sm' : 'text-sm font-medium'} htmlFor="signup-last-name">
                Last name
              </Label>
              <Input
                className={compact ? 'h-7 text-xs sm:h-8 sm:text-sm' : 'h-8 text-sm sm:h-9'}
                id="signup-last-name"
                name="signup-last-name"
                type="text"
                autoComplete="family-name"
                placeholder="Last name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>
          <div className={compact ? 'grid gap-1' : 'grid gap-1.5'}>
            <Label className={compact ? 'text-xs font-medium sm:text-sm' : 'text-sm font-medium'} htmlFor="signup-email">
              Email address
            </Label>
            <Input
              className={compact ? 'h-7 text-xs sm:h-8 sm:text-sm' : 'h-8 text-sm sm:h-9'}
              id="signup-email"
              name="signup-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div id="clerk-captcha" />
          {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
          <Button
            type="submit"
            variant="default"
            className={
              compact
                ? 'h-8 w-40 justify-center self-center bg-neutral-700 text-white hover:bg-neutral-600'
                : 'mt-[clamp(0.15rem,0.7vh,0.6rem)] h-9 w-52 justify-center self-center bg-neutral-700 text-white hover:bg-neutral-600'
            }
          >
            {isSubmitting ? 'Sending code...' : 'Continue'}
          </Button>
        </form>
      )}
    </div>
  );
}
