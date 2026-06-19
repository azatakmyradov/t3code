IOS_BUNDLE_ID ?= me.akmyradov.t3code

.PHONY: help mobile-ios-prod mobile-ios-preview mobile-ios-dev check typecheck

help:
	@printf "%s\n" "Targets:"
	@printf "%s\n" "  make mobile-ios-prod"
	@printf "%s\n" "  make mobile-ios-preview IOS_BUNDLE_ID=me.akmyradov.t3code.preview"
	@printf "%s\n" "  make mobile-ios-dev IOS_BUNDLE_ID=me.akmyradov.t3code.dev"

mobile-ios-prod:
	IOS_BUNDLE_ID="$(IOS_BUNDLE_ID)" node scripts/fork/mobile-ios.mjs prod

mobile-ios-preview:
	IOS_BUNDLE_ID="$(IOS_BUNDLE_ID)" node scripts/fork/mobile-ios.mjs preview

mobile-ios-dev:
	IOS_BUNDLE_ID="$(IOS_BUNDLE_ID)" node scripts/fork/mobile-ios.mjs dev

check:
	vp check

typecheck:
	vp run typecheck
