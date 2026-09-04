# zapret2-manager-full — canonical self-contained backend + LuCI package
# The package directory must be captured before rules.mk extends MAKEFILE_LIST.
# The upstream zapret2 engine and Telegram Proxy remain optional lifecycle
# components and are intentionally not bundled or pulled in as dependencies.
FULL_PACKAGE_DIR:=$(dir $(abspath $(lastword $(MAKEFILE_LIST))))

include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager-full
PKG_VERSION:=0.1.0
PKG_RELEASE:=155
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKG_FLAGS:=nonshared
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

FULL_SOURCE_DIR:=$(FULL_PACKAGE_DIR)/sources
BACKEND_SOURCE_DIR:=$(FULL_SOURCE_DIR)/backend-src
BACKEND_FILES_DIR:=$(FULL_SOURCE_DIR)/backend-files
LUCI_FILES_DIR:=$(FULL_SOURCE_DIR)/luci-files

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager-full
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Complete Zapret2 Manager backend and LuCI
  DEPENDS:=@TARGET_mediatek_filogic +ucode +ucode-mod-fs +ucode-mod-io +ucode-mod-socket +ucode-mod-uloop +luci-base +kmod-nfnetlink-queue +kmod-nft-queue +ncat +flock +uclient-fetch +ca-bundle +unzip +jsonfilter +libjson-c
  PROVIDES:=zapret2-manager luci-app-zapret2-manager
  PKG_FLAGS:=nonshared
endef

define Package/zapret2-manager-full/description
  Complete Zapret2 Manager release package containing the manager backend,
  runtime assets and LuCI application. The engine and Telegram Proxy remain
  optional and are managed by their existing lifecycle owners.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)/backend-src $(PKG_BUILD_DIR)/backend-files $(PKG_BUILD_DIR)/luci-files
	$(CP) $(BACKEND_SOURCE_DIR)/* $(PKG_BUILD_DIR)/backend-src/
	$(CP) $(BACKEND_FILES_DIR)/* $(PKG_BUILD_DIR)/backend-files/
	$(CP) $(LUCI_FILES_DIR)/* $(PKG_BUILD_DIR)/luci-files/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
		-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/atomic.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/base64.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/canonical.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/errors.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/files.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/main.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/mkdir.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/paths.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/protocol.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/roots.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/sha256.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-core-helper/scanner.c \
		$(TARGET_LDFLAGS) -ljson-c \
		-o $(PKG_BUILD_DIR)/z2m-core-helper
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
		-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
		$(PKG_BUILD_DIR)/backend-src/z2m-root-bootstrap.c \
		$(TARGET_LDFLAGS) \
		-o $(PKG_BUILD_DIR)/z2m-root-bootstrap
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
		-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
		$(PKG_BUILD_DIR)/backend-src/z2m-scanner-firewall-helper.c \
		$(TARGET_LDFLAGS) -ljson-c \
		-o $(PKG_BUILD_DIR)/z2m-scanner-firewall-helper
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
		-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
		$(PKG_BUILD_DIR)/backend-src/z2m-helperd/z2m-helperd.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-helperd/transport.c \
		$(PKG_BUILD_DIR)/backend-src/z2m-helperd/supervise.c \
		$(TARGET_LDFLAGS) -ljson-c \
		-o $(PKG_BUILD_DIR)/z2m-helperd
endef

define Package/zapret2-manager-full/conffiles
/etc/zapret2-manager/state.json
/etc/zapret2-manager/service-dns-state.json
/etc/zapret2-manager/engine-state.json
endef

define Package/zapret2-manager-full/install
	$(CP) $(PKG_BUILD_DIR)/backend-files/* $(1)/
	$(CP) $(PKG_BUILD_DIR)/luci-files/* $(1)/
	chmod 0755 $(1)/usr/libexec/zapret2-manager/*.sh
	chmod 0755 $(1)/etc/init.d/zapret2-manager
	chmod 0755 $(1)/etc/hotplug.d/iface/90-zapret2-manager
	chmod 0644 $(1)/usr/libexec/zapret2-manager/*.uc
	chmod 0644 $(1)/usr/share/rpcd/ucode/*.uc
	find $(1)/usr/share/zapret2-manager -type f -exec chmod 0644 {} +
	chmod 0644 $(1)/etc/zapret2-manager/*.json
	chmod 0640 $(1)/etc/zapret2-manager/ipset/*.txt
	chmod 0600 $(1)/etc/zapret2-manager/state.json
	chmod 0644 $(1)/usr/share/luci/menu.d/*.json
	chmod 0644 $(1)/usr/share/rpcd/acl.d/*.json
	find $(1)/www/luci-static/resources/view/zapret2-manager -type f -exec chmod 0644 {} +
	$(INSTALL_DIR) $(1)/usr/libexec/zapret2-manager
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-core-helper $(1)/usr/libexec/zapret2-manager/z2m-core-helper
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-root-bootstrap $(1)/usr/libexec/zapret2-manager/z2m-root-bootstrap
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-scanner-firewall-helper $(1)/usr/libexec/zapret2-manager/z2m-scanner-firewall-helper
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-helperd $(1)/usr/libexec/zapret2-manager/z2m-helperd
endef

define Package/zapret2-manager-full/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT:-}" ] && exit 0
# One deterministic lifecycle for the self-contained package: persistent
# roots, strategy state and catalog migration, LuCI cache invalidation, one
# rpcd reload, one manager restart, then bounded runtime evidence. Migration
# failures remain visible and never replace verified legacy state with a
# partial generation.
/usr/libexec/zapret2-manager/z2m-root-bootstrap persistent || exit $$?
if [ ! -e /etc/zapret2-manager/strategies ] && [ ! -L /etc/zapret2-manager/strategies ]; then
  install -d -o root -g root -m 0700 /etc/zapret2-manager/strategies || exit $$?
fi
if [ ! -e /etc/zapret2-manager/strategy-state.json ] && [ ! -L /etc/zapret2-manager/strategy-state.json ]; then
  printf '%s\n' '{"schema":1,"revision":0,"favorites":[],"selected":null}' \
    | install -o root -g root -m 0600 /dev/stdin /etc/zapret2-manager/strategy-state.json || exit $$?
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
rm -f /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache/ 2>/dev/null || true
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

$(eval $(call BuildPackage,zapret2-manager-full))
