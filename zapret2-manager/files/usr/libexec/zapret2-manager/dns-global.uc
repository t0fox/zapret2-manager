'use strict';
// Compatibility facade. The mixed legacy implementation moved to
// dns/legacy-global.uc and will be split only in a later semantic refactor.
import * as impl from './dns/legacy-global.uc';
export const dns_global_get = impl.dns_global_get;
export const dns_global_set = impl.dns_global_set;
export const dns_global_preview = impl.dns_global_preview;
export const dns_global_apply = impl.dns_global_apply;
export const dns_global_rollback = impl.dns_global_rollback;
