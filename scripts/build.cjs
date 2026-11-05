const fs = require('node:fs'),
  path = require('node:path'),
  { createHash } = require('node:crypto');
const png = require('./png.cjs');
const root = path.resolve(__dirname, '..');
// Sprites are stored as the verified original PNGs (src/icons.json) and re-encoded here as
// indexed PNGs: identical pixels at under a third of the size, so the page loads faster.
function compactIcons(text) {
  const icons = JSON.parse(text);
  for (const [key, value] of Object.entries(icons.images)) {
    const prefix = 'data:image/png;base64,';
    if (!value.startsWith(prefix)) throw new Error(`Sprite ${key} is not PNG data.`);
    icons.images[key] =
      prefix + png.compact(Buffer.from(value.slice(prefix.length), 'base64')).toString('base64');
  }
  return JSON.stringify(icons);
}
const icons = compactIcons(fs.readFileSync(path.join(root, 'src/icons.json'), 'utf8'));
let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
for (const [marker, file] of [
  ['STYLES', 'style.css'],
  ['CATALOG', 'catalog.json'],
  ['CATALOG_PATCHES', 'catalog-patches.json'],
  ['CORE', 'core.js'],
  ['RNG', 'rng.js'],
  ['STORY_DATA', 'story.json'],
  ['STORY', 'story.js'],
  ['HTML', 'html.js'],
  ['APP', 'app.js'],
])
  html = html.replace(`/* ${marker} */`, () =>
    fs.readFileSync(path.join(root, 'src', file), 'utf8').replace(/<\/script/gi, '<\\/script'),
  );
// ER_CHANNEL=dev marks the preview build published under /dev/ from the develop branch.
if (process.env.ER_CHANNEL === 'dev') {
  html = html
    .replace('<title>Elite Redux Save Editor – Redux Save Studio</title>', '<title>Redux Save Studio (dev)</title>')
    .replace(
      '<meta charset="utf-8" />',
      '<meta charset="utf-8" />\n    <meta name="robots" content="noindex" />',
    )
    .replace(
      '<body>',
      '<body class="dev-build">\n    <div class="dev-banner" role="note">Development preview from the develop branch. Features may change or break; keep a backup of your save. <a href="../">Open the stable editor</a></div>',
    );
}
// ER_GA_ID adds Google Analytics (a GA4 measurement ID such as G-ABC123XYZ). The page loads it
// only after the visitor agrees, and only page views are sent: never save data.
const gaId = (process.env.ER_GA_ID || '').trim();
if (gaId) {
  if (!/^G-[A-Z0-9]{4,20}$/.test(gaId))
    throw new Error(`ER_GA_ID "${gaId}" is not a GA4 measurement ID.`);
  html = html.replace(
    '</head>',
    `  <script id="analytics-config">window.ER_ANALYTICS = { id: '${gaId}' };</script>\n  </head>`,
  );
}
// The standalone file (and the editor's offline download) carries the sprites inside it. The
// hosted site serves them as a separate file named by its content hash, so the page shows
// quickly and the sprites follow in the background; a changed sprite set gets a new name.
const standalone = html.replace('/* ICONS */', () => icons.replace(/<\/script/gi, '<\\/script'));
const iconsFile = `icons-${createHash('sha256').update(icons).digest('hex').slice(0, 16)}.json`;
const hosted = html
  .replace('/* ICONS */', '{"images":{}}')
  .replace(
    '<script id="pokemon-icons" type="application/json">',
    `<script id="pokemon-icons" type="application/json" data-src="${iconsFile}">`,
  )
  .replace(
    '<meta charset="utf-8" />',
    `<meta charset="utf-8" />\n    <link rel="preload" href="${iconsFile}" as="fetch" crossorigin="anonymous" />`,
  );
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
for (const old of fs.readdirSync(dist))
  if (/^icons-[a-f0-9]+\.json$/.test(old)) fs.rmSync(path.join(dist, old));
fs.writeFileSync(path.join(dist, 'index.html'), hosted);
// Production gets a sitemap for Google Search Console. The /dev/ preview is noindex, so it has none.
const sitemap = path.join(dist, 'sitemap.xml');
if (process.env.ER_CHANNEL === 'dev') fs.rmSync(sitemap, { force: true });
else
  fs.writeFileSync(
    sitemap,
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://rchalasani93.github.io/EliteReduxSavEditor/</loc>\n  </url>\n</urlset>\n',
  );
fs.writeFileSync(path.join(dist, iconsFile), icons);
fs.writeFileSync(path.join(root, 'Redux Save Studio.html'), standalone);
const kb = text => Math.round(Buffer.byteLength(text) / 1024);
console.log(
  `Built the editor: site page ${kb(hosted)} KB + sprites ${kb(icons)} KB (${iconsFile}); standalone file ${kb(standalone)} KB.`,
);
