# luci-app-zapret2-manager — modular LuCI JavaScript frontend
include $(TOPDIR)/rules.mk
PKG_NAME:=luci-app-zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=156
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
  LuCI interface for zapret2-manager, including safe optional engine lifecycle.
endef
define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef
define Build/Compile
endef
define Package/luci-app-zapret2-manager/install
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(foreach acl,$(wildcard ./files/usr/share/rpcd/acl.d/*.json),$(INSTALL_DATA) $(acl) $(1)/usr/share/rpcd/acl.d/;)
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(foreach menu,$(wildcard ./files/usr/share/luci/menu.d/*.json),$(INSTALL_DATA) $(menu) $(1)/usr/share/luci/menu.d/;)
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/zapret2-manager
	$(foreach js,$(wildcard ./files/www/luci-static/resources/view/zapret2-manager/*.js),$(INSTALL_DATA) $(js) $(1)/www/luci-static/resources/view/zapret2-manager/;)
	$(foreach css,$(wildcard ./files/www/luci-static/resources/view/zapret2-manager/*.css),$(INSTALL_DATA) $(css) $(1)/www/luci-static/resources/view/zapret2-manager/;)
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/zapret2-manager/vendor
	$(foreach vendor,$(wildcard ./files/www/luci-static/resources/view/zapret2-manager/vendor/*.js),$(INSTALL_DATA) $(vendor) $(1)/www/luci-static/resources/view/zapret2-manager/vendor/;)
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/zapret2-manager/icons
	$(foreach icon,$(wildcard ./files/www/luci-static/resources/view/zapret2-manager/icons/*.svg),$(INSTALL_DATA) $(icon) $(1)/www/luci-static/resources/view/zapret2-manager/icons/;)
endef
define Package/luci-app-zapret2-manager/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT:-}" ] && exit 0
rm -f /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache/ 2>/dev/null || true
if [ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1; then
	:
elif [ -n "$$(pidof rpcd 2>/dev/null)" ]; then
	kill -HUP $$(pidof rpcd) 2>/dev/null || true
fi
exit 0
endef
define Package/luci-app-zapret2-manager/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT:-}" ] && exit 0
rm -f /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache/ 2>/dev/null || true
if [ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1; then
	:
elif [ -n "$$(pidof rpcd 2>/dev/null)" ]; then
	kill -HUP $$(pidof rpcd) 2>/dev/null || true
fi
exit 0
endef
$(eval $(call BuildPackage,luci-app-zapret2-manager))
