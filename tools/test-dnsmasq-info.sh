#!/bin/bash
set -e
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "
echo '=== dnsmasq version ==='
dnsmasq --version 2>&1 | head -3
echo ''
echo '=== dnsmasq help (server syntax) ==='
dnsmasq --help 2>&1 | grep -A2 'server='
echo ''
echo '=== current dhcp config ==='
uci show dhcp 2>&1 | grep -E 'dnsmasq|server|addnhosts' | head -20
echo ''
echo '=== effective dnsmasq config ==='
ls -la /var/etc/dnsmasq.conf* 2>&1
head -30 /var/etc/dnsmasq.conf* 2>&1 | grep -v '^$'
echo ''
echo '=== ubus dnsmasq status ==='
ubus call service list '{\"name\":\"dnsmasq\"}' 2>&1 | head -20
echo ''
echo '=== dnsmasq running? ==='
/etc/init.d/dnsmasq status 2>&1; echo rc=\$?
echo ''
echo '=== uci list server test ==='
uci add_list dhcp.@dnsmasq[0].server='//8.8.8.8' 2>&1 || echo 'add_list failed'
uci show dhcp.@dnsmasq[0].server 2>&1
uci revert dhcp 2>&1 || true
echo ''
echo '=== manual overrides file ==='
head -5 /etc/zapret2-manager/dns-overrides.hosts 2>&1
echo ''
echo '=== timeout available? ==='
which timeout 2>&1 || echo 'not found'
echo ''
echo "=== done ==="
" 2>&1