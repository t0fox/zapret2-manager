# good Makefile: recipe line uses a TAB before $(
include $(TOPDIR)/rules.mk
define Package/x
  TITLE:=x
endef
define Package/x/install
	$(INSTALL_DIR) $(1)/x
endef
