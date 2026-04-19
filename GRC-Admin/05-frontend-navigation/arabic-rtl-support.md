# WathbahGRC Admin — Arabic / RTL Support
**Snapshot taken:** 2026-04-14
**Commit / branch:** a03a947 / db-scheme-changes
**Scope of this file:** i18n library, locale files, RTL support status.

## i18n Library

**None.** There is no i18n library (no `i18next`, `vue-i18n`, `svelte-i18n`, `react-intl`, or equivalent). All UI text is hardcoded in English in the HTML and JS files.

## Locale Files

**None.** No `.json`, `.yaml`, or `.properties` locale files exist anywhere in the repo.

## RTL Support

**Not present.** No `dir="rtl"` attributes, no RTL CSS classes, no `direction: rtl` styles found in the CSS files.

## Arabic Content

Arabic is present in the data layer, not the UI:
- `org_contexts.name_ar` — bilingual organization names
- AI-generated controls include `name_ar` and `description_ar` fields
- The `sendJSON()` helper explicitly handles Unicode/Arabic in JSON responses (`server.js:1105–1113`)

## Assessment

The UI is **English-only, LTR-only**. Adding Arabic UI and RTL support would require:
1. An i18n framework
2. Extracting all UI strings into locale files
3. CSS RTL adaptation (likely significant given the ~158KB `admin.css`)
4. Testing bidirectional text rendering in chat messages and forms
