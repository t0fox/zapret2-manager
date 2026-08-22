# zapret2-manager-full — target-specific manager meta-package
# TG Proxy remains optional; the zapret2 engine is optional as well.
include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager-full
PKG_VERSION:=0.1.0
PKG_RELEASE:=149
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
	$(INSTALL_DIR) $(1)/usr/share/zapret2-manager
	echo 'zapret2-manager-full' > $(1)/usr/share/zapret2-manager/full-package
endef

$(eval $(call BuildPackage,zapret2-manager-full))
