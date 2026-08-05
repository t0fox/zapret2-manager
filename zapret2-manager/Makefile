# zapret2-manager — backend package (ucode + shell)
include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=146
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKGARCH:=all
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Management backend for optional upstream zapret2
  DEPENDS:=+ucode +ncat +flock +uclient-fetch +ca-bundle +unzip +jsonfilter
endef

define Package/zapret2-manager/description
  Management backend for zapret2. The engine is deliberately optional and can
  be installed, updated, switched or removed through the manager.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/zapret2-manager/conffiles
/etc/zapret2-manager/state.json
/etc/zapret2-manager/service-dns-state.json
/etc/zapret2-manager/engine-provider.json
endef

define Package/zapret2-manager/install
	$(CP) ./files/* $(1)/
endef

define Package/zapret2-manager/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT:-}" ] && exit 0
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable
exit 0
endef

$(eval $(call BuildPackage,zapret2-manager))
