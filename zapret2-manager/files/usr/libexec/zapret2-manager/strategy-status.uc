'use strict';

// Active Strategy status is a read-only projection. Durable state contributes
// only selection identity; drift and availability are calculated from current
// observations and volatile Apply evidence.

import { strategy_selection_get, strategy_user_get_readonly,
 strategy_apply_uncertain_get, strategy_reconcile_get } from './strategy-state.uc';
import { strategy_catalog_get, strategy_catalog_status, catalog_entry_to_strategy } from './strategy-catalog.uc';

function object(value) { return type(value) == 'object' && value != null; }
function digest(value) { return type(value) == 'string' && match(value, /^[a-f0-9]{64}$/); }

function identity_from(selected, supplied) {
 if (object(supplied)) return {
  available: supplied.available !== false,
  name: type(supplied.name) == 'string' ? supplied.name : selected.id
 };
 if (!object(selected)) return { available: false, name: null };
 if (selected.origin == 'user') {
  let user = null;
  try { user = strategy_user_get_readonly({ id: selected.id }); } catch (e) { user = null; }
  return user && user.ok == true && object(user.strategy)
   ? { available: true, name: user.strategy.name || selected.id }
   : { available: false, name: null };
 }
 if (selected.origin == 'avatar_builtin') {
  let entry = null, strategy = null;
  try { entry = strategy_catalog_get(selected.id); strategy = catalog_entry_to_strategy(entry); } catch (e) { strategy = null; }
  return strategy != null ? { available: true, name: strategy.name || selected.id }
   : { available: false, name: null };
 }
 if (selected.origin == 'extension') return { available: true, name: selected.id };
 return { available: false, name: null };
}

function volatile_uncertain(value) {
 return object(value) && (value.uncertain != null || value.applyUncertain != null)
  ? (value.uncertain != null ? value.uncertain : value.applyUncertain) : null;
}

function public_fields(value) {
 return {
  id: value.id, name: value.name, origin: value.origin, revision: value.revision,
  digest: value.digest, candidateSha256: value.candidateSha256,
  match: value.match, drift: value.drift, availability: value.availability,
  uncertain: value.uncertain
 };
}

export const derive_strategy_status = function(selectedState, current, runtime, volatile) {
 selectedState = selectedState || {};
 current = current || {};
 runtime = runtime || {};
 volatile = volatile || {};
 let selected = selectedState.selected;
 let identity = identity_from(selected, selectedState.identity);
 let base = {
  id: selected && selected.id || null,
  name: selected ? (identity.name || selected.id) : null,
  origin: selected && selected.origin || null,
  revision: selected ? selected.revision : null,
  digest: selected ? (selectedState.digest || current.catalogDigest || null) : null,
  candidateSha256: selected ? selected.candidateSha256 : null,
  match: null, drift: selected == null ? false : null,
  availability: selected == null ? 'absent' : 'unavailable',
  uncertain: false,
  writes: [],
  persistedState: sprintf('%J', { revision: selectedState.revision || 0, selected: selected || null })
 };
 if (selected == null) return base;
 if (selectedState.readError || identity.available === false) return base;
 let uncertain = volatile_uncertain(volatile);
 if (uncertain != null) {
  base.availability = 'uncertain';
  base.uncertain = true;
  return base;
 }
 if (runtime.present !== true
  || !digest(current.configSha256) || !digest(current.candidateSha256)) return base;

 let reconciliation = object(volatile.reconciliation) ? volatile.reconciliation : null;
 let candidateMatch = runtime.rulesPresent === true
  && current.candidateSha256 == selected.candidateSha256;
 if (reconciliation != null) {
  candidateMatch = candidateMatch && reconciliation.id == selected.id
   && digest(reconciliation.hash) && reconciliation.hash == selected.candidateSha256;
  if (digest(reconciliation.configSha256))
   candidateMatch = candidateMatch && reconciliation.configSha256 == current.configSha256;
 }
 base.match = candidateMatch;
 base.drift = !candidateMatch;
 base.availability = candidateMatch ? 'available' : 'drifted';
 return base;
};

function read_volatile() {
 let uncertain = null, reconciliation = null, uncertainRead = false, reconciliationRead = false;
 try {
  let result = strategy_apply_uncertain_get();
  if (!result || result.ok !== true) uncertainRead = true;
  else uncertain = result.record;
 } catch (e) { uncertainRead = true; }
 try {
  let result = strategy_reconcile_get();
  if (!result || result.ok !== true) reconciliationRead = true;
  else reconciliation = result.record;
 } catch (e) { reconciliationRead = true; }
 return { uncertain: uncertainRead ? { unreadable: true } : uncertain,
  reconciliation: reconciliationRead ? { unreadable: true } : reconciliation };
}

export const collect_strategy_status = function(observations) {
 observations = observations || {};
 let selection = null;
 try { selection = strategy_selection_get(); } catch (e) { selection = null; }
 let selectedState = selection && selection.ok === true
  ? { revision: selection.revision, selected: selection.selected }
  : { revision: 0, selected: null, readError: true };
 let selected = selectedState.selected;
 if (selected != null) selectedState.identity = identity_from(selected);
 let catalog = null;
 try { catalog = strategy_catalog_status(); } catch (e) { catalog = null; }
 if (catalog && catalog.ok === true) selectedState.digest = catalog.digest;
 let drift = object(observations.drift) ? observations.drift : {};
 let currentSha = object(drift.currentSha256) ? drift.currentSha256 : {};
 let strategy = object(observations.strategy) ? observations.strategy : {};
 let derived = derive_strategy_status(selectedState, {
  configSha256: currentSha.config || null,
  candidateSha256: strategy.candidateSha256 || null,
  catalogDigest: catalog && catalog.ok === true ? catalog.digest : null
 }, observations.runtime, read_volatile());
 return public_fields(derived);
};
