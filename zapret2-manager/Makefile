# zapret2-manager — backend package (ucode + ash)
#
# Management layer over upstream zapret2. This package ships the runtime
# helpers, rpcd/ubus object, and init script added in later branches. In the
# skeleton it ships only the DRAFT state file so the package is installable.
#
# Hard rule: this package must not duplicate upstream zapret2 functionality.
# See docs/upstream-mapping.md.

include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Management backend for upstream zapret2
  DEPENDS:=+zapret2 +ucode
endef

define Package/zapret2-manager/description
  ucode + ash backend that reports honest three-level state (RUNTIME /
  APPLIED / DRAFT) for upstream zapret2 and controls the service through
  upstream's own mechanisms. Does not implement DPI bypass.
endef

define Build/Compile
endef

define Package/zapret2-manager/install
	$(INSTALL_DIR) $(1)/etc/zapret2-manager
	$(INSTALL_DATA) ./files/etc/zapret2-manager/state.json \
		$(1)/etc/zapret2-manager/state.json
	# Runtime dirs under /tmp are created on demand; no static install needed.
	$(INSTALL_DIR) $(1)/usr/libexec/zapret2-manager
endef

# No postinst here: LuCI cache reset lives in luci-app-zapret2-manager, which
# is what makes the page re-render after install.

$(eval $(call BuildPackage,zapret2-manager))
