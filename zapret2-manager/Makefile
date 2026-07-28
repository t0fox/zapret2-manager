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
PKG_RELEASE:=12
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
  DEPENDS:=zapret2 ucode
endef

define Package/zapret2-manager/description
  ucode + ash backend that reports honest three-level state (RUNTIME /
  APPLIED / DRAFT) for upstream zapret2 and controls the service through
  upstream's own mechanisms. Does not implement DPI bypass.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

# Draft profiles live in state.json — declare it a conffile so package
# upgrades never overwrite the operator's drafts (Slice 2).
define Package/zapret2-manager/conffiles
/etc/zapret2-manager/state.json
endef

define Build/Compile
endef

define Package/zapret2-manager/install
	$(INSTALL_DIR) $(1)/etc/zapret2-manager
	$(INSTALL_DATA) ./files/etc/zapret2-manager/state.json \
		$(1)/etc/zapret2-manager/state.json
	# Backend logic (ucode). Runtime /tmp dirs are created on demand.
	$(INSTALL_DIR) $(1)/usr/libexec/zapret2-manager
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/constants.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/apply.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/apply-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/backup.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/lists.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/lists-model.json \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/lists-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/profiles.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/profiles-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/profiles-draft.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/profiles-apply.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/jobs.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/jobs-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/blockcheck-run.sh \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/backup-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/maintenance.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/maintenance-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/dns.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/dns-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/qlen.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/status.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/service.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/watchdog.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/log-rotate.sh \
		$(1)/usr/libexec/zapret2-manager/

	# rpcd ucode plugin → ubus object zapret2-manager. ucode plugins that
	# return a signature object load from /usr/share/rpcd/ucode/ (NOT
	# /usr/libexec/rpcd/, which is for exec-plugins — a different contract).
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./files/usr/share/rpcd/ucode/zapret2-manager.uc \
		$(1)/usr/share/rpcd/ucode/

	# Paused-flag enforcer on interface hotplug (branch 04). Runs after
	# upstream's 90-zapret2 by lexical order; calls upstream's own stop.
	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_BIN) ./files/etc/hotplug.d/iface/90-zapret2-manager \
		$(1)/etc/hotplug.d/iface/

	# Watchdog init (procd). Starts only the watchdog daemon, never nfqws2.
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/zapret2-manager \
		$(1)/etc/init.d/
endef

# No LuCI cache reset here (that lives in luci-app-zapret2-manager). We do
# enable the watchdog init and reload rpcd so a backend-only update picks up
# the ubus plugin. The watchdog starts on next boot; start it now with
# '/etc/init.d/zapret2-manager start'. Autostart is verified by a real reboot
# (tools/smoke.sh autostart), not by this enable.

define Package/zapret2-manager/postinst
#!/bin/sh
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable
exit 0
endef

$(eval $(call BuildPackage,zapret2-manager))
