let command = "awk '$7 ~ /tcp/ && $5 ~ /say \"quoted\"/ { print \"https://example\" }'";
let note = 'awk \'quoted\' // $7 ~ /udp/';
