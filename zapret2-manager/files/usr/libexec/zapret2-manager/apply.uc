'use strict';
// Compatibility facade. Zapret config/list writer implementation moved to zapret/apply.uc.
import * as impl from './zapret/apply.uc';
export const read_var = impl.read_var;
export const read_config_bytes = impl.read_config_bytes;
export const config_sha256 = impl.config_sha256;
export const do_set = impl.do_set;
export const do_restore = impl.do_restore;
export const set_var = impl.set_var;
export const set_var_cas = impl.set_var_cas;
export const restore_whole_file = impl.restore_whole_file;
export const read_list_file = impl.read_list_file;
export const write_list_file = impl.write_list_file;
