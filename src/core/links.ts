// Wikilinks and [text](url) links in node text (F10, D11): split for display, and retargeted when a note moves (D19). Pure.

// [[linkpath#subpath|alias]]. Obsidian forbids [ ] | # ^ in file names, so the parts can't contain them.
const WIKILINK = /\[\[([^[\]|#]*)(#[^[\]|]*)?(?:\|([^[\]]*))?\]\]/g

// [text](url): a web or mail address opens outside Obsidian; a bare path is a note, as in Markdown. Other schemes
// (javascript:, file:) are not links and stay plain text. A title after the url is not supported.
const MDLINK = /\[([^[\]]+)\]\(<?([^()\s<>]+)>?\)/
const TEXT_LINK = new RegExp(WIKILINK.source + '|' + MDLINK.source, 'g')
const OPEN_SCHEME = /^(https?|mailto|obsidian):/i

export type Wikilink = { linktext: string, label: string }
/** A [text](url) link to an address outside the vault. */
export type ExternalLink = { href: string, label: string }
export type TextPart = string | Wikilink | ExternalLink

/** Node text as plain runs and links. A link shows its alias, else its target as Obsidian does ("Note > Heading"). */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(TEXT_LINK)) {
    const [all, path, sub = '', alias, mdText, url] = m
    let part: Wikilink | ExternalLink | undefined
    if (mdText === undefined) part = { linktext: path + sub, label: alias?.trim() || (path + sub.replace(/^#/, path ? ' > ' : '')) }
    else if (OPEN_SCHEME.test(url)) part = { href: url, label: mdText.trim() || url }
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) part = { linktext: safeDecode(url), label: mdText.trim() || safeDecode(url) }
    if (!part) continue
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(part)
    last = m.index + all.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

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
