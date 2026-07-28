# luci-app-zapret2-manager — LuCI JS frontend for zapret2-manager
#
# Client-side views (no Python, no Lua in the UI — flash-constrained). Calls
# the zapret2-manager ubus object over rpcd; does no state collection itself.
#
# postinst MUST reset the LuCI cache or the new page will not render after
# install: remove /tmp/luci-indexcache and the contents of
# /tmp/luci-modulecache, then reload rpcd and uhttpd.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-zapret2-manager
PKG_VERSION:=0.1.0
PKG_RELEASE:=30
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
  DEPENDS:=luci-base zapret2-manager
endef

define Package/luci-app-zapret2-manager/description
  Read-only LuCI status page for zapret2-manager. Menu:
  Services -> Zapret 2 Manager.
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
	# Install EVERY shipped view (.js) in the view directory — automatically, not
	# a hardcoded list. A per-file enumeration silently drops pages when the UI
	# grows (this Makefile used to install only overview.js while 8 views ship).
	# $(wildcard) globs the source dir at expand time; $(foreach) installs each.
	$(foreach js,$(wildcard ./files/www/luci-static/resources/view/zapret2-manager/*.js), \
		$(INSTALL_DATA) $(js) $(1)/www/luci-static/resources/view/zapret2-manager/;)
endef

define Package/luci-app-zapret2-manager/postinst
#!/bin/sh
# Reset LuCI caches so the new view is picked up immediately, then reload the
# daemons that serve it. Without this, a freshly installed page can 404 or
# render stale until the next cache rebuild.
rm -f /tmp/luci-indexcache
rm -rf /tmp/luci-modulecache/* 2>/dev/null || true
/etc/init.d/rpcd reload
/etc/init.d/uhttpd reload
exit 0
endef

define Package/luci-app-zapret2-manager/postrm
#!/bin/sh
rm -f /tmp/luci-indexcache
rm -rf /tmp/luci-modulecache/* 2>/dev/null || true
exit 0
endef

$(eval $(call BuildPackage,luci-app-zapret2-manager))
