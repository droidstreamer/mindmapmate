// Copies dist/ to ../Code/MindmapMate_v<version>/. Never overwrites: bump manifest.json's version first.
import { cpSync, existsSync, readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'))
const target = `../Code/MindmapMate_v${version}`
if (existsSync(target)) {
  console.error(`ship: ${target} already exists. Bump the version in manifest.json and package.json.`)
  process.exit(1)
}
cpSync('dist', target, { recursive: true })
cpSync('docs/release-notes.md', `${target}/release-notes.md`) // every build folder carries its notes
console.log(`ship: ${target}/ (install by copying it to <vault>/.obsidian/plugins/mindmapmate/)`)
