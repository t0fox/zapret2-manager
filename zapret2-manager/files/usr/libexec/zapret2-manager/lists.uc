'use strict';
// Compatibility facade. Zapret host/list implementation moved to zapret/lists.uc.
import * as impl from './zapret/lists.uc';
export const lists_get = impl.lists_get;
export const validate_edit = impl.validate_edit;
export const lists_set = impl.lists_set;
export const lists_check_domain = impl.lists_check_domain;
