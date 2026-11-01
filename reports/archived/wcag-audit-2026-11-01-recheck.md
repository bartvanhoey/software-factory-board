# WCAG AA Accessibility Report
**Report:** WCAG AA Accessibility Audit (re-check after fixes)

**Project:** software-factory-board (`web/`) | **Framework:** Next.js 16 (App Router) | **Tailwind:** yes (v4, CSS tokens) | **Date:** 2026-11-01

**Scope:** the web app at `fix/wcag-aa-accessibility` (commit `b22f2ec`, PR #57), 35 `.tsx` files under `web/src`, including the issue-creation UI (`app/issues/new/page.tsx`, `CreateIssueForm.tsx`) that arrived from the other session after the first audit. The working tree also holds an uncommitted `AuthCard.tsx` height tweak that is not part of the branch; it was not assessed as a finding.

## Summary

| Severity | Count |
|---|---|
| Critical (Level A FAIL) | 0 |
| High (Level AA FAIL) | 0 |
| Warning | 1 |
| Carried open from previous audit | 0 |
| Resolved since last audit | 8 |

## Criteria Results

| Criterion | Description | Result | Notes |
|---|---|---|---|
| 1.1.1 | Non-text Content | PASS | No `<img>`; icon-only controls have `aria-label`, SVGs are `aria-hidden`. |
| 1.3.1 | Info and Relationships | PASS | All inputs, including the issue form, sit in labels or use `htmlFor`. |
| 1.3.3 | Sensory Characteristics | PASS | |
| 1.4.1 | Use of Color | PASS | Selected chip now has a tick; status badges carry text. |
| 1.4.3 | Contrast (Minimum) | PASS | No `opacity-*` on text left; token pairs measured 4.68 to 11.6:1 in the first audit and unchanged. |
| 1.4.4 | Resize Text | PASS | |
| 1.4.11 | Non-text Contrast | PASS | `--field-border` measures 3.36:1 (light) and 3.53:1 (dark). |
| 2.1.1 | Keyboard | PASS | |
| 2.1.2 | No Keyboard Trap | PASS | Dropdown closes on Escape. |
| 2.4.1 | Bypass Blocks | PASS | Skip link to `#main` in `layout.tsx`. |
| 2.4.2 | Page Titled | PASS | Every page exports `metadata` or `generateMetadata`. |
| 2.4.3 | Focus Order | PASS | Only `tabIndex={-1}`. |
| 2.4.4 | Link Purpose | PASS | |
| 2.4.7 | Focus Visible | PASS | Only `outline-none` is on the non-interactive `#main` skip target. |
| 2.4.11 | Focus Not Obscured | PASS | `scroll-padding-top: 4.5rem`. |
| 2.5.7 | Dragging Movements | PASS | |
| 2.5.8 | Target Size | PASS | |
| 3.1.1 | Language of Page | PASS | |
| 3.2.2 | On Input | PASS | |
| 3.2.6 | Consistent Help | PASS | |
| 3.3.1 | Error Identification | WARN | Auth forms fixed; the new issue form's error banner is not linked to fields (W6). |
| 3.3.2 | Labels or Instructions | PASS | |
| 3.3.7 | Redundant Entry | PASS | |
| 3.3.8 | Accessible Authentication | PASS | |
| 4.1.2 | Name, Role, Value | PASS | |
| 4.1.3 | Status Messages | PASS | |

## Findings

### Critical (Level A failures)
None.

### High (Level AA failures)
None.

### Warnings
- `web/src/components/CreateIssueForm.tsx:40` — 3.3.1 Error Identification (W6) — `state.error` renders in a `role="alert"` banner but the Project, Title and Description fields are not marked `aria-invalid` and do not point at it with `aria-describedby`. Same pattern as the fixed auth forms. Fix: give the banner an id and set `aria-invalid` and `aria-describedby` on the fields when `state.error` is set. The server action returns one message, not per-field errors, so the same approach as `AuthForm` applies. ✅ Fixed 2026-11-01

## Carried Findings

| Finding | Status |
|---|---|
| C1 (2.4.1) skip link | RESOLVED: `layout.tsx:25`, `#main` target at `:32` |
| H1 (1.4.3) chip count opacity | RESOLVED: no `opacity-*` classes remain in any `.tsx` |
| H2 (1.4.11) input border | RESOLVED: `--field-border` in `globals.css`, `.input` uses it |
| W1 (2.4.2) page titles | RESOLVED: no page lacks `metadata` or `generateMetadata` |
| W2 (1.4.1) selected chip | RESOLVED: tick on selected chips (`ProjectChips.tsx`) |
| W3 (2.4.11) sticky header | RESOLVED: `scroll-padding-top` in `globals.css` |
| W4 (3.3.1) auth errors | RESOLVED: `aria-invalid` and `aria-describedby` in `AuthForm` and `CodeForm` |
| W5 (1.4.3) disabled chip | RESOLVED: dashed border, no opacity |

The first report (`reports/wcag-audit-2026-11-01.md`) has every finding annotated as fixed and can move to `reports/archived/`. It was left in place because it is part of PR #57.

## Recommendations

1. Link the issue form's error banner to its fields (W6), the only open item.
2. After PR #57 merges, move `reports/wcag-audit-2026-11-01.md` to `reports/archived/`.
3. Consider adding tests for the aria attributes and skip link so they cannot regress.

## Caveats

- WCAG version checked against: 2.2 Level AA (confirmed current via WebSearch earlier in this session on 2026-11-01; not repeated).
- Framework: Next.js 16 App Router. Tailwind CSS: yes (v4).
- This re-check was static (grep and code reading), plus the browser checks from the fix session. It did not re-render pages or re-measure contrast; the new token values were measured in the first audit and are unchanged.
- Not assessed: dark-mode tints of the eight project badge colours, text over the blurred TopBar, screen reader behaviour, 400% zoom, the issue-creation page in a browser.
- Manual verification recommended: screen reader testing and real keyboard tab order.
