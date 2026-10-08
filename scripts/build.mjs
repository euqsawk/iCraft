// Build : bundle TypeScript → dist/, copie des fichiers statiques, version du service worker.
// Usage : node scripts/build.mjs [--serve] [--inline]
//   --serve  : sert dist/ sur http://localhost:5173 et reconstruit à chaque modification
//   --inline : produit aussi dist/inline.html (une seule page autonome, pour un lien de test)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');
const inline = process.argv.includes('--inline');
const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

const options = {
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  outfile: path.join(dist, 'app.js'),
  minify: !serve,
  sourcemap: serve,
  define: { __VERSION__: JSON.stringify(version), __DEV__: JSON.stringify(serve) },
  logLevel: 'info',
};

function writeStatic() {
  copyDir(path.join(root, 'public'), dist);
  // Les fichiers portent la version dans leur adresse : une mise à jour ne lit jamais un vieux fichier en cache.
  // Garde-fou du démarrage : un petit script classique, en fichier séparé.
  fs.copyFileSync(path.join(root, 'src/boot-guard.js'), path.join(dist, 'boot.js'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('src="boot.js"', `src="boot.js?v=${version}"`)
    .replace('src="app.js"', `src="app.js?v=${version}"`)
    .replace('href="styles.css"', `href="styles.css?v=${version}"`);
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8').replaceAll('__VERSION__', version);
  fs.writeFileSync(path.join(dist, 'sw.js'), sw);
  fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify({ v: version }));
}

function writeInline() {
  // Fragment de page autonome (sans <html>/<head>/<body>) : pour un lien de test hébergé.
  const css = fs.readFileSync(path.join(root, 'src/ui/styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(dist, 'app.js'), 'utf8').replace(/<\/script/g, '<\\/script');
  const guard = fs.readFileSync(path.join(root, 'src/boot-guard.js'), 'utf8');
  const out = [
    '<title>Usine fractale</title>',
    `<script>\n${guard}\n</script>`,
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap">',
    `<style>\n${css}\n</style>`,
    '<div id="boot-static" style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;font:800 16px -apple-system,system-ui,sans-serif;color:#2E3A4B;text-align:center;padding:24px">Usine fractale<small id="boot-step" style="font-weight:700;font-size:12px;color:#4A5868">Chargement de la page… (étape 1)</small></div>',
    '<div id="game"></div>',
    '<div id="hud"></div>',
    `<script type="module">\n${js}\n</script>`,
  ].join('\n');
  fs.writeFileSync(path.join(dist, 'inline.html'), out);
  // Variante qui charge le jeu depuis un fichier à côté de la page (lien de test hébergé).
  const noscript = '<noscript><div style="position:fixed;inset:0;z-index:100;background:#DCEBE3;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:800 15px -apple-system,system-ui,sans-serif;color:#2E3A4B">JavaScript est désactivé pour cette page.</div></noscript>';
  fs.writeFileSync(path.join(dist, 'artifact.html'), out
    .replace(`<script>\n${guard}\n</script>`, `<script src="boot.js?v=${version}"></script>`)
    .replace(`<script type="module">\n${js}\n</script>`, `${noscript}\n<script type="module" src="app.js?v=${version}"></script>`));
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
writeStatic();
fs.copyFileSync(path.join(root, 'src/ui/styles.css'), path.join(dist, 'styles.css'));

if (serve) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'static', setup(b) { b.onEnd(() => { writeStatic(); fs.copyFileSync(path.join(root, 'src/ui/styles.css'), path.join(dist, 'styles.css')); }); } }],
  });
  await ctx.watch();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json' };
  http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dist, p);
    if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }).listen(5173, () => console.log('→ http://localhost:5173'));
} else {
  await esbuild.build(options);
  if (inline) writeInline();
  console.log(`build ${version} ok`);
}
