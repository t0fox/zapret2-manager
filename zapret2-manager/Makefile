# zapret2-manager — backend package (ucode + shell)
include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=146
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Management backend for optional upstream zapret2
  DEPENDS:=+ucode +ucode-mod-fs +ucode-mod-io +ucode-mod-socket +ucode-mod-uloop +ncat +flock +uclient-fetch +ca-bundle +unzip +jsonfilter +libjson-c
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
/etc/zapret2-manager/engine-provider.json
endef

define Package/zapret2-manager/install
	$(CP) ./files/* $(1)/
	chmod 0755 $(1)/usr/libexec/zapret2-manager/*.sh
	chmod 0755 $(1)/etc/init.d/zapret2-manager
	chmod 0755 $(1)/etc/hotplug.d/iface/90-zapret2-manager
	chmod 0644 $(1)/usr/libexec/zapret2-manager/*.uc
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
/usr/libexec/zapret2-manager/z2m-root-bootstrap persistent || exit $$?
if [ ! -e /etc/zapret2-manager/strategies ] && [ ! -L /etc/zapret2-manager/strategies ]; then
  install -d -o root -g root -m 0700 /etc/zapret2-manager/strategies || exit $$?
fi
if [ ! -e /etc/zapret2-manager/strategy-state.json ] && [ ! -L /etc/zapret2-manager/strategy-state.json ]; then
  printf '%s\n' '{"schema":1,"revision":0,"favorites":[],"selected":null}' \
    | install -o root -g root -m 0600 /dev/stdin /etc/zapret2-manager/strategy-state.json || exit $$?
fi
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable
exit 0
endef

$(eval $(call BuildPackage,zapret2-manager))
