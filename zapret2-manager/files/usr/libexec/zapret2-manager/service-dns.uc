'use strict';
// Compatibility facade. The implementation moved to dns/services.uc.
import * as impl from './dns/services.uc';
export const service_dns_providers = impl.service_dns_providers;
export const service_dns_status = impl.service_dns_status;
export const service_dns_preview = impl.service_dns_preview;
export const service_dns_check = impl.service_dns_check;
export const service_dns_set = impl.service_dns_set;
export const service_dns_apply_async = impl.service_dns_apply_async;
export const service_dns_apply_status = impl.service_dns_apply_status;
export const service_dns_apply = impl.service_dns_apply;
export const service_dns_rollback = impl.service_dns_rollback;
