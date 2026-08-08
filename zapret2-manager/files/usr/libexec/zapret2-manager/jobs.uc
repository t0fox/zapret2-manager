'use strict';
// Compatibility facade for the existing jobs + BlockCheck implementation.
import * as impl from './jobs/legacy.uc';
export const job_list = impl.job_list;
export const job_get = impl.job_get;
export const blockcheck_start = impl.blockcheck_start;
export const blockcheck_cancel = impl.blockcheck_cancel;
export const blockcheck_status = impl.blockcheck_status;
export const health_matrix_start = impl.health_matrix_start;
export const health_matrix_get = impl.health_matrix_get;
export const hm_cancel = impl.hm_cancel;
export const mark_running = impl.mark_running;
export const mark_child = impl.mark_child;
export const mark_finished = impl.mark_finished;
export const mark_cancelled = impl.mark_cancelled;
export const mark_failed = impl.mark_failed;
