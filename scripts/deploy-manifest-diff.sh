#!/usr/bin/env bash
# Generate deploy manifest: rows repo_path|target_path|mode for every tracked
# runtime file whose hash differs from the router (or is missing there).
set -eu
cd /mnt/c/Users/Kirill/zapret2-manager
TMP=.deploy-tmp
mkdir -p "$TMP"

MAP_OUT=$TMP/z2m-map.txt
: > "$MAP_OUT"

git ls-files -z | while IFS= read -r -d '' f; do
  case "$f" in
    zapret2-manager/files/usr/libexec/zapret2-manager/*) t="/usr/libexec/zapret2-manager/${f#zapret2-manager/files/usr/libexec/zapret2-manager/}" ;;
    zapret2-manager/files/usr/share/zapret2-manager/*)   t="/usr/share/zapret2-manager/${f#zapret2-manager/files/usr/share/zapret2-manager/}" ;;
    zapret2-manager/files/etc/init.d/*)                  t="/etc/init.d/${f#zapret2-manager/files/etc/init.d/}" ;;
    zapret2-manager/files/etc/config/*)                  t="/etc/config/${f#zapret2-manager/files/etc/config/}" ;;
    zapret2-manager/files/etc/*)                         t="/etc/${f#zapret2-manager/files/etc/}" ;;
    zapret2-manager/files/lib/*)                         t="/lib/${f#zapret2-manager/files/lib/}" ;;
    luci-app-zapret2-manager/files/www/*)                t="/${f#luci-app-zapret2-manager/files/}" ;;
    luci-app-zapret2-manager/files/usr/share/rpcd/*)     t="/usr/share/rpcd/${f#luci-app-zapret2-manager/files/usr/share/rpcd/}" ;;
    luci-app-zapret2-manager/files/usr/share/luci/*)     t="/usr/share/luci/${f#luci-app-zapret2-manager/files/usr/share/luci/}" ;;
    luci-app-zapret2-manager/files/usr/share/ucode/*)    t="/usr/share/ucode/${f#luci-app-zapret2-manager/files/usr/share/ucode/}" ;;
    *) continue ;;
  esac
  printf '%s|%s\n' "$f" "$t" >> "$MAP_OUT"
done

TOTAL=$(wc -l < "$MAP_OUT")
echo "mapped $TOTAL runtime files"

LOCAL=$TMP/z2m-local-hashes.txt
: > "$LOCAL"
while IFS='|' read -r f t; do
  h=$(sha256sum "$f" | awk '{print $1}')
  printf '%s|%s\n' "$h" "$t"
done < "$MAP_OUT" > "$LOCAL"

# remote hashes via paths file pushed to router /tmp
awk -F'|' '{print $2}' "$LOCAL" > "$TMP/z2m-paths.txt"
scp -q -O -o BatchMode=yes "$TMP/z2m-paths.txt" root@192.168.1.1:/tmp/z2m-paths.txt
ssh -o BatchMode=yes root@192.168.1.1 'while read -r p; do if [ -f "$p" ]; then printf "%s|%s|%s\n" "$(sha256sum "$p" | awk "{print \$1}")" "$(stat -c %a "$p" 2>/dev/null || echo 0644)" "$p"; else printf "MISSING|-|%s\n" "$p"; fi; done < /tmp/z2m-paths.txt' > "$TMP/z2m-remote.txt"

MANIFEST=$TMP/z2m-deploy.manifest
: > "$MANIFEST"
DIFFCOUNT=0
while IFS='|' read -r h t; do
  row=$(grep -F "|$t" "$TMP/z2m-remote.txt" | head -1 || true)
  rh=$(printf '%s' "$row" | awk -F'|' '{print $1}')
  rm_=$(printf '%s' "$row" | awk -F'|' '{print $2}')
  if [ -z "$row" ] || [ "$rh" != "$h" ]; then
    f=$(grep -F "|$t" "$MAP_OUT" | head -1 | cut -d'|' -f1)
    case "$f" in *graphify-out*) continue ;; esac
    if [ "$rm_" = "-" ] || [ -z "$rm_" ]; then
      case "$f" in
        *.sh|*/init.d/*) mode=0755 ;;
        *) mode=0644 ;;
      esac
    else
      mode=$rm_
      case "$mode" in 0644|0755) ;; *) mode=0644 ;; esac
    fi
    printf '%s|%s|%s\n' "$f" "$t" "$mode" >> "$MANIFEST"
    DIFFCOUNT=$((DIFFCOUNT+1))
  fi
done < "$LOCAL"

echo "manifest rows (changed/missing): $DIFFCOUNT"
