# TabUnhoarder

A Firefox extension that helps you clean up excessive open tabs using URL pattern matching. Define which tabs to keep and which to remove, preview matches before closing, and stay in control of your browser tabs.

## Features

- **Keep & Remove Lists** — Define URL patterns for tabs you want to protect or close, one per line
- **Simple & Regex Matching** — Use plain URL prefixes or full regular expressions
- **Review Before Close** — Preview matching tabs and deselect any you want to keep
- **Window Scope** — Operate on all windows or limit to the current one
- **Safety First** — Never closes pinned tabs, the active tab, or the last tab in a window

## Manual Installation

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select the `manifest.json` file from this project

## Usage

1. Click the TabUnhoarder icon in the toolbar
2. Enter URL patterns in the **Keep** and **Remove** fields (one per line)
3. Toggle **Regex** if you need regular expression matching
4. Click **Find Tabs** to scan for matches
5. Review the matched tabs and deselect any you want to keep
6. Click **Close Selected** to remove the checked tabs

### Pattern Examples

**Simple (prefix matching):**

```
https://mail.google.com
https://docs.google.com
```

**Regex:**

```
(github|gitlab)\.com/.*\/(issues|pull)
reddit\.com/r/
```

Lines starting with `#` are treated as comments and ignored.

## Permissions

- **tabs** — Read tab URLs/titles and close tabs
- **storage** — Persist your settings locally

No data is collected or sent externally. All settings are stored in your browser's local storage.

## Requirements

- Firefox 140.0 or later
- Manifest V3
