#!/bin/sh
SID=$(ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ubus call session create '\''{"username":"root","password":"","timeout":600}'\'' 2>/dev/null' 2>/dev/null | sed -n 's/.*"ubus_rpc_session":"\([^"]*\)".*/\1/p')
echo "SESSION: ${SID:-FAILED}"
if [ -n "$SID" ]; then
  for path in dns service-dns overview strategies blockcheck catalog orchestra lists monitor proxy maintenance; do
    url="http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager/$path"
    code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 --cookie "sysauth=$SID" "$url" 2>/dev/null)
    echo "  $code $path"
  done
fi
