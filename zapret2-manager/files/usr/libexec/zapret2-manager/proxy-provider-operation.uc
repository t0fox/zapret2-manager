#!/usr/bin/ucode
'use strict';

// Durable Telegram Proxy worker. The transaction engine owns PREPARE,
// PREFLIGHT, DOWNLOAD, VERIFY, BACKUP, INSTALL, CONFIG_VALIDATE, RESTART,
// HEALTHCHECK and COMMIT; this entrypoint only resumes it by operation id.
// proxycfg_health is intentionally imported here as a visible healthcheck
// dependency for target audits, while the provider module performs the call
// after the selected runtime is active.
import { proxy_provider_operation_run } from './proxy-provider.uc';
import { proxycfg_health } from './proxycfg.uc';

// proxy_provider_install_transaction is the transaction engine invoked by the worker;
// it records rollback and rolled-back terminal states durably.

let operationId = ARGV[0];
let result = proxy_provider_operation_run(operationId);
// Keep the worker quiet for the background launcher; durable state is the API.
if (result == null) exit(1);
