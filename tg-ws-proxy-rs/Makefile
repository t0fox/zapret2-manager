# tg-ws-proxy-rs — pinned optional Rust Telegram MTProto WebSocket proxy.
# Downloaded only by the package builder, verified by SHA-256 and then signed
# as part of our APK feed. Runtime install/remove is controlled by our TG Proxy
# UI; zapret2-manager itself does not depend on this package.

include $(TOPDIR)/rules.mk

PKG_NAME:=tg-ws-proxy-rs
PKG_VERSION:=1.7.1
PKG_RELEASE:=1
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT

PKG_SOURCE:=tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz
PKG_SOURCE_URL:=https://github.com/valnesfjord/tg-ws-proxy-rs/releases/download/v1.7.1
PKG_HASH:=ad23cdd6e89476fa135d04c4706d85e4c793c2a3cd430fd7e4b5179d525eeedb

PKG_FLAGS:=nonshared
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/tg-ws-proxy-rs
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=TG WS Proxy Rust (optional, pinned v1.7.1)
  DEPENDS:=@TARGET_mediatek_filogic
  PROVIDES:=tg-ws-proxy-provider
  CONFLICTS:=tg-ws-proxy-go
endef

define Package/tg-ws-proxy-rs/description
  Optional Rust implementation of the Telegram MTProto WebSocket bridge.
  Low memory usage and the complete advanced manager configuration surface.
  Installed, switched and removed from the Zapret2 Manager TG Proxy tab.
endef

define Package/tg-ws-proxy-rs/conffiles
/etc/tg-ws-proxy/config.conf
/etc/tg-ws-proxy/secret.conf
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(TAR) -xzf $(DL_DIR)/$(PKG_SOURCE) -C $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/tg-ws-proxy-rs/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/tg-ws-proxy $(1)/usr/bin/tg-ws-proxy
	# Init is manager-owned single source - provider only installs binary
	# $(INSTALL_DIR) $(1)/etc/init.d
	# $(INSTALL_BIN) ./files/etc/init.d/tg-ws-proxy $(1)/etc/init.d/tg-ws-proxy
	$(INSTALL_DIR) $(1)/etc/tg-ws-proxy
	$(INSTALL_CONF) ./files/etc/tg-ws-proxy/config.conf $(1)/etc/tg-ws-proxy/config.conf
	$(INSTALL_DIR) $(1)/usr/share/licenses/tg-ws-proxy-rs
	$(INSTALL_DATA) ./files/usr/share/licenses/tg-ws-proxy-rs/LICENSE \
		$(1)/usr/share/licenses/tg-ws-proxy-rs/LICENSE
endef

define Package/tg-ws-proxy-rs/postinst
#!/bin/sh
exit 0
endef

$(eval $(call BuildPackage,tg-ws-proxy-rs))
