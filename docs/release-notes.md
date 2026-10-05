# MindmapMate release notes

Newest first. Only recent versions are listed here; earlier rounds are in the wiki's MindmapMate Milestones page.

## 1.0.1
- **Ready for the community directory:** the plugin id is now `mindmapmate` (was `flowmap`). To keep your settings, rename the vault folder `.obsidian/plugins/flowmap` to `mindmapmate` before installing. Board files are unchanged.
- **Hotkeys need setting again:** hotkeys you gave MindmapMate commands were saved under the old id. Set them again in Settings > Hotkeys (search "MindmapMate").
- **Settings show up in Obsidian's settings search:** the settings screen uses Obsidian's new settings layout (Obsidian 1.13 or newer).
- **Works in popout windows:** animations and the color picker no longer reach for the main window.
- **Theme-friendly styles:** no forced styles, so themes can restyle the board's knobs and lines.
- **Signed releases:** each GitHub release is built from the tagged source and carries a build attestation.

## 1.0.0
- **Renamed to MindmapMate**, with the real Buy Me a Coffee link in Settings.

## 0.8.6
- **Renamed to MindmapMate:** the plugin's name, settings title and About text now say MindmapMate. Saved settings carry over (the plugin id is unchanged).

## 0.8.5
- **Fix, color picker knobs:** Obsidian's own slider style pushed the picker's knobs up off the track (and thinned the track). The hue, saturation and lightness knobs now sit centred on their tracks, the same as in StyleMate v0.6.1. A new live check reads the knob's position from the screen pixels.

## 0.8.4
- **Coffee link made generic:** the button still shows, but it now points to the plain buymeacoffee.com site (no user). The real link gets set later in one place, `coffeeButton.ts`.
- **Tip line left-aligned:** "If you enjoy this plugin, please consider a small tip..." now sits flush left in the settings header (the coffee button stays right).

## 0.8.3
- **Level stepper reversed:** the up arrow now shows one more level (L1, L2, L3 ...) and the down arrow one fewer, down to L1. The number still opens the jump list.
- **Filter button removed:** the funnel is gone. The "7d" number under the day arrows is the way into the filter menu (hover says "Filter tasks"), and turns solid while any filter is on.

## 0.8.2
- **Filter button:** a new button in the right-hand stack opens a menu: Overdue, Due today, Due in the next N days, Blocked and Doing. Tick any; matching tasks stay bright and the rest fade. The menu stays open while you tick, and a click outside closes it and keeps the filter. Clear filters turns it off.
- **Day stepper:** the arrows and the "7d" number under the filter button widen or narrow "due in the next N days" without opening the menu.
- **Due date colors:** Preferences > Due date colors sets the chip colors for overdue, due today and later dates (the arrow puts back the theme's). Image and HTML exports use them too.
- **Short windows:** the right-hand buttons wrap into a second column instead of running off the bottom.

## 0.8.1
- **Show due today / due this week:** new board commands select the matching tasks and fit them in view; this week means today through the next 7 days. Done and dropped tasks never count.
- **Show blocked / Show doing:** the same for blocked and in-progress tasks.
- **Opens hidden tasks:** each opens any collapsed branch hiding a match (one undo step) and shows the count in a notice.
- **Preferences:** "Made with care" now sits right beside the coffee button.

## 0.7.24
- **Preferences intro (fix):** the tip stays flush right, as in your screenshot, at body-text size with a blank line above it. 0.7.23 had moved it to the left by mistake.

## 0.7.23
- **Eyedropper removed:** it crashed Obsidian (no permission to read the screen). In its place, a Reset button returns the color to what it was when the picker opened.
- **Color picker in Preferences:** click the swatch, pick a color, click anywhere else and the pop-up closes.
- **Progress count:** a node counts only its own children ("1/3"), not everything below; a node whose only child has no checkbox shows nothing.
- **Preferences intro:** the tip is body-text size with a blank line above it; "Made with care" sits left, the coffee button right.

## 0.7.22
- **Eyedropper:** the color picker (Preferences > Grid dots, and the board's custom color) has an eyedropper button beside the hex field: click it, then click any pixel on the screen.
- **Exact colors:** a typed or eyedropped color shows exactly as picked, not rounded through the sliders.

## 0.7.21
- Settings: one Open hotkeys button replaces the key list; color sliders close on a click off them and keep the color; tip line above "Made with care".
