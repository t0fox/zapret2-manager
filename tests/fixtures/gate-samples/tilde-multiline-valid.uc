let command = "awk '$7 ~ /tcp/ && \
$5 ~ /say \"quoted\"/ { print \"https://example\" }'";
let inverse = ~mask;
