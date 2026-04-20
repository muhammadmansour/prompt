# WathbahGRC Admin — Arabic / RTL Support
**Snapshot taken:** 2026-04-15
**Commit / branch:** dev-version @ 0b0e7a0
**Scope of this file:** Internationalization, locale files, and RTL support.

## i18n Library

None. No i18n library (`i18next`, `vue-i18n`, `svelte-i18n`, etc.) in dependencies. All UI strings are hardcoded English in HTML and JS.

## Locale Files

None. No `.json`, `.yaml`, or `.po` locale/translation files.

## HTML Language

- `<html lang="en">` — `admin.html:2`
- Document direction: LTR by default

## RTL for Arabic Content

RTL is applied **per-element** for Arabic content within an LTR shell:

- Workbench question rows: `<div class="wb-lang-ar" dir="rtl">` — `admin.js:8692`
- Evidence rows: same pattern — `admin.js:8805`
- Admin notes: same pattern — `admin.js:8903`
- Inline editor Arabic textarea: `dir="rtl"` — `admin.js:9084`
- Merge optimizer Arabic labels: `dir="rtl"` — `admin.js:4948,5776–5787`
- Audit log assessment display: `dir="rtl"` on Arabic content blocks

## Font

Cairo (Google Font) — supports Arabic — loaded in all HTML files: `admin.html:7–9`

## Date/Number Formatting

- `toLocaleDateString('en-US', ...)` — English date format throughout
- No Arabic date formatting found

## Assessment

**Partial RTL support.** Arabic text renders correctly within RTL blocks, but the entire UI shell (sidebar, headers, buttons, labels) is English-only LTR. There is no language switcher, no runtime locale toggle, and no Arabic UI translation. Mixed-direction support works for content display but not for navigation or chrome.
