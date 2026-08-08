'use strict';
// Compatibility facade. Safe profile apply implementation moved to zapret/profiles-apply.uc.
import * as impl from './zapret/profiles-apply.uc';
export const profiles_apply_preview = impl.profiles_apply_preview;
export const profiles_apply_candidate = impl.profiles_apply_candidate;
export const profiles_apply_run = impl.profiles_apply_run;
