# Future Avatar parity queue

Queue only. No page below is implemented by the P01 task.

| Order | Page ID | Frozen donor evidence | Existing Z2M surface | Backend | Rule |
|---|---|---|---|---|---|
| P02 | control | `web/js/pages/control.js` (verify at pinned donor SHA) | `app.js` → `control` / `z2m-overview.js` | supported | Start only after P01 validator is COMPLETE; preserve service RPCs |
| P03 | strategies | `web/js/pages/strategies.js` | `z2m-strategy-page.js`, `z2m-strategy.js` | supported | Inventory and diff first; do not redesign strategy backend |
| P04 | services | `web/js/pages/services.js` | `z2m-domain-hub-page.js`, `z2m-services.js` | supported | Keep domain/service ownership and existing ACLs |
| P05 | dns | `web/js/pages/dns.js` | `z2m-dns-page.js`, `z2m-dns-model.js` | supported | DNS/TG v2 implementation is out of P01 scope |
| P06 | proxy | `web/js/pages/proxy.js` | `z2m-proxy-page.js`, `z2m-proxy.js` | supported | Telegram Proxy changes require a separate explicit task |

For each queued item, first create a pinned donor inventory and a manifest.
The queue does not imply that the donor has been verified at the listed path;
the pinned source must be checked before that page is selected.
