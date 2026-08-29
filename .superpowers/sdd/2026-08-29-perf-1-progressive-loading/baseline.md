# PERF-1.2 baseline

## Capture boundary

The baseline was captured on the authenticated in-app LuCI browser against
`192.168.1.1` before the progressive loaders and final app lifecycle fix were
deployed. Cache was enabled for the original observation. Timings below are
observed browser checkpoints, not synthetic targets or claims about an isolated
RPC server.

## Dashboard cold load

- LuCI shell paint was observed at approximately 0.65 s.
- The first useful Dashboard content was observed at approximately 2.16 s.
- The Dashboard runtime cards rendered, but Telegram Proxy and the event tail
  stayed in loading states noticeably longer, in the observed run through the
  approximately 18 s checkpoint.
- The app shell and Dashboard both issued `status_fast` during the same initial
  navigation. The sequence also included heavyweight engine/maintenance,
  versions, resources, targeted strategy, preview, events, recommendations,
  Telegram product status, and an active proxy health read.

## Telegram Proxy cold navigation

The old module put approximately nine reads in one `Promise.allSettled()`:
capabilities, proxy status, config, health, events, catalog, product status,
versions, and operation status. The browser observed the cold page taking about
21.8 s in the slow run. Because the group was awaited as one promise, a slow
version/catalog or upstream health read kept the whole first page on its
skeleton.

The old normal path also included `proxy.health({})`. The backend contract
shows that this is an upstream-capable health path, so it could perform a real
network probe merely by opening the page.

## Router baseline limitation

No directly comparable five-sample baseline latency table was collected before
the patch. The after table therefore reports actual current router observations
and does not invent a percentage speedup. The causal improvement demonstrated
by source and browser evidence is removal of remote/optional reads from the
first usable render and bounded deferred concurrency.
