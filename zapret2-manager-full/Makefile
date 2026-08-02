# zapret2-manager-full — meta-package: one-command install of the full stack
#
# Single apk add zapret2-manager-full that pulls in all three packages:
#   - zapret2-manager         (backend: ubus object, ucode helpers, init)
#   - luci-app-zapret2-manager (LuCI JS frontend)
#   - tg-ws-proxy-rs          (Telegram MTProto WebSocket bridge binary + init)
#
# Architecture constraint: tg-ws-proxy-rs ships an aarch64 static-musl binary
# tested only on mediatek_filogic (Cudy WBR3000UAX v1). This meta-package
# inherits that constraint via its DEPENDS — it is only buildable and
# installable on that target.
#
# PKG_FLAGS:=nonshared ensures per-target build, never arch:all, matching
# tg-ws-proxy-rs. This means the meta-package is built fresh for each target
# (in practice only mediatek_filogic), and its .apk is only published for that
# target — honest about the arch restriction.

include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-manager-full
PKG_VERSION:=0.1.0
PKG_RELEASE:=123
PKG_MAINTAINER:=Ásgeir
PKG_LICENSE:=MIT
PKG_FLAGS:=nonshared
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-manager-full
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=DPI bypass
  TITLE:=Full zapret2-manager stack (backend + LuCI + TG proxy)
  DEPENDS:=@TARGET_mediatek_filogic +zapret2-manager +luci-app-zapret2-manager +tg-ws-proxy-rs
  PKG_FLAGS:=nonshared
endef

define Package/zapret2-manager-full/description
  Meta-package. Installs the complete zapret2-manager stack in one command:
  management backend, LuCI web frontend, and the Telegram MTProto WebSocket
  bridge proxy. Architecture-restricted to mediatek_filogic (the only target
  tg-ws-proxy-rs has been packaged and tested on).
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/zapret2-manager-full/install
	# Meta-package — no files to install. All functionality comes from
	# runtime dependencies (zapret2-manager, luci-app-zapret2-manager,
	# tg-ws-proxy-rs). An empty install section is correct.
endef

$(eval $(call BuildPackage,zapret2-manager-full))
