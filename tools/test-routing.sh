#!/bin/bash
set -e
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "
echo '=== dnsmasq --test ==='
dnsmasq --test 2>&1; echo rc=\$?
echo ''
echo '=== Test routing conf ==='
cat > /tmp/test-routing.conf << 'EOF'
# Managed by zapret2-manager r46.5
server=/google.com/8.8.8.8
server=/google.com/8.8.4.4
EOF
echo '=== Register in dnsmasq ==='
uci show dhcp.@dnsmasq[0].conf_file 2>&1
uci add_list dhcp.@dnsmasq[0].conf_file='/tmp/test-routing.conf'
uci commit dhcp
echo '=== After registration ==='
uci show dhcp.@dnsmasq[0].conf_file 2>&1
echo '=== Test config ==='
dnsmasq --test 2>&1; echo rc=\$?
echo '=== Restart ==='
/etc/init.d/dnsmasq restart; echo rc=\$?
sleep 2
echo '=== Test resolution ==='
nslookup google.com 8.8.8.8 2>&1 | head -5
echo '=== Cleanup ==='
uci del_list dhcp.@dnsmasq[0].conf_file='/tmp/test-routing.conf'
uci commit dhcp
/etc/init.d/dnsmasq restart
echo 'done'
" 2>&1