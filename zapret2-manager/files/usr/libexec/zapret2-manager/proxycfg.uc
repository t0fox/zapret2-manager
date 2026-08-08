'use strict';
// Compatibility facade. The functional Telegram proxy implementation moved to
// telegram/proxycfg.uc. Public callers keep the established root module path.
import * as impl from './telegram/proxycfg.uc';
export const proxycfg_get = impl.proxycfg_get;
export const proxycfg_validate = impl.proxycfg_validate;
export const proxycfg_preview = impl.proxycfg_preview;
export const proxycfg_apply = impl.proxycfg_apply;
export const proxycfg_start = impl.proxycfg_start;
export const proxycfg_stop = impl.proxycfg_stop;
export const proxycfg_restart = impl.proxycfg_restart;
export const proxycfg_autostart = impl.proxycfg_autostart;
export const proxycfg_secret_rotate = impl.proxycfg_secret_rotate;
export const proxycfg_logs_tail = impl.proxycfg_logs_tail;
export const proxycfg_health = impl.proxycfg_health;
export const proxycfg_link_info = impl.proxycfg_link_info;
export const proxycfg_quick_install = impl.proxycfg_quick_install;
