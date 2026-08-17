'use strict';

// Active Strategy status is a read-only projection. Durable state contributes
// only selection identity; drift and availability are calculated from current
// observations and volatile Apply evidence.

import { strategy_selection_get_readonly, strategy_user_get_readonly,
 strategy_apply_uncertain_get_readonly, strategy_reconcile_get_readonly } from './strategy-state.uc';
import { strategy_catalog_load, catalog_entry_to_strategy } from './strategy-catalog.uc';

function object(value) { return type(value) == 'object' && value != null; }
function digest(value) { return type(value) == 'string' && match(value, /^[a-f0-9]{64}$/); }

function identity_from(selected, supplied, catalog) {
 if (!object(selected)) return { available: false, name: null };
 if (selected.origin == 'user') {
  if (object(supplied)) return {
   available: supplied.available !== false && supplied.revision == selected.revision,
   revisionMismatch: supplied.revision != null && supplied.revision != selected.revision,
   name: type(supplied.name) == 'string' ? supplied.name : selected.id
  };
  let user = null;
  try { user = strategy_user_get_readonly({ id: selected.id }); } catch (e) { user = null; }
  return user && user.ok == true && object(user.strategy)
   ? { available: user.strategy.revision == selected.revision, revision: user.strategy.revision,
       revisionMismatch: user.strategy.revision != selected.revision,
       name: user.strategy.name || selected.id }
   : { available: false, name: null };
 }
 if (selected.origin == 'avatar_builtin') {
  if (object(supplied)) return {
   available: supplied.available !== false && (supplied.revision == null || supplied.revision == selected.revision),
   revisionMismatch: supplied.revision != null && supplied.revision != selected.revision,
   name: type(supplied.name) == 'string' ? supplied.name : selected.id
  };
  if (!object(catalog)) return { available: false, name: selected.id, catalogUnavailable: true };
  let entry = object(catalog.winners) ? catalog.winners[selected.id] : null;
  let strategy = null;
  try { strategy = catalog_entry_to_strategy(entry); } catch (e) { strategy = null; }
   return strategy != null ? { available: selected.revision == 0, revision: 0, revisionMismatch: selected.revision != 0, name: strategy.name || selected.id }
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
   configSha256: value.configSha256, appliedConfigSha256: value.appliedConfigSha256,
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
   configSha256: selected ? (current.configSha256 || null) : null,
   appliedConfigSha256: selected ? (current.appliedConfigSha256 || null) : null,
   match: null, drift: selected == null ? false : null,
  availability: selected == null ? 'absent' : 'unavailable',
  uncertain: false,
  writes: [],
  persistedState: sprintf('%J', { revision: selectedState.revision || 0, selected: selected || null })
 };
 if (selected == null) return base;
  if (selectedState.readError) return base;
  if (identity.revisionMismatch) {
   base.match = false;
   base.drift = true;
   base.availability = 'drifted';
   return base;
  }
  if (identity.available === false) return base;
 let uncertain = volatile_uncertain(volatile);
 if (uncertain != null) {
  base.availability = 'uncertain';
  base.uncertain = true;
  return base;
 }
 if (runtime.present !== true || !digest(current.configSha256)
  || !digest(current.appliedConfigSha256) || !digest(current.candidateSha256)) return base;
 if (current.configSha256 != current.appliedConfigSha256) {
  base.match = false;
  base.drift = true;
  base.availability = 'drifted';
  return base;
 }

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
  let result = strategy_apply_uncertain_get_readonly();
  if (!result || result.ok !== true) uncertainRead = true;
  else uncertain = result.record;
 } catch (e) { uncertainRead = true; }
 try {
  let result = strategy_reconcile_get_readonly();
  if (!result || result.ok !== true) reconciliationRead = true;
  else reconciliation = result.record;
 } catch (e) { reconciliationRead = true; }
 return { uncertain: uncertainRead ? { unreadable: true } : uncertain,
  reconciliation: reconciliationRead ? { unreadable: true } : reconciliation };
}

export const collect_strategy_status = function(observations, options) {
 observations = observations || {};
 options = options || {};
 let selection = null;
 try { selection = strategy_selection_get_readonly(); } catch (e) { selection = null; }
 let selectedState = selection && selection.ok === true
  ? { revision: selection.revision, selected: selection.selected }
  : { revision: 0, selected: null, readError: true };
 let catalog = null;
 if (options.fast !== true) {
  try {
   let loaded = strategy_catalog_load(getenv('Z2M_STRATEGY_CATALOG_ROOT') || '/usr/share/zapret2-manager/catalog/forgejo');
   catalog = loaded && loaded.ok === true ? loaded.catalog : null;
  } catch (e) { catalog = null; }
 }
 let selected = selectedState.selected;
 if (selected != null) selectedState.identity = identity_from(selected, null, catalog);
 if (catalog != null) selectedState.digest = catalog.aggregateDigest;
 let drift = object(observations.drift) ? observations.drift : {};
 let currentSha = object(drift.currentSha256) ? drift.currentSha256 : {};
 let appliedSha = object(drift.appliedSha256) ? drift.appliedSha256 : {};
 let strategy = object(observations.strategy) ? observations.strategy : {};
 let derived = derive_strategy_status(selectedState, {
  configSha256: currentSha.config || null,
  appliedConfigSha256: appliedSha.config || null,
  candidateSha256: strategy.candidateSha256 || null,
  catalogDigest: catalog ? catalog.aggregateDigest : null
 }, observations.runtime, read_volatile());
 return public_fields(derived);
};
