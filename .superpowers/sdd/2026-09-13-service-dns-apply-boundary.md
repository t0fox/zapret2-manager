# Service DNS Apply boundary and progress evidence

Date: 2026-09-13
Scope: Service DNS UI representation, Apply verification, and page-local progress feedback.
Commit: `478e5ded` (`fix: verify service DNS applied state and progress`)

## Root causes fixed

- Backend `off`, empty string, and null are normalized to the UI default `''`.
- POST-Apply verification compares the normalized requested map with
  `service_dns_status.applied` and checks `appliedRevision` against the saved
  draft revision. Draft `selections` is no longer evidence of application.
- Service DNS Apply uses the long mutation transport because the backend waits
  for its bounded worker transaction. Backend error envelopes preserve the
  operation ID for the existing async recovery path.

## UI behavior

- Loaded service selections, `serviceBaseline`, and `selections` stay in UI
  representation; configured count excludes canonical `off`.
- Apply exposes the ordered phases: checking, validating, saving, applying,
  and verifying, followed by an explicit success or error state.
- The active phase has a small compositor-friendly pulse; reduced-motion mode
  disables transitions and animation. The status region uses `aria-live`.
- A successful verify commits the canonical applied UI map, copies it into the
  selections, and clears the local dirty state. A real applied mismatch keeps
  `E_VERIFY`.

## Local gates

- `node --check` for `z2m-api.js` and `z2m-dns.js` — passed.
- Focused UI/contract suite — 30/30 passed, 0 failed.
- `git diff --check` — passed.
- The broad UI/product process was not a green gate: it produced no output
  while running the known long Windows-dependent
  `avatar-strategy-apply.test.mjs` path and was stopped after the bounded wait.

## Router/browser evidence

- Deployed `z2m-api.js`, `z2m-dns.js`, and `z2m-ui.css` to the live router;
  local and remote SHA-256 hashes matched.
- Live provider Apply: Discord changed to Google Public DNS, showed the phase
  progress region, reached `Настройки DNS применены`, and cleared dirty state.
- Live reset Apply: Discord changed back to default, reached the same verified
  success state without `E_VERIFY`, and showed `30 сервисов · 0 настроено · 30
  по умолчанию`.
- After hard reload, the browser still showed Discord `value=""`, zero dirty
  changes, and zero configured services; browser warning/error logs were empty.
- `service_dns_status` returned `selections.discord=off`,
  `applied.discord=off`, equal revisions, and `pending=null`. Managed server
  and address entries were empty, and no Discord service-specific rule was
  present in the effective dnsmasq configuration.

Backend canonical representation remains `off`; it was not changed to `''`.
