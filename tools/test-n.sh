#!/bin/sh
echo 'let x = "test\\nline"; print(x);' | ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ucode -p - 2>&1'
echo '---'
echo 'let x = '"'"'test\\nline'"'"'; print(x);' | ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ucode -p - 2>&1'
echo '---'
echo 'let x = "test\nline"; print(x);' | ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ucode -p - 2>&1'
echo '---'
echo "let x = 'test\\\\nline'; print(x);" | ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ucode -p - 2>&1'
