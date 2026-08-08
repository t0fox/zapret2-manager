'use strict';
// Compatibility facade. Draft profile/state implementation moved to zapret/profiles-draft.uc.
import * as impl from './zapret/profiles-draft.uc';
export const load_state = impl.load_state;
export const save_state = impl.save_state;
export const restore_state_raw = impl.restore_state_raw;
export const restore_drafts = impl.restore_drafts;
export const profiles_create = impl.profiles_create;
export const profiles_update = impl.profiles_update;
export const profiles_clone = impl.profiles_clone;
export const profiles_delete = impl.profiles_delete;
export const profiles_import_applied = impl.profiles_import_applied;
export const profiles_validate = impl.profiles_validate;
export const draft_block = impl.draft_block;
