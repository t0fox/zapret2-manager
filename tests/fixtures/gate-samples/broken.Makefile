# broken Makefile: recipe line uses SPACES not a tab before $(
include $(TOPDIR)/rules.mk
define Package/x
  TITLE:=x
endef
define Package/x/install
  $(INSTALL_DIR) $(1)/x
endef
