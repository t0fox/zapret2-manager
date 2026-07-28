# tg-ws-proxy-rs — pinned Telegram MTProto WebSocket bridge proxy (optional).
#
# Separate optional package: zapret2-manager SUPERVISES this proxy but never
# embeds it. Removing this package removes only its own files (binary, init,
# stock config, license) — no unrelated package is touched, and zapret2-manager
# keeps working with proxy status simply reporting installed:false.
#
# Trust model (docs/research/tg-ws-proxy-provider.md — ADR):
#   - pinned upstream release v1.6.5 (never "latest");
#   - the prebuilt aarch64 static-musl asset is downloaded by the OpenWrt
#     download machinery and verified against PKG_HASH — that verification IS
#     the build-time SHA-256 gate; a mismatch fails the build closed;
#   - the produced .apk is signed by our APK key; installation NEVER uses
#     apk --allow-untrusted (the signing public key is trusted on the device).
#
# Architecture honesty: the pinned asset is aarch64-only. PKG_FLAGS=nonshared
# builds per-target (never an arch:all package), and DEPENDS restricts the
# package to the ONLY target this binary was packaged and tested on — the
# Cudy WBR3000UAX v1 (mediatek_filogic, aarch64_cortex-a53, OpenWrt 25.12.5).
# Other aarch64 targets can be enabled here after they are actually packaged
# and smoke-tested; claiming them untested would be a lie.

include $(TOPDIR)/rules.mk

PKG_NAME:=tg-ws-proxy-rs
PKG_VERSION:=1.6.5
PKG_RELEASE:=1
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT

PKG_SOURCE:=tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz
PKG_SOURCE_URL:=https://github.com/valnesfjord/tg-ws-proxy-rs/releases/download/v1.6.5
PKG_HASH:=54803f09f9b4a83b27e7d6fa2dd7bbeb51df04d6365f29b5746086d2830dc45a

# arch-specific prebuilt binary → per-target build, never shared/arch:all
PKG_FLAGS:=nonshared
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/tg-ws-proxy-rs
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Telegram MTProto WebSocket bridge proxy (pinned v1.6.5)
  # Packaged+tested ONLY on mediatek_filogic (Cudy WBR3000UAX v1) so far.
  DEPENDS:=@TARGET_mediatek_filogic
endef

define Package/tg-ws-proxy-rs/description
  Telegram MTProto WebSocket bridge (valnesfjord/tg-ws-proxy-rs, MIT),
  shipped as the pinned, SHA-256-verified aarch64 static-musl binary with a
  procd service. MTProto-only: the provider has no SOCKS5 server mode.
  Supervised (never embedded) by zapret2-manager. Config and the CSPRNG
  MTProto secret live under /etc/tg-ws-proxy/ and are operator state —
  generated on first apply, never shipped, never auto-started by install.
endef

# The operator's config and generated secret survive upgrades AND are never
# clobbered by reinstalls. (The stock config is inert: ENABLED=0 + empty HOST
# → the init gates refuse to start.)
define Package/tg-ws-proxy-rs/conffiles
/etc/tg-ws-proxy/config.conf
/etc/tg-ws-proxy/secret.conf
endef

# The asset tarball contains exactly one top-level file (tg-ws-proxy, no root
# dir), so untar explicitly — no strip-components ambiguity. PKG_HASH was
# already verified by the download step above.
define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(TAR) -xzf $(DL_DIR)/$(PKG_SOURCE) -C $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/tg-ws-proxy-rs/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/tg-ws-proxy $(1)/usr/bin/tg-ws-proxy
	# procd service with hard startup gates (see the script header).
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/tg-ws-proxy $(1)/etc/init.d/tg-ws-proxy
	# stock config, 0600 from the start (the applied config may carry upstream
	# MTProto proxy credentials in MTPROTO_PROXIES).
	$(INSTALL_DIR) $(1)/etc/tg-ws-proxy
	$(INSTALL_CONF) ./files/etc/tg-ws-proxy/config.conf $(1)/etc/tg-ws-proxy/config.conf
	# MIT license + attribution (the upstream asset carries no LICENSE — this
	# is vendored from the pinned source commit).
	$(INSTALL_DIR) $(1)/usr/share/licenses/tg-ws-proxy-rs
	$(INSTALL_DATA) ./files/usr/share/licenses/tg-ws-proxy-rs/LICENSE \
		$(1)/usr/share/licenses/tg-ws-proxy-rs/LICENSE
endef

# Intentionally NO enable and NO start: the proxy listens on the LAN with a
# generated MTProto secret — first run is an explicit operator action
# (zapret2-manager proxy_config_apply / proxy_start), never an install side
# effect. Not starting also keeps the stock ENABLED=0 config honest.
define Package/tg-ws-proxy-rs/postinst
#!/bin/sh
exit 0
endef

$(eval $(call BuildPackage,tg-ws-proxy-rs))
