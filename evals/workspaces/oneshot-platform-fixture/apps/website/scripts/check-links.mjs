import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

const EXTERNAL_PROTOCOL = /^(https?:)?\/\//i;
const NON_HTTP_PROTOCOL = /^(mailto:|tel:|javascript:|data:)/i;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute));
      continue;
    }
    if (entry.isFile() && absolute.endsWith('.html')) {
      files.push(absolute);
    }
  }
  return files;
}

function routeFromHtmlFile(filePath) {
  const relative = path.relative(distDir, filePath).replace(/\\/g, '/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
}

function extractHrefs(html) {
  const hrefs = [];
  const matcher = /<a\s[^>]*href=(?:"([^"]+)"|'([^']+)')/gi;
  let match;
  while ((match = matcher.exec(html)) !== null) {
    const href = match[1] ?? match[2];
    if (href) hrefs.push(href.trim());
  }
  return hrefs;
}

function toInternalPath(href, routePath) {
  if (!href || href.startsWith('#') || NON_HTTP_PROTOCOL.test(href) || EXTERNAL_PROTOCOL.test(href)) {
    return null;
  }

  const raw = href.split('#')[0];
  const [pathname] = raw.split('?');
  const base = `https://capzero.com${routePath}`;
  const resolved = new URL(pathname, base);
  return resolved.pathname;
}

function candidateFiles(pathname) {
  const cleanPath = pathname.replace(/\/{2,}/g, '/');
  const stripped = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
  if (!stripped) return [path.join(distDir, 'index.html')];

  if (stripped.endsWith('/')) {
    return [path.join(distDir, stripped, 'index.html')];
  }

  const extension = path.extname(stripped);
  if (extension) {
    return [path.join(distDir, stripped)];
  }

  return [path.join(distDir, stripped, 'index.html'), path.join(distDir, `${stripped}.html`)];
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const htmlFiles = await walk(distDir);
  const broken = [];

  for (const filePath of htmlFiles) {
    const routePath = routeFromHtmlFile(filePath);
    const html = await readFile(filePath, 'utf8');
    for (const href of extractHrefs(html)) {
      const internalPath = toInternalPath(href, routePath);
      if (!internalPath) continue;

      const candidates = candidateFiles(internalPath);
      let valid = false;
      for (const candidate of candidates) {
        if (await exists(candidate)) {
          valid = true;
          break;
        }
      }

      if (!valid) {
        broken.push({ source: routePath, href, resolved: internalPath });
      }
    }
  }

  if (broken.length === 0) {
    console.log(`Checked ${htmlFiles.length} HTML files. No broken internal links found.`);
    return;
  }

  console.error(`Found ${broken.length} broken internal links:`);
  for (const item of broken) {
    console.error(`- ${item.source} -> ${item.href} (resolved: ${item.resolved})`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error('Link check failed:', error);
  process.exit(1);
});
