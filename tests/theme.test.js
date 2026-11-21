const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = join(__dirname, "..");
const css = readFileSync(join(root, "src", "style.css"), "utf8");
const html = readFileSync(join(root, "src", "index.html"), "utf8");
const appJs = readFileSync(join(root, "src", "app.js"), "utf8");
const mainJs = readFileSync(join(root, "main.js"), "utf8");
const siteCss = readFileSync(join(root, "docs", "site.css"), "utf8");
const siteHtml = readFileSync(join(root, "docs", "index.html"), "utf8");
const siteJs = readFileSync(join(root, "docs", "site.js"), "utf8");

test("uses the Odoo Doctor light and dark design tokens", () => {
  assert.match(css, /--bg:\s*#fffafd/i);
  assert.match(css, /--primary:\s*#714b67/i);
  assert.match(css, /--secondary:\s*#f5edf4/i);
  assert.match(css, /--technical:\s*#007a78/i);
  assert.match(css, /--technical-bright:\s*#00a09d/i);
  assert.match(css, /--bg:\s*#201721/i);
  assert.match(css, /--primary:\s*#caa6bf/i);
  assert.match(css, /font-family:\s*"Inter"/i);
  assert.match(css, /font-family:\s*"Caveat"/i);
});

test("keeps focus, reduced-motion, and responsive safeguards", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@media\s*\(max-width:\s*1080px\)/);
});

test("presents the Desk brand as a product identity", () => {
  assert.match(html, /class="brand-copy"/);
  assert.match(html, /class="brand-name">Desk for Odoo/);
  assert.match(html, /class="brand-tagline">Local developer workspace/);
});

test("does not introduce remote font or script dependencies", () => {
  assert.doesNotMatch(html, /https?:\/\/[^"']+\.(?:js|css)/i);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(appJs, /style=["']/i);
});

test("website shares the Odoo Doctor visual system without breaking downloads", () => {
  assert.match(siteCss, /--bg:\s*#fffafd/i);
  assert.match(siteCss, /--primary:\s*#714b67/i);
  assert.match(siteCss, /--technical:\s*#007a78/i);
  assert.match(siteCss, /--sans:\s*"Inter",\s*"Odoo Unicode Support Noto"/i);
  assert.match(siteCss, /--handwritten:\s*"Caveat"/i);
  assert.match(siteHtml, /id="cta-download"/);
  assert.match(siteHtml, /data-asset="\.exe"/);
  assert.match(siteHtml, /data-asset="\.dmg"/);
  assert.match(siteHtml, /data-asset="\.AppImage"/);
  assert.doesNotMatch(siteHtml, /\sstyle=["']/i);
});

test("offers Light, Dark, and System appearance modes", () => {
  assert.match(appJs, /\["system", "System"\]/);
  assert.match(siteHtml, /id="theme-toggle"/);
  assert.match(siteHtml, /aria-label="Appearance: System"/);
  assert.match(siteJs, /desk-theme/);
  assert.match(siteJs, /\["system", "light", "dark"\]/);
  assert.match(siteCss, /data-theme="dark"/);
  assert.match(siteCss, /data-theme="light"/);
});

test("connects both products with an allowlisted Odoo Doctor link", () => {
  assert.match(html, /id="open-doctor"/);
  assert.match(appJs, /https:\/\/odoo-doctor\.com/);
  assert.match(mainJs, /\^https:\\\/\\\/odoo-doctor\\\.com/);
  assert.match(siteHtml, /class="doctor-link"[^>]+href="https:\/\/odoo-doctor\.com"/);
});
