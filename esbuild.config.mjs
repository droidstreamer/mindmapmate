// Builds dist/ (main.js, styles.css, manifest.json) and installs it into the test vault.
// `node esbuild.config.mjs` watches; `node esbuild.config.mjs production` builds once, minified.
import esbuild from 'esbuild'
import { cpSync, mkdirSync, readFileSync } from 'node:fs'

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

// React DOM can add <script> tags to the page (for <script async src> in components and ReactDOM.preinit).
// MindmapMate uses neither, so those calls become a throw: the bundle cannot create a script element at all.
const noScripts = {
  name: 'no-script-elements',
  setup(build) {
    build.onLoad({ filter: /react-dom[\\/]cjs[\\/]react-dom-client\.(production|development)\.js$/ }, args => ({
      contents: readFileSync(args.path, 'utf8')
        .replace(/\b[\w$]+\.createElement\("script"\)/g, '(() => { throw new Error("MindmapMate never adds script elements") })()')
        // A <script> rendered by a component is built through innerHTML; MindmapMate renders none.
        .replace(/\b[\w$]+\.innerHTML = "<script>\\x3c\/script>"/g, '(() => { throw new Error("MindmapMate never adds script elements") })()'),
      loader: 'js',
    }))
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
  plugins: [noScripts, installToVault],
})

if (prod) {
  await ctx.rebuild()
  await ctx.dispose()
} else {
  await ctx.watch()
}
