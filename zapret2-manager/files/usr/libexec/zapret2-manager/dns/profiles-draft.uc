'use strict';
// Transitional state bridge for DNS modules moved under dns/.
// State ownership remains in the existing profiles-draft implementation in
// this structural refactor; no state schema or write semantics change here.
import * as legacy from '../profiles-draft.uc';
export const load_state = legacy.load_state;
export const save_state = legacy.save_state;
