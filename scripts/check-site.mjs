import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = await walk(root);
const pages = files.filter((file) => file.endsWith(".html"));
const failures = [];

for (const page of pages) {
  const html = await readFile(page, "utf8");
  requireText(page, html, '<meta name="robots" content="noindex, nofollow, noarchive">');
  requireText(page, html, '<meta name="referrer" content="no-referrer">');
  requireText(page, html, "default-src 'none'");

  for (const [label, pattern] of [
    ["client-side script", /<script\b/i],
    ["form", /<form\b/i],
    ["embedded frame", /<iframe\b/i],
    ["image", /<img\b/i],
    ["external URL", /https?:\/\//i],
    ["email address", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
    ["analytics marker", /google-analytics|googletagmanager|gtag\(|plausible|segment|hotjar/i],
  ]) {
    if (pattern.test(html)) failures.push(`${relative(page)} contains ${label}`);
  }

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (target.startsWith("#")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
      failures.push(`${relative(page)} references an external resource`);
      continue;
    }
    const candidate = normalize(resolve(dirname(page), target));
    if (candidate !== root && !candidate.startsWith(`${root}/`)) {
      failures.push(`${relative(page)} links outside the site root`);
      continue;
    }
    if (!(await exists(candidate)) && !(await exists(join(candidate, "index.html")))) {
      failures.push(`${relative(page)} has a broken local link: ${target}`);
    }
  }
}

const robots = await readFile(join(root, "robots.txt"), "utf8");
if (robots.trim() !== "User-agent: *\nDisallow: /") {
  failures.push("robots.txt must discourage all crawling");
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`policy surface check: ${pages.length} pages clean\n`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter((entry) => entry.name !== ".git")
    .map((entry) => entry.isDirectory()
      ? walk(join(directory, entry.name))
      : [join(directory, entry.name)]));
  return nested.flat();
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function requireText(page, html, expected) {
  if (!html.includes(expected)) failures.push(`${relative(page)} is missing ${expected}`);
}

function relative(path) {
  return path.slice(root.length + 1);
}
