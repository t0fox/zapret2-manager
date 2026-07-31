#!/bin/bash
set -e
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "head -15 /etc/zapret2-manager/service-dns-routing.conf 2>/dev/null || echo nofile"
echo "---"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "grep conf_file /etc/config/dhcp 2>/dev/null || echo noconf"
echo "---"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "/etc/init.d/dnsmasq status 2>&1"
echo "---"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "cat /tmp/zapret2-manager/service-dns-jobs/sdns-e2etest/job.json 2>/dev/null"