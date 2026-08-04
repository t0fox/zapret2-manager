'use strict';
'require rpc';
'require baseclass';

var snapshot = rpc.declare({
  object: 'zapret2-manager-monitor',
  method: 'monitor_snapshot',
  params: ['edit'],
  reject: true
});

return baseclass.extend({
  snapshot: snapshot
});
