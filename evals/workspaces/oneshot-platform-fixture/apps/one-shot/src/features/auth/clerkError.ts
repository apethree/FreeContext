export function getClerkErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'Authentication failed. Please try again.';
  }

  const maybeErrors = (error as { errors?: Array<{ longMessage?: string; message?: string }> })
    .errors;
  const first = maybeErrors?.[0];
  return first?.longMessage || first?.message || 'Authentication failed. Please try again.';
}
