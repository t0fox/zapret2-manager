# zapret2-manager — backend package (ucode + shell)
include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=156
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Management backend for optional upstream zapret2
  DEPENDS:=+ucode +ucode-mod-fs +ucode-mod-io +ucode-mod-socket +ucode-mod-uloop +kmod-nfnetlink-queue +kmod-nft-queue +ncat +flock +uclient-fetch +ca-bundle +unzip +jsonfilter +libjson-c
endef

define Package/zapret2-manager/description
  Management backend for zapret2. The engine is deliberately optional and can
  be installed, updated, switched or removed through the manager.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/z2m-core-helper/* $(PKG_BUILD_DIR)/
	$(CP) ./src/z2m-root-bootstrap.c $(PKG_BUILD_DIR)/
	$(CP) ./src/z2m-scanner-firewall-helper.c $(PKG_BUILD_DIR)/
	mkdir -p $(PKG_BUILD_DIR)/z2m-helperd-src
	$(CP) ./src/z2m-helperd/* $(PKG_BUILD_DIR)/z2m-helperd-src/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
		-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
		$(PKG_BUILD_DIR)/atomic.c \
		$(PKG_BUILD_DIR)/base64.c \
		$(PKG_BUILD_DIR)/canonical.c \
		$(PKG_BUILD_DIR)/errors.c \
		$(PKG_BUILD_DIR)/files.c \
		$(PKG_BUILD_DIR)/main.c \
		$(PKG_BUILD_DIR)/mkdir.c \
		$(PKG_BUILD_DIR)/paths.c \
		$(PKG_BUILD_DIR)/protocol.c \
		$(PKG_BUILD_DIR)/roots.c \
		$(PKG_BUILD_DIR)/sha256.c \
		$(PKG_BUILD_DIR)/scanner.c \
		$(TARGET_LDFLAGS) -ljson-c \
		-o $(PKG_BUILD_DIR)/z2m-core-helper
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
		-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
		$(PKG_BUILD_DIR)/z2m-root-bootstrap.c \
		$(TARGET_LDFLAGS) \
		-o $(PKG_BUILD_DIR)/z2m-root-bootstrap
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
		-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
		$(PKG_BUILD_DIR)/z2m-scanner-firewall-helper.c \
		$(TARGET_LDFLAGS) -ljson-c \
		-o $(PKG_BUILD_DIR)/z2m-scanner-firewall-helper
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
		-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
		$(PKG_BUILD_DIR)/z2m-helperd-src/z2m-helperd.c \
		$(PKG_BUILD_DIR)/z2m-helperd-src/transport.c \
		$(PKG_BUILD_DIR)/z2m-helperd-src/supervise.c \
		$(TARGET_LDFLAGS) -ljson-c \
		-o $(PKG_BUILD_DIR)/z2m-helperd
endef

define Package/zapret2-manager/conffiles
/etc/zapret2-manager/state.json
/etc/zapret2-manager/service-dns-state.json
/etc/zapret2-manager/engine-state.json
endef

define Package/zapret2-manager/install
	$(CP) ./files/* $(1)/
	chmod 0755 $(1)/usr/libexec/zapret2-manager/*.sh
	chmod 0755 $(1)/etc/init.d/zapret2-manager
	chmod 0755 $(1)/etc/hotplug.d/iface/90-zapret2-manager
	chmod 0644 $(1)/usr/libexec/zapret2-manager/*.uc
	chmod 0644 $(1)/usr/share/rpcd/ucode/*.uc
	find $(1)/usr/share/zapret2-manager -type f -exec chmod 0644 {} +
	chmod 0644 $(1)/etc/zapret2-manager/*.json
	chmod 0640 $(1)/etc/zapret2-manager/ipset/*.txt
	chmod 0600 $(1)/etc/zapret2-manager/state.json
	$(INSTALL_DIR) $(1)/usr/libexec/zapret2-manager
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-core-helper $(1)/usr/libexec/zapret2-manager/z2m-core-helper
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-root-bootstrap $(1)/usr/libexec/zapret2-manager/z2m-root-bootstrap
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-scanner-firewall-helper $(1)/usr/libexec/zapret2-manager/z2m-scanner-firewall-helper
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-helperd $(1)/usr/libexec/zapret2-manager/z2m-helperd
endef

define Package/zapret2-manager/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT:-}" ] && exit 0
# Clean-install lifecycle (no reboot): persistent roots, then strategy state,
# then one-way source-generation migration, then the legacy compact catalog
# fallback if migration cannot complete, then rpcd reload, enable AND restart,
# then runtime evidence. Migration failures remain visible and never replace
# the verified legacy authority with a partial generation.
/usr/libexec/zapret2-manager/z2m-root-bootstrap persistent || exit $$?
if [ ! -e /etc/zapret2-manager/strategies ] && [ ! -L /etc/zapret2-manager/strategies ]; then
  mkdir -p /etc/zapret2-manager/strategies || exit $$?
  chown root:root /etc/zapret2-manager/strategies || exit $$?
  chmod 0700 /etc/zapret2-manager/strategies || exit $$?
fi
if [ ! -e /etc/zapret2-manager/strategy-state.json ] && [ ! -L /etc/zapret2-manager/strategy-state.json ]; then
  strategy_state_tmp=/etc/zapret2-manager/.strategy-state.json.$$
  rm -f "$$strategy_state_tmp"
  printf '%s\n' '{"schema":1,"revision":0,"favorites":[],"selected":null}' \
    > "$$strategy_state_tmp" || { rm -f "$$strategy_state_tmp"; exit 1; }
  chown root:root "$$strategy_state_tmp" || { rm -f "$$strategy_state_tmp"; exit 1; }
  chmod 0600 "$$strategy_state_tmp" || { rm -f "$$strategy_state_tmp"; exit 1; }
  mv -f "$$strategy_state_tmp" /etc/zapret2-manager/strategy-state.json || { rm -f "$$strategy_state_tmp"; exit 1; }
fi
rm -f /etc/zapret2-manager/catalog/repair-required
migration_out="$$(/usr/bin/ucode /usr/libexec/zapret2-manager/strategy-catalog-migration-cli.uc 2>/dev/null)"
migration_ok=0
index_path=/etc/zapret2-manager/catalog/strategy-catalog-index.json
case "$$migration_out" in
  *'"ok": true'*|*'"ok":true'*) migration_ok=1; rm -f /etc/zapret2-manager/catalog/migration-required ;;
  *)
    mkdir -p /etc/zapret2-manager/catalog
    : > /etc/zapret2-manager/catalog/migration-required
    logger -t zapret2-manager -p daemon.err "strategy catalog source migration unavailable; retaining verified legacy catalog"
    ;;
esac
# Migration is only a successful warm-up when the compact persistent index
# was actually published. Fall back to the bounded legacy index repair if the
# source-generation path returned success without leaving that artifact.
if [ "$$migration_ok" -eq 1 ] && [ ! -f "$$index_path" ]; then
  migration_ok=0
fi
index_ok=0
if [ "$$migration_ok" -eq 1 ]; then
  index_ok=1
else
  for attempt in 1 2; do
    index_out="$$(/usr/bin/ucode /usr/libexec/zapret2-manager/strategy-catalog-index-cli.uc 2>/dev/null)"
    case "$$index_out" in
      *'"written": true'*|*'"written":true'*) index_ok=1; break ;;
    esac
  done
fi
if [ "$$index_ok" -ne 1 ]; then
  mkdir -p /etc/zapret2-manager/catalog
  : > /etc/zapret2-manager/catalog/repair-required
  logger -t zapret2-manager -p daemon.err "catalog read index unavailable after install; run strategies_catalog_reload to repair"
fi
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable || exit $$?
/etc/init.d/zapret2-manager restart || exit $$?
verify_tries=0
while [ "$$verify_tries" -lt 15 ]; do
  if pidof z2m-helperd >/dev/null 2>&1 \
    && [ -S /tmp/zapret2-manager/runtime/z2m-helperd.sock ] \
    && ubus -S call zapret2-manager status_fast 2>/dev/null | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    break
  fi
  verify_tries=$$((verify_tries + 1))
  sleep 1
done
if ! pidof z2m-helperd >/dev/null 2>&1; then
  logger -t zapret2-manager -p daemon.err "z2m-helperd did not start after install"; exit 1
fi
if [ ! -S /tmp/zapret2-manager/runtime/z2m-helperd.sock ]; then
  logger -t zapret2-manager -p daemon.err "helper socket missing after install"; exit 1
fi
if ! ubus -S call zapret2-manager status_fast 2>/dev/null | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  logger -t zapret2-manager -p daemon.err "bounded status_fast proof failed after install"; exit 1
fi
exit 0
endef

$(eval $(call BuildPackage,zapret2-manager))
.PHONY: build-scanner-firewall-helper build-ownership-helper
build-scanner-firewall-helper:
	@mkdir -p build
	$(CC) -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE -o build/z2m-scanner-firewall-helper \
		src/z2m-scanner-firewall-helper.c \
		$(shell pkg-config --cflags json-c 2>/dev/null || echo "") \
		$(shell pkg-config --libs json-c 2>/dev/null || echo "-ljson-c")
	@echo "firewall helper built: build/z2m-scanner-firewall-helper"

# Compatibility alias for the old local verification command. The canonical
# implementation is the scanner firewall helper above.
build-ownership-helper: build-scanner-firewall-helper
