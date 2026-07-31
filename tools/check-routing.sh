#!/bin/bash
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "cat /etc/zapret2-manager/service-dns-routing.conf | wc -l"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "head -15 /etc/zapret2-manager/service-dns-routing.conf"
