import '@/appShellStub';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';
import { App } from '@/App';
import { ThemeProvider } from '@/components/theme-provider';
import { getAppCapabilities } from '@/lib/appCapabilities';
import '@/index.css';

const clerkPublishableKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
const queryClient = new QueryClient();
const capabilities = getAppCapabilities();

document.documentElement.dataset.platform = capabilities.platform;

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root element');
}

createRoot(root).render(
  <StrictMode>
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {clerkPublishableKey ? (
            <ClerkProvider publishableKey={clerkPublishableKey}>
              <App />
            </ClerkProvider>
          ) : (
            <main className="screen-center">
              <div className="missing-key-card">
                Missing <code>VITE_CLERK_PUBLISHABLE_KEY</code>
              </div>
            </main>
          )}
        </ThemeProvider>
      </QueryClientProvider>
    </JotaiProvider>
  </StrictMode>,
);
