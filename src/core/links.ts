// Wikilinks in node text (F10, D11): split for display, and retargeted when a note moves (D19). Pure.

// [[linkpath#subpath|alias]]. Obsidian forbids [ ] | # ^ in file names, so the parts can't contain them.
const WIKILINK = /\[\[([^[\]|#]*)(#[^[\]|]*)?(?:\|([^[\]]*))?\]\]/g

export type Wikilink = { linktext: string, label: string }
export type TextPart = string | Wikilink

/** Node text as plain runs and links. A link shows its alias, else its target as Obsidian does ("Note > Heading"). */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(WIKILINK)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const [, path, sub = '', alias] = m
    parts.push({ linktext: path + sub, label: alias?.trim() || (path + sub.replace(/^#/, path ? ' > ' : '')) })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/** The text as it reads on the node, for measuring. */
export const displayText = (text: string) => textParts(text).map(p => typeof p === 'string' ? p : p.label).join('')

/** Rewrites each wikilink's link path through `to` (undefined keeps it), keeping subpath and alias. */
export const mapWikilinks = (text: string, to: (linkpath: string) => string | undefined) =>
  text.replace(WIKILINK, (all, path: string, sub = '', alias?: string) => {
    const next = path && to(path)
    return next ? `[[${next}${sub}${alias !== undefined ? '|' + alias : ''}]]` : all
  })

/**
 * D19: where a link path pointed after `oldPath` (a note or a folder) moved to `newPath`, or undefined if it didn't
 * point there. Covers full paths, partial paths ending in the note, and paths inside a moved folder, with or without
 * ".md". Callers only ask about links that no longer resolve: a plain `[[Name]]` still finds a note moved to a new folder.
 */
export function movedTarget(linkpath: string, oldPath: string, newPath: string): string | undefined {
  for (const p of [linkpath, linkpath + '.md']) {
    if (p === oldPath || oldPath.endsWith('/' + p)) return newPath
    if (p.startsWith(oldPath + '/')) return newPath + p.slice(oldPath.length)
  }
}

/** A file name for a note made from node text (Promote to note): the first line as it reads, minus characters
 *  Obsidian refuses in names. */
export function noteName(text: string): string {
  const name = displayText(text.split('\n')[0]).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  return name.slice(0, 100).trim() || 'Untitled'
}
