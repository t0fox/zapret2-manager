# zapret2-manager-full — target-specific meta-package

include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager-full
PKG_VERSION:=0.1.0
PKG_RELEASE:=138
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKG_FLAGS:=nonshared
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager-full
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Full zapret2-manager stack (backend + LuCI + TG proxy)
  DEPENDS:=@TARGET_mediatek_filogic +zapret2-manager +luci-app-zapret2-manager +tg-ws-proxy-rs
  PKG_FLAGS:=nonshared
endef

define Package/zapret2-manager-full/description
  Installs the complete target-specific stack: management backend, LuCI
  frontend and the Telegram MTProto WebSocket bridge dependency.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/zapret2-manager-full/install
	# Meta-package: runtime files are owned by dependencies.
endef

$(eval $(call BuildPackage,zapret2-manager-full))
