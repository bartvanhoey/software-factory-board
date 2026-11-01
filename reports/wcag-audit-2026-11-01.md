# WCAG AA Accessibility Report
**Report:** WCAG AA Accessibility Audit

**Project:** software-factory-board (`web/`) | **Framework:** Next.js 16 (App Router) | **Tailwind:** yes (v4, CSS tokens) | **Date:** 2026-11-01

**Scope:** the redesigned web app: TopBar, NavLink, Dropdown, globals.css tokens, and the pages and components that use them (35 `.tsx` files under `web/src`). Audited from the working tree. The redesign files are identical to `main` (`52018d3` and later); the checkout was on a different branch when run, with unrelated uncommitted edits in `CreateIssueForm.tsx` that were not assessed.

## Summary

| Severity | Count |
|---|---|
| Critical (Level A FAIL) | 1 |
| High (Level AA FAIL) | 2 |
| Warning | 5 |
| Carried open from previous audit | 0 (first audit) |
| Resolved since last audit | 0 |

## Criteria Results

| Criterion | Description | Result | Notes |
|---|---|---|---|
| 1.1.1 | Non-text Content | PASS | No `<img>`. Icon-only buttons (theme toggle, account menu) have `aria-label`; SVGs are `aria-hidden`. |
| 1.3.1 | Info and Relationships | PASS | All inputs have `<label htmlFor>` or wrapping labels; tables use `scope` and `<caption>`. |
| 1.3.3 | Sensory Characteristics | PASS | No colour/shape-only instructions found. |
| 1.4.1 | Use of Color | WARN | Selected filter chip is shown by colour only (see W2). Status badges all carry text. |
| 1.4.3 | Contrast (Minimum) | **FAIL** | Token pairs pass (measured, 4.68 to 11.6). Chip count text with `opacity-70` fails (H1). |
| 1.4.4 | Resize Text | PASS | No px font sizes. |
| 1.4.11 | Non-text Contrast | **FAIL** | Input and select borders are about 1.5:1 (H2). |
| 2.1.1 | Keyboard | PASS | Only native buttons/links/summary carry handlers. |
| 2.1.2 | No Keyboard Trap | PASS | Dropdown closes on Escape and returns focus to its trigger. |
| 2.4.1 | Bypass Blocks | **FAIL** | No skip link before the sticky TopBar (C1). |
| 2.4.2 | Page Titled | WARN | Home and project pages inherit the generic layout title (W1). |
| 2.4.3 | Focus Order | PASS | Only `tabIndex={-1}` for programmatic focus. |
| 2.4.4 | Link Purpose | PASS | |
| 2.4.7 | Focus Visible | PASS | Global `:focus-visible` outline in accent; no `outline-none` anywhere. |
| 2.4.11 | Focus Not Obscured | WARN | Sticky TopBar, no `scroll-padding-top` (W3). |
| 2.5.7 | Dragging Movements | PASS | No drag interactions. |
| 2.5.8 | Target Size (Minimum) | PASS | Icon buttons 36px (40px on touch); native checkboxes sit inside labels. |
| 3.1.1 | Language of Page | PASS | `<html lang="en">`. |
| 3.2.2 | On Input | PASS | No change handler navigates. |
| 3.2.6 | Consistent Help | PASS | No help mechanism. |
| 3.3.1 | Error Identification | WARN | Auth form errors not linked to fields (W4). |
| 3.3.2 | Labels or Instructions | PASS | |
| 3.3.7 | Redundant Entry | PASS | No multi-step forms. |
| 3.3.8 | Accessible Authentication | PASS | Login uses `current-password` and `username`; no CAPTCHA; `autocomplete="off"` only on non-credential project fields. |
| 4.1.2 | Name, Role, Value | PASS | Dropdown is native `<details>/<summary>`; NavLink sets `aria-current="page"`. |
| 4.1.3 | Status Messages | PASS | Alerts use `role="alert"` or `role="status"`. |

## Findings

### Critical (Level A failures)
- `web/src/app/layout.tsx:24` — 2.4.1 Bypass Blocks — No skip-to-content link before `<TopBar />`. Fix: add a visually hidden, focus-visible "Skip to content" link as the first child of `<body>` and give the content wrapper `id="main"` (pages already render their own `<main>`, so target that or the wrapper).

### High (Level AA failures)
- `web/src/components/ProjectChips.tsx:40` and `:42` — 1.4.3 Contrast — "N open" and "disabled" use `opacity-70` on text. Measured 2.89:1 on an unselected chip in light mode, 3.88:1 in dark, 4.14:1 on a selected project chip in light mode (4.5:1 needed at this size). Fix: drop the opacity and use `text-muted` (4.68 to 5.2:1) or a full-strength colour.
- `web/src/app/globals.css:15` (`--line-strong`, used by `.input` at `:120`) — 1.4.11 Non-text Contrast — Input and select borders measure 1.52:1 against white (1.53:1 in dark). The field boundary must reach 3:1. Fix: add a dedicated `--field-border` around `#8b8b9a` in light and `#6b6b80` in dark and use it for `.input` only.

### Warnings
- `web/src/app/page.tsx`, `web/src/app/projects/[name]/page.tsx` — 2.4.2 Page Titled (W1) — Both inherit "Software Factory Board" from the layout, so a titled page exists but is not descriptive. Fix: export `metadata` (for the project page, `generateMetadata` with the project name).
- `web/src/components/ProjectChips.tsx:15,31` — 1.4.1 Use of Color (W2) — Selected chip state is conveyed by colour only (`aria-current` helps screen readers). Fix: add a check mark icon or a heavier border to the selected chip.
- `web/src/components/TopBar.tsx:30` — 2.4.11 Focus Not Obscured (W3) — Sticky 56px header with no scroll offset, so focused fields can slide beneath it. Fix: `html { scroll-padding-top: 4.5rem; }` in `globals.css`.
- `web/src/components/auth/AuthForm.tsx:43`, `web/src/components/auth/CodeForm.tsx:60` — 3.3.1 Error Identification (W4) — Error banner is `role="alert"` but not tied to the fields via `aria-describedby` or `aria-invalid` (`ProjectForm` does this correctly). Fix: give the banner an id and set `aria-describedby` and `aria-invalid` on the inputs when `state.error` is set.
- `web/src/components/ProjectChips.tsx:36` — 1.4.3 (W5) — The whole "disabled" chip is `opacity-60`. It is still a working link, so the inactive-component exemption may not apply. Fix: use a muted colour instead of whole-element opacity, and keep the "disabled" text at full contrast.

## Carried Findings

| Finding | Status |
|---|---|
| None. This is the first audit. | n/a |

## Recommendations

1. Add the skip link (C1). It is the only Level A failure and a few lines of work.
2. Fix the chip count contrast (H1) and the input border contrast (H2). Both come from the redesign tokens, and H2 also existed before it (the old `zinc-300` border was about 1.5:1).
3. Add `scroll-padding-top` for the sticky header (W3) and per-page titles (W1).
4. Link auth form errors to their fields (W4) and add a non-colour cue to the selected chip (W2).

## Caveats

- WCAG version checked against: 2.2 Level AA (confirmed current via WebSearch on 2026-11-01; WCAG 3.0 is still a draft).
- Framework: Next.js 16 App Router. Tailwind CSS: yes (v4, colours as CSS variables in `globals.css`).
- Contrast was computed from the token hex values for both themes, not eyeballed. Not computed: the dark-mode tints of the eight project badge colours (`/15` alpha on a dark surface) and text over the `backdrop-blur` TopBar. Measure these in a browser.
- Screen reader behaviour, zoom/reflow at 400%, and the real keyboard tab order were not tested. Manual testing is recommended.
- Pages were checked statically, by grep, plus the earlier visual pass; no automated axe run.

## Resolution (2026-11-01)

All findings above were fixed in the working tree and checked in the browser, except where noted. Not yet committed.

- ✅ Fixed — C1 (2.4.1): skip link in `layout.tsx`, target `#main`.
- ✅ Fixed — H1 (1.4.3): `opacity-70` removed from chip counts in `ProjectChips.tsx`.
- ✅ Fixed — H2 (1.4.11): `--field-border` token for `.input` in `globals.css`; light border measured 3.36:1 against white.
- ✅ Fixed — W1 (2.4.2): `metadata` on the board page, `generateMetadata` on the project page.
- ✅ Fixed — W2 (1.4.1): a tick on the selected chip.
- ✅ Fixed — W3 (2.4.11): `scroll-padding-top: 4.5rem` on `html` (computed 72px).
- ✅ Fixed — W4 (3.3.1): `AuthForm` and `CodeForm` set `aria-invalid` and `aria-describedby` to the error banner. Checked on a failed login. `CodeForm` was covered by typecheck and tests only.
- ✅ Fixed — W5 (1.4.3): the disabled chip uses a dashed border instead of `opacity-60`.
