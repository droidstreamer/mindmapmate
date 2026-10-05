import tseslint from 'typescript-eslint'

const nodeBuiltins = { group: ['node:*', 'fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'electron'], message: 'No Node.js or Electron APIs (D23: mobile must stay possible).' }

export default tseslint.config(
  ...tseslint.configs.recommended,
  { files: ['src/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [nodeBuiltins] }] } },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [nodeBuiltins, { group: ['react', 'react-dom', 'react-dom/*', '@xyflow/*', 'obsidian', '../ui/*', '../obsidian/*', '../../ui/*', '../../obsidian/*'], message: 'src/core is pure TypeScript: no React, React Flow or Obsidian imports.' }] }],
    },
  },
  { rules: { 'no-restricted-syntax': ['error', { selector: "MemberExpression[property.name='innerHTML']", message: 'No innerHTML: render text with createEl or React.' }] } },
)
