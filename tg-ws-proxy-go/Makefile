# tg-ws-proxy-go — optional Go provider for the TG Proxy tab.
# Source is pinned to the newest router-compatible commit on upstream main-go.
# The local patch makes TG_SECRET the default secret source, so the manager
# never places the secret in argv.

include $(TOPDIR)/rules.mk

PKG_NAME:=tg-ws-proxy-go
PKG_VERSION:=0.9.3
PKG_RELEASE:=2
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/spatiumstas/tg-ws-proxy-go.git
PKG_SOURCE_VERSION:=a334786d528615b18e002c1286373098ac6e46a2
PKG_SOURCE_DATE:=2026-08-02
# Exact compatible source commit is pinned. Replace `skip` with the generated
# mirror hash during the verification/build wave before this PR leaves draft.
PKG_MIRROR_HASH:=skip

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16
PKG_FLAGS:=nonshared

GO_PKG:=tg-ws-proxy
GO_PKG_BUILD_PKG:=tg-ws-proxy

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/tg-ws-proxy-go
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=TG WS Proxy Go (optional, spatiumstas 0.9.3 MTProto)
  DEPENDS:=@TARGET_mediatek_filogic $(GO_ARCH_DEPENDS)
  PROVIDES:=tg-ws-proxy-provider tg-ws-proxy-rs=0.9.3-r2
  CONFLICTS:=tg-ws-proxy-rs
endef

define Package/tg-ws-proxy-go/description
  Optional Go implementation of the Telegram MTProto WebSocket bridge.
  Broad embedded compatibility and a smaller common feature set. Only the
  newest router-compatible main-go build is published in the manager feed.
  The manager supplies its secret through TG_SECRET, never through argv.
endef

# Upstream keeps go.mod and the program in src/. Copy that module to the build
# root after the standard unpack+patch phase so golang-package.mk can build it
# as the pinned module `tg-ws-proxy` and install a predictably named binary.
define Build/Prepare
	$(call Build/Prepare/Default)
	$(CP) $(PKG_BUILD_DIR)/src/. $(PKG_BUILD_DIR)/
endef

define Package/tg-ws-proxy-go/install
	$(call GoPackage/Package/Install/Bin,$(1))
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/tg-ws-proxy $(1)/etc/init.d/tg-ws-proxy
	$(INSTALL_DIR) $(1)/usr/share/licenses/tg-ws-proxy-go
	$(INSTALL_DATA) ./files/usr/share/licenses/tg-ws-proxy-go/LICENSE \
		$(1)/usr/share/licenses/tg-ws-proxy-go/LICENSE
endef

define Package/tg-ws-proxy-go/postinst
#!/bin/sh
exit 0
endef

$(eval $(call GoBinPackage,tg-ws-proxy-go))
$(eval $(call BuildPackage,tg-ws-proxy-go))
