'use strict';
// Compatibility facade. Profile parser/list implementation moved to zapret/profiles.uc.
import * as impl from './zapret/profiles.uc';
export const profiles_list = impl.profiles_list;
export const z2m_tokenize = impl.z2m_tokenize;
export const z2m_parse = impl.z2m_parse;
export const z2m_validate = impl.z2m_validate;
export const z2m_fragment = impl.z2m_fragment;
