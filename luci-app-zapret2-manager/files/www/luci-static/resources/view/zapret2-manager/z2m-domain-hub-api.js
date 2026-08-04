'use strict';
'require rpc';
'require baseclass';

var get = rpc.declare({
  object: 'zapret2-manager-domain-hub',
  method: 'domain_hub_get',
  reject: true
});
var preview = rpc.declare({
  object: 'zapret2-manager-domain-hub',
  method: 'domain_hub_preview',
  params: ['edit'],
  reject: true
});
var apply = rpc.declare({
  object: 'zapret2-manager-domain-hub',
  method: 'domain_hub_apply',
  params: ['edit'],
  reject: true
});

return baseclass.extend({
  get: get,
  preview: preview,
  apply: apply
});
