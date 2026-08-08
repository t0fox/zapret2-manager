'use strict';
// Compatibility facade. The implementation moved to dns/providers.uc.
import * as impl from './dns/providers.uc';
export const dnsprov_components = impl.dnsprov_components;
export const dnsprov_providers = impl.dnsprov_providers;
export const dnsprov_diagnose = impl.dnsprov_diagnose;
export const dns_select_provider = impl.dns_select_provider;
