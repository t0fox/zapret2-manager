# Telegram Proxy FullHD design review

Date: 2026-08-21
Browser: Codex in-app Browser
Viewport: `1920x1080`
Reference: live `Обход DPI → Стратегии → Выученные стратегии (autocircular)`

## Findings

1. Telegram used a custom pill tab control while Strategies used the shared underline tabs.
2. Telegram overrode the shared rhythm with `11–12px` labels, `7–10px` row padding, and compact provider copy, so text looked compressed.
3. The status heading inherited an incorrect `36px` line-height for an `18px` heading.
4. The selected provider and danger area used decorative gradients/rails that did not belong to the reference card language.

## Applied fixes

- Reused the shared underline tabs and panel header/body rhythm.
- Raised proxy copy to the shared readable scale: `13px` body text with `20–21px` line-height, `18px` panel padding, and larger row/list gaps.
- Set explicit status heading typography to `20px / 25px` and removed the inherited stretched line-height.
- Made the selected provider use the same restrained green inset marker as the active strategy card.
- Removed the decorative danger rail/gradient; destructive emphasis remains on the destructive controls.
- Kept the overflow action as a normal `Ещё` button so it does not collapse into an orphaned glyph.

## Verification

- Local JS syntax checks passed for the three changed view modules.
- Focused Telegram/DNS UI tests passed: `14/14` in the final command; the separate dashboard parity command retains one unrelated pre-existing ACL expectation failure.
- Runtime CSS was transferred with `scp -O`; local and router SHA-256 both equal `1038e8725c829bd49e1cd8c1a867dee1402d038df228c0dfdea80b7f103420bb`.
- Live FullHD browser check passed for Telegram overview, Component, Strategies comparison, and the main dashboard Telegram status card.
