# luci-app-zapret2-manager — modular LuCI JavaScript frontend

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=146
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKGARCH:=all
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-zapret2-manager
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI frontend for zapret2-manager
  DEPENDS:=+luci-base +zapret2-manager
endef

define Package/luci-app-zapret2-manager/description
  Single-root modular LuCI interface for zapret2-manager with semantic drafts,
  verified backend actions, monitoring and maintenance workflows.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/luci-app-zapret2-manager/install
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
		$(1)/usr/share/rpcd/acl.d/

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-zapret2-manager.json \
		$(1)/usr/share/luci/menu.d/

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/zapret2-manager
	# Wildcards are intentional: every focused frontend module and every local
	# stylesheet in the runtime directory must ship without a fragile list.
	$(foreach js,$(wildcard ./files/www/luci-static/resources/view/zapret2-manager/*.js), \
		$(INSTALL_DATA) $(js) $(1)/www/luci-static/resources/view/zapret2-manager/;)
	$(foreach css,$(wildcard ./files/www/luci-static/resources/view/zapret2-manager/*.css), \
		$(INSTALL_DATA) $(css) $(1)/www/luci-static/resources/view/zapret2-manager/;)
endef

define Package/luci-app-zapret2-manager/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT:-}" ] && exit 0
rm -f /tmp/luci-indexcache*
rm -rf /tmp/luci-modulecache 2>/dev/null || true
exit 0
endef

define Package/luci-app-zapret2-manager/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT:-}" ] && exit 0
rm -f /tmp/luci-indexcache*
rm -rf /tmp/luci-modulecache 2>/dev/null || true
exit 0
endef

$(eval $(call BuildPackage,luci-app-zapret2-manager))
