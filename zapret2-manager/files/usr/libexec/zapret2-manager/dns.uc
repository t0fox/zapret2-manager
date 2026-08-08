'use strict';
// Compatibility facade. The implementation moved to dns/overrides.uc.
import * as impl from './dns/overrides.uc';
export const dns_get = impl.dns_get;
export const dns_set = impl.dns_set;
export const dns_validate = impl.dns_validate;
export const dns_apply_preview = impl.dns_apply_preview;
export const dns_apply_run = impl.dns_apply_run;
export const dns_rollback = impl.dns_rollback;
export const dns_check = impl.dns_check;
export const dns_restore_auto = impl.dns_restore_auto;
