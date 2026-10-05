// Builds dist/ (main.js, styles.css, manifest.json) and installs it into the test vault.
// `node esbuild.config.mjs` watches; `node esbuild.config.mjs production` builds once, minified.
import esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

const prod = process.argv[2] === 'production'
const vaultPlugin = '../test-vault/.obsidian/plugins/mindmapmate'

const installToVault = {
  name: 'install-to-vault',
  setup(build) {
    build.onEnd(result => {
      if (result.errors.length) return
      cpSync('manifest.json', 'dist/manifest.json')
      mkdirSync(vaultPlugin, { recursive: true })
      cpSync('dist', vaultPlugin, { recursive: true })
    })
  },
}

const ctx = await esbuild.context({
  entryPoints: { main: 'src/main.ts', styles: 'src/styles.css' },
  outdir: 'dist',
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development') },
  minify: prod,
  sourcemap: prod ? false : 'inline',
  logLevel: 'info',
  plugins: [installToVault],
})

if (prod) {
  await ctx.rebuild()
  await ctx.dispose()
} else {
  await ctx.watch()
}
