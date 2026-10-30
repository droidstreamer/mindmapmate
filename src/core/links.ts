// Wikilinks, [text](url) links and #tags in node text (F10, D11, R29): split for display, and retargeted when a note moves (D19). Pure.

// [[linkpath#subpath|alias]]. Obsidian forbids [ ] | # ^ in file names, so the parts can't contain them.
const WIKILINK = /\[\[([^[\]|#]*)(#[^[\]|]*)?(?:\|([^[\]]*))?\]\]/g

// [text](url): only web and mail addresses are links. Anything else (javascript:, file:, obsidian:, a bare path, a url with
// parentheses or spaces) fails the match and stays plain text. A title after the url is not supported.
const MDLINK = /\[([^[\]]+)\]\(((?:https?|mailto):[^()\s<>]+)\)/
// #tag, as Obsidian reads it: starts the text or follows whitespace, holds letters, digits, _ - / with a non-digit.
const TAG = /(?<=^|\s)#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])[\p{L}\p{N}_/-]+/u
// One pass, so a '#' inside a wikilink or a link address is never read as a tag (the earlier alternative starts first).
const TEXT_PARTS = new RegExp(`${WIKILINK.source}|${MDLINK.source}|${TAG.source}`, 'giu')

export type Wikilink = { linktext: string, label: string }
/** A [text](url) link to a web or mail address. */
export type ExternalLink = { href: string, label: string }
/** A #tag, drawn as a pill. `label` includes the "#". */
export type Tag = { tag: string, label: string }
export type TextPart = string | Wikilink | ExternalLink | Tag

/** Node text as plain runs, links and tags. A wikilink shows its alias, else its target as Obsidian does ("Note > Heading"). */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(TEXT_PARTS)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const [all, path, sub = '', alias, mdText, href] = m
    if (href !== undefined) parts.push({ href, label: mdText.trim() || href })
    else if (all.startsWith('#')) parts.push({ tag: all.slice(1), label: all })
    else parts.push({ linktext: path + sub, label: alias?.trim() || (path + sub.replace(/^#/, path ? ' > ' : '')) })
    last = m.index + all.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/** Whether the text has anything drawn differently from how it is typed (a link or a tag). Cheap checks first. */
export const hasMarkup = (text: string) =>
  (text.includes('[[') || text.includes('](') || text.includes('#')) && textParts(text).some(p => typeof p !== 'string')

/** Whether the text has a #tag: a pill has padding and a smaller font, so such a node can't be measured as plain text. */
export const hasTag = (text: string) => text.includes('#') && textParts(text).some(p => typeof p !== 'string' && 'tag' in p)

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
