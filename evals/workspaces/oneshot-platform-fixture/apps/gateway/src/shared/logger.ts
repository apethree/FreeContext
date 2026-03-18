export function logEvent(service: string, event: string, data: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      service,
      event,
      ...data,
    }),
  );
}

export function logError(service: string, event: string, error: unknown, data: Record<string, unknown> = {}): void {
  logEvent(service, event, {
    ...data,
    error: error instanceof Error ? error.message : String(error),
  });
}
