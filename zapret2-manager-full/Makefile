# zapret2-manager-full — target-specific manager meta-package
include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager-full
PKG_VERSION:=0.1.0
PKG_RELEASE:=146
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKG_FLAGS:=nonshared
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager-full
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Full Zapret2 Manager (engine and TG Proxy remain optional)
  DEPENDS:=@TARGET_mediatek_filogic +zapret2-manager +luci-app-zapret2-manager
  PKG_FLAGS:=nonshared
endef

define Package/zapret2-manager-full/description
  Installs manager backend and LuCI. The zapret2 engine and Telegram Proxy are
  managed independently and are intentionally not package dependencies.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/zapret2-manager-full/install
endef

$(eval $(call BuildPackage,zapret2-manager-full))
