MOBILE_DIR := apps/mobile
APP_VARIANT ?= production
IOS_CONFIGURATION ?= Release
IOS_BUNDLE_ID ?= me.akmyradov.t3code

VP ?= vp
EXPO ?= $(VP) exec expo

IOS_ENV := APP_VARIANT=$(APP_VARIANT) EXPO_NO_GIT_STATUS=1
ifneq ($(strip $(IOS_BUNDLE_ID)),)
IOS_ENV += T3CODE_IOS_BUNDLE_IDENTIFIER=$(IOS_BUNDLE_ID)
endif

.PHONY: help mobile-ios-prebuild mobile-ios-install mobile-ios-prod mobile-ios-preview mobile-ios-dev mobile-ios-config check typecheck

help:
	@printf "%s\n" "Targets:"
	@printf "%s\n" "  make mobile-ios-prod"
	@printf "%s\n" "  make mobile-ios-preview IOS_BUNDLE_ID=me.akmyradov.t3code.preview"
	@printf "%s\n" "  make mobile-ios-dev IOS_BUNDLE_ID=me.akmyradov.t3code.dev"
	@printf "%s\n" ""
	@printf "%s\n" "Variables:"
	@printf "%s\n" "  APP_VARIANT=production|preview|development"
	@printf "%s\n" "  IOS_CONFIGURATION=Release|Debug"
	@printf "%s\n" "  IOS_BUNDLE_ID=me.akmyradov.t3code"

mobile-ios-prebuild:
	cd $(MOBILE_DIR) && $(IOS_ENV) $(EXPO) prebuild --clean --platform ios

mobile-ios-install: mobile-ios-prebuild
	cd $(MOBILE_DIR) && $(IOS_ENV) $(EXPO) run:ios --device --configuration $(IOS_CONFIGURATION)

mobile-ios-prod:
	$(MAKE) mobile-ios-install APP_VARIANT=production IOS_CONFIGURATION=Release IOS_BUNDLE_ID="$(IOS_BUNDLE_ID)"

mobile-ios-preview:
	$(MAKE) mobile-ios-install APP_VARIANT=preview IOS_CONFIGURATION=Release IOS_BUNDLE_ID="$(IOS_BUNDLE_ID)"

mobile-ios-dev:
	$(MAKE) mobile-ios-install APP_VARIANT=development IOS_CONFIGURATION=Debug IOS_BUNDLE_ID="$(IOS_BUNDLE_ID)"

mobile-ios-config:
	cd $(MOBILE_DIR) && $(IOS_ENV) $(EXPO) config

check:
	$(VP) check

typecheck:
	$(VP) run typecheck
