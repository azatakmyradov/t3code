MOBILE_DIR := apps/mobile
APP_VARIANT ?= production
IOS_CONFIGURATION ?= Release
IOS_BUNDLE_ID ?= me.akmyradov.t3code
DESKTOP_ARCH ?= arm64
NIGHTLY_RUN ?= 1

VP ?= vp
EXPO ?= $(VP) exec expo
NODE ?= node

NIGHTLY_DATE ?= $(shell date +%Y%m%d)
NIGHTLY_BASE_VERSION ?= $(shell $(NODE) -p "const v=require('./apps/server/package.json').version.split('-')[0].split('.').map(Number); v[2]+=1; v.join('.')")
NIGHTLY_VERSION ?= $(NIGHTLY_BASE_VERSION)-nightly.$(NIGHTLY_DATE).$(NIGHTLY_RUN)

IOS_ENV := APP_VARIANT=$(APP_VARIANT) EXPO_NO_GIT_STATUS=1
ifneq ($(strip $(IOS_BUNDLE_ID)),)
IOS_ENV += T3CODE_IOS_BUNDLE_IDENTIFIER=$(IOS_BUNDLE_ID)
endif

.PHONY: help mobile-ios-prebuild mobile-ios-install mobile-ios-prod mobile-ios-preview mobile-ios-dev mobile-ios-config desktop-nightly-mac check typecheck

help:
	@printf "%s\n" "Targets:"
	@printf "%s\n" "  make mobile-ios-prod"
	@printf "%s\n" "  make mobile-ios-preview IOS_BUNDLE_ID=me.akmyradov.t3code.preview"
	@printf "%s\n" "  make mobile-ios-dev IOS_BUNDLE_ID=me.akmyradov.t3code.dev"
	@printf "%s\n" "  make desktop-nightly-mac DESKTOP_ARCH=arm64 NIGHTLY_RUN=1"
	@printf "%s\n" ""
	@printf "%s\n" "Variables:"
	@printf "%s\n" "  APP_VARIANT=production|preview|development"
	@printf "%s\n" "  IOS_CONFIGURATION=Release|Debug"
	@printf "%s\n" "  IOS_BUNDLE_ID=me.akmyradov.t3code"
	@printf "%s\n" "  DESKTOP_ARCH=arm64|x64|universal"
	@printf "%s\n" "  NIGHTLY_VERSION=$(NIGHTLY_VERSION)"

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

desktop-nightly-mac:
	$(NODE) scripts/build-desktop-artifact.ts --platform mac --target dmg --arch $(DESKTOP_ARCH) --build-version $(NIGHTLY_VERSION)

check:
	$(VP) check

typecheck:
	$(VP) run typecheck
