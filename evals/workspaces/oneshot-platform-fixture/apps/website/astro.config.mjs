// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://capzero.com',
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
  integrations: [
    sitemap({
      filter: (page) => {
        const pathname = page.startsWith('http') ? new URL(page).pathname : page;
        return !/^\/login\/?$/.test(pathname);
      },
    }),
    starlight({
      title: 'OneShot Docs',
      description: 'Documentation for OneShot by CapZero.',
      disable404Route: true,
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: true,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/capzeroai/one-shot' },
        { icon: 'x.com', label: 'X', href: 'https://x.com/capzeroai' },
      ],
      customCss: ['./src/styles/global.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Installation', slug: 'getting-started/installation' },
          ],
        },
        {
          label: 'Desktop App',
          items: [
            { label: 'Overview', slug: 'desktop/overview' },
            { label: 'Connecting Providers', slug: 'desktop/providers' },
            { label: 'Sessions & History', slug: 'desktop/sessions' },
          ],
        },
        {
          label: 'Cloud',
          items: [
            { label: 'Overview', slug: 'cloud/overview' },
            { label: 'Channels', slug: 'cloud/channels' },
            { label: 'Webhooks', slug: 'cloud/webhooks' },
          ],
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
