// Fails the build if the bundle can reach the network or run dynamic code, the two things the
// Obsidian scorecard flagged in NextGen. URLs are allowed only as inert strings from known domains.
import { readFileSync } from 'node:fs'

const code = readFileSync('dist/main.js', 'utf8')
const banned = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bsendBeacon\b/, 'sendBeacon'],
  [/\brequestUrl\b/, 'Obsidian requestUrl'],
  [/(?<![.\w])eval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\bimportScripts\b/, 'importScripts'],
  [/createElement\(\s*["'`]script/i, 'script elements'],
  // The HTML export's page template holds its own <script> as text for the saved file; only DOM injection is banned.
  [/innerHTML\s*=\s*["'`]<script/i, 'script markup through innerHTML'],
]
// Error-message links in React and React Flow, and XML namespace strings. None are fetched.
// `${t}flow.dev` is React Flow's error link, built as reactflow.dev or svelteflow.dev.
// buymeacoffee.com: the settings screen's donation link, opened only by the user's click.
const allowedHosts = new Set(['react.dev', 'reactjs.org', 'reactflow.dev', '${t}flow.dev', 'www.w3.org', 'buymeacoffee.com'])

const problems = banned.filter(([re]) => re.test(code)).map(([, name]) => `uses ${name}`)
for (const [url, host] of code.matchAll(/https?:\/\/([^/?#\s"'`)<>\\]+)[^\s"'`)<>\\]*/g))
  if (!allowedHosts.has(host)) problems.push(`contains URL ${url}`)

const kb = (code.length / 1024).toFixed(0)
if (problems.length) {
  console.error(`scan-bundle: FAILED (${kb} KB)\n  ` + [...new Set(problems)].join('\n  '))
  process.exit(1)
}
console.log(`scan-bundle: clean, no network or dynamic-code calls (${kb} KB)`)
