# zapret2-manager-full — target-specific manager meta-package

include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager-full
PKG_VERSION:=0.1.0
PKG_RELEASE:=139
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKG_FLAGS:=nonshared
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager-full
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Full Zapret2 Manager (TG Proxy remains optional)
  DEPENDS:=@TARGET_mediatek_filogic +zapret2-manager +luci-app-zapret2-manager
  PKG_FLAGS:=nonshared
endef

define Package/zapret2-manager-full/description
  Installs the management backend and LuCI interface. Telegram Proxy is not a
  dependency: Rust or Go can be installed, switched or removed later from the
  TG Proxy tab without affecting the rest of Zapret2 Manager.
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
