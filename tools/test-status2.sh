#!/bin/bash
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-cli.uc status 2>&1" | head -c 500
