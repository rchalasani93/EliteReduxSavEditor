const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
for (const [marker, file] of [
  ['STYLES', 'style.css'],
  ['CATALOG', 'catalog.json'],
  ['CATALOG_PATCHES', 'catalog-patches.json'],
  ['ICONS', 'icons.json'],
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
    .replace('<title>Redux Save Studio</title>', '<title>Redux Save Studio (dev)</title>')
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
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
fs.writeFileSync(path.join(root, 'Redux Save Studio.html'), html);
console.log(`Built standalone editor (${Math.round(Buffer.byteLength(html) / 1024)} KB).`);
