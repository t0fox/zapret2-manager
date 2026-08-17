# Native exact-target fixtures

The `*-exact-target-evidence.txt` and matching `.tap` files are immutable test
fixtures for the native helper verification tests. Their recorded Linux build
paths and target commands are evidence data, not product configuration, runtime
inputs, or deployment instructions. The tests hash-bind these files, so they
remain tracked and are intentionally excluded from runtime machine-path gates.
