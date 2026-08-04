# zapret2-manager — backend package (ucode + shell)
# Management layer over upstream zapret2. The package installs only its
# version-controlled runtime tree; tests, plans and reference assets live
# outside files/ and therefore cannot enter the APK.

include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=138
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKGARCH:=all
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Management backend for upstream zapret2
  DEPENDS:=zapret2 ucode ncat
endef

define Package/zapret2-manager/description
  Ucode and shell management backend that reports honest runtime/applied/draft
  state and delegates mutations to the sanctioned upstream or manager owners.
  It does not implement DPI bypass and does not duplicate nfqws2.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

# Operator-owned state survives upgrades.
define Package/zapret2-manager/conffiles
/etc/zapret2-manager/state.json
/etc/zapret2-manager/service-dns-state.json
endef

define Package/zapret2-manager/install
	# The files tree contains runtime material only. $(CP) is OpenWrt's
	# permission-preserving recursive copy, so executable workers/init scripts
	# keep their mode while every new focused module and rpcd companion ships.
	$(CP) ./files/* $(1)/
endef

define Package/zapret2-manager/postinst
#!/bin/sh
# Newly registered rpcd companion objects require one rpcd reload. Do not
# restart uhttpd, firewall, dnsmasq or the router from package scripts.
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable
exit 0
endef

$(eval $(call BuildPackage,zapret2-manager))
