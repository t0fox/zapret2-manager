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
PKG_RELEASE:=137
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
/etc/zapret2-manager/service-dns-state.json
endef

define Build/Compile
endef

define Package/zapret2-manager/install
	$(INSTALL_DIR) $(1)/etc/zapret2-manager
	$(INSTALL_DATA) ./files/etc/zapret2-manager/state.json \
		$(1)/etc/zapret2-manager/state.json
	# These are argv-referenced upstream nfqws2 inputs, not runtime cache.
	# Ship empty files so a cold boot cannot fail before the owner service starts.
	$(INSTALL_DIR) $(1)/etc/zapret2-manager/ipset
	$(INSTALL_DATA) ./files/etc/zapret2-manager/ipset/games.txt \
		$(1)/etc/zapret2-manager/ipset/games.txt
	$(INSTALL_DATA) ./files/etc/zapret2-manager/ipset/steam.txt \
		$(1)/etc/zapret2-manager/ipset/steam.txt
	$(INSTALL_DIR) $(1)/etc/zapret2-manager/presets
	$(INSTALL_DIR) $(1)/usr/share/zapret2-manager/presets
	$(INSTALL_DATA) ./files/usr/share/zapret2-manager/presets/tcp_https.txt \
		$(1)/usr/share/zapret2-manager/presets/
	$(INSTALL_DATA) ./files/usr/share/zapret2-manager/presets/stun_voice.txt \
		$(1)/usr/share/zapret2-manager/presets/
	$(INSTALL_DATA) ./files/usr/share/zapret2-manager/presets/udp_games.txt \
		$(1)/usr/share/zapret2-manager/presets/
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
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/flowseal-combo.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/jobs.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/jobs-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/blockcheck-apply-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/blockcheck-run.sh \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/health-run.sh \
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
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/dnsprov.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/dnsprov-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/service-dns.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/service-dns-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/orchestra.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/orchestra-run.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/orchestra-worker.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/orchestra-worker-control.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/orchestra-candidate-run.sh \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/orchestra-probe-preflight.sh \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/orchestra-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/proxy.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/proxycfg.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/proxy-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DIR) $(1)/usr/libexec/zapret2-manager/catalog
	$(INSTALL_DIR) $(1)/usr/libexec/zapret2-manager/services
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/services/discord.json \
		$(1)/usr/libexec/zapret2-manager/services/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog/services.json \
		$(1)/usr/libexec/zapret2-manager/catalog/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog/dns-providers.json \
		$(1)/usr/libexec/zapret2-manager/catalog/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog/service-dns-profiles.json \
		$(1)/usr/libexec/zapret2-manager/catalog/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog/orchestra-strategies.json \
		$(1)/usr/libexec/zapret2-manager/catalog/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog/orchestra-zapret2gui.json \
		$(1)/usr/libexec/zapret2-manager/catalog/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog/flowseal-combos.json \
		$(1)/usr/libexec/zapret2-manager/catalog/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json \
		$(1)/usr/libexec/zapret2-manager/catalog/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/catalog/stressozz-compiled.json \
		$(1)/usr/libexec/zapret2-manager/catalog/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/stressozz-validate.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/discord-profile.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-manager/discord-profile-cli.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/qlen.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/status.uc \
		./files/usr/libexec/zapret2-manager/runtime-summary.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/service.uc \
		$(1)/usr/libexec/zapret2-manager/
	$(INSTALL_DATA) ./files/usr/libexec/zapret2-manager/watchdog.uc \
		./files/usr/libexec/zapret2-manager/auto-strategy.uc \
		./files/usr/libexec/zapret2-manager/auto-strategy-cli.uc \
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
