const build = await Bun.build({
  entrypoints: ['src/main.js'],
  outdir: 'dist',
  naming: 'app.js',
  minify: true,
  target: 'browser',
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}

const js = await Bun.file('dist/app.js').text();
const css = await Bun.file('src/style.css').text();
let html = await Bun.file('src/index.template.html').text();
html = html.replace('/*__CSS__*/', () => css);
html = html.replace('/*__JS__*/', () => js);
await Bun.write('dist/index.html', html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`dist/index.html  ${kb} KB`);
