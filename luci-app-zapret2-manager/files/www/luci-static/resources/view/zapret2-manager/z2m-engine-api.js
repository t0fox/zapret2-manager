'use strict';
'require rpc';
'require baseclass';
'require view.zapret2-manager.z2m-api as Api';
var object='zapret2-manager-engine';
function read(method){return rpc.declare({object:object,method:method,reject:true});}
function edit(method){return rpc.declare({object:object,method:method,params:['edit'],reject:true});}
function invoke(call,value){return value==null?call():call(JSON.stringify(value));}
Api.engine={
 providers:function(){return invoke(read('engine_providers'));},
 status:function(){return invoke(read('engine_status'));},
 checkUpdates:function(value){return invoke(edit('engine_check_updates'),value);},
 install:function(value){return invoke(edit('engine_install'),value);},
 remove:function(value){return invoke(edit('engine_remove'),value);},
 operationStatus:function(value){return invoke(edit('engine_operation_status'),value||{});},
 operationCancel:function(value){return invoke(edit('engine_operation_cancel'),value);}
};
return Api;
