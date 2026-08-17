# zapret2-manager — backend package (ucode + shell)
include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=147
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Management backend for optional upstream zapret2
  DEPENDS:=+ucode +ucode-mod-fs +ucode-mod-io +ucode-mod-socket +ucode-mod-uloop +ncat +curl +flock +uclient-fetch +ca-bundle +unzip +jsonfilter +libjson-c
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
/etc/zapret2-manager/service-dns-state.json
/etc/zapret2-manager/engine-state.json
/etc/zapret2-manager/blockcheck-domains.json
/etc/zapret2-manager/asset-registry.json
/etc/zapret2-manager/routes.json
endef

define Package/zapret2-manager/install
	$(CP) ./files/* $(1)/
	chmod 0755 $(1)/usr/libexec/zapret2-manager/*.sh
	chmod 0755 $(1)/etc/init.d/zapret2-manager
	chmod 0755 $(1)/etc/hotplug.d/iface/90-zapret2-manager
	chmod 0644 $(1)/usr/libexec/zapret2-manager/*.uc
	chmod 0755 $(1)/usr/libexec/zapret2-manager/asset-registry-package-init.uc
	find $(1)/usr/share/zapret2-manager -type f -exec chmod 0644 {} +
	chmod 0644 $(1)/etc/zapret2-manager/*.json
	chmod 0644 $(1)/etc/zapret2-manager/ipset/*.txt
	chmod 0600 $(1)/etc/zapret2-manager/asset-registry.json
	$(INSTALL_DIR) $(1)/usr/libexec/zapret2-manager
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-core-helper $(1)/usr/libexec/zapret2-manager/z2m-core-helper
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-root-bootstrap $(1)/usr/libexec/zapret2-manager/z2m-root-bootstrap
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-scanner-firewall-helper $(1)/usr/libexec/zapret2-manager/z2m-scanner-firewall-helper
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/z2m-helperd $(1)/usr/libexec/zapret2-manager/z2m-helperd
endef

define Package/zapret2-manager/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT:-}" ] && exit 0
/usr/libexec/zapret2-manager/z2m-root-bootstrap persistent || exit $$?
if [ ! -e /etc/zapret2-manager/strategies ] && [ ! -L /etc/zapret2-manager/strategies ]; then
  install -d -o root -g root -m 0700 /etc/zapret2-manager/strategies || exit $$?
fi
if [ ! -e /etc/zapret2-manager/strategy-state.json ] && [ ! -L /etc/zapret2-manager/strategy-state.json ]; then
  printf '%s\n' '{"schema":1,"revision":0,"favorites":[],"selected":null}' \
    | install -o root -g root -m 0600 /dev/stdin /etc/zapret2-manager/strategy-state.json || exit $$?
fi
if [ ! -e /etc/zapret2-manager/routes.json ] && [ ! -L /etc/zapret2-manager/routes.json ]; then
  printf '%s\n' '{"schema":1,"revision":0,"routes":[]}' \
    | install -o root -g root -m 0600 /dev/stdin /etc/zapret2-manager/routes.json || exit $$?
fi
if [ ! -e /etc/zapret2-manager/routes-journal ] && [ ! -L /etc/zapret2-manager/routes-journal ]; then
  install -d -o root -g root -m 0700 /etc/zapret2-manager/routes-journal || exit $$?
fi
if [ ! -e /etc/zapret2-manager/asset-registry.json ] && [ ! -L /etc/zapret2-manager/asset-registry.json ]; then
  printf '%s\n' '{"schema":1,"revision":0,"assets":[]}' \
    | install -o root -g root -m 0600 /dev/stdin /etc/zapret2-manager/asset-registry.json || exit $$?
fi
if [ -x /usr/bin/ucode ] && [ -x /usr/libexec/zapret2-manager/asset-registry-package-init.uc ]; then
  if [ ! -e /etc/zapret2-manager/assets ] && [ ! -L /etc/zapret2-manager/assets ]; then
    install -d -o root -g root -m 0700 /etc/zapret2-manager/assets || exit $$?
  fi
  /usr/bin/ucode /usr/libexec/zapret2-manager/asset-registry-package-init.uc || exit $$?
fi
if [ -x /usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh ]; then
  /usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh || exit $$?
fi
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable
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
