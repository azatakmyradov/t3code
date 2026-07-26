SHELL := /bin/sh

.DEFAULT_GOAL := help

VP ?= vp
MOBILE_DIR ?= apps/mobile

# Override these on the command line when installing on another phone or with
# another Apple developer account:
#   make iphone IOS_DEVICE="My iPhone" IOS_BUNDLE_ID=com.example.t3code
IOS_DEVICE ?= Azat’s iPhone
IOS_BUNDLE_ID ?= me.akmyradov.t3code
IOS_SCHEME ?= T3Code
IOS_APP_PATH ?=
IOS_INSTALL_ATTEMPTS ?= 3
IOS_INSTALL_RETRY_DELAY ?= 3

.PHONY: help setup dev dev-share mobile-dev mobile-check \
	iphone-build iphone-install iphone iphone-launch

help: ## Show the available commands.
	@awk 'BEGIN { FS = ":.*## "; printf "Usage: make <target> [VARIABLE=value]\n\n" } /^[a-zA-Z0-9_-]+:.*## / { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf '\nCommon overrides:\n'
	@printf '  IOS_DEVICE      iPhone name or UDID (default: %s)\n' "$(IOS_DEVICE)"
	@printf '  IOS_BUNDLE_ID   Personal Team bundle identifier (default: %s)\n' "$(IOS_BUNDLE_ID)"

setup: ## Install repository dependencies.
	$(VP) install

dev: ## Start the local web and server development stack.
	$(VP) run dev

dev-share: ## Start the development stack for access from another device.
	$(VP) run dev:share

mobile-dev: ## Start Metro for the iOS development client.
	cd "$(MOBILE_DIR)" && $(VP) run dev:client

mobile-check: ## Run focused mobile type and native static checks.
	$(VP) run --filter @t3tools/mobile typecheck
	$(VP) run lint:mobile

iphone-build: ## Build a signed Release app that does not need Metro at runtime.
	@test "$$(uname -s)" = "Darwin" || { echo "iphone-build requires macOS."; exit 2; }
	@command -v xcrun >/dev/null || { echo "Xcode command-line tools are required."; exit 2; }
	@test -n "$(IOS_BUNDLE_ID)" || { echo "Set IOS_BUNDLE_ID to a reverse-DNS identifier you control."; exit 2; }
	@test -d "$(MOBILE_DIR)/ios/$(IOS_SCHEME).xcworkspace" || { echo "The generated iOS workspace is missing. Run the mobile iOS prebuild first."; exit 2; }
	cd "$(MOBILE_DIR)" && \
		APP_VARIANT=production \
		EXPO_NO_GIT_STATUS=1 \
		T3CODE_IOS_PERSONAL_TEAM=1 \
		T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="$(IOS_BUNDLE_ID)" \
		xcodebuild \
			-workspace "ios/$(IOS_SCHEME).xcworkspace" \
			-scheme "$(IOS_SCHEME)" \
			-configuration Release \
			-destination "generic/platform=iOS" \
			-allowProvisioningUpdates \
			-quiet \
			build

iphone-install: ## Install the most recently built Release app on the iPhone.
	@test -n "$(IOS_DEVICE)" || { echo "Set IOS_DEVICE to the iPhone name or UDID."; exit 2; }
	@set -eu; \
		app_path="$(IOS_APP_PATH)"; \
		if [ -z "$$app_path" ]; then \
			build_dir="$$(cd "$(MOBILE_DIR)" && xcodebuild \
				-workspace "ios/$(IOS_SCHEME).xcworkspace" \
				-scheme "$(IOS_SCHEME)" \
				-configuration Release \
				-destination "generic/platform=iOS" \
				-showBuildSettings 2>/dev/null | \
				awk -F ' = ' '/^[[:space:]]*TARGET_BUILD_DIR = / { print $$2; exit }')"; \
			app_path="$$build_dir/$(IOS_SCHEME).app"; \
		fi; \
		test -d "$$app_path" || { echo "No app found at $$app_path. Run 'make iphone-build' first."; exit 2; }; \
		attempt=1; \
		while ! xcrun devicectl device install app --device "$(IOS_DEVICE)" "$$app_path"; do \
			if [ "$$attempt" -ge "$(IOS_INSTALL_ATTEMPTS)" ]; then \
				echo "Install failed after $$attempt attempts. Unlock and reconnect the iPhone, then run 'make iphone-install'."; \
				exit 1; \
			fi; \
			echo "Device connection dropped; retrying install in $(IOS_INSTALL_RETRY_DELAY)s..."; \
			attempt=$$((attempt + 1)); \
			sleep "$(IOS_INSTALL_RETRY_DELAY)"; \
		done

iphone: iphone-build ## Build and install the standalone Release app.
	@$(MAKE) --no-print-directory iphone-install \
		IOS_DEVICE="$(IOS_DEVICE)" \
		IOS_APP_PATH="$(IOS_APP_PATH)"

iphone-launch: ## Launch the installed standalone app on the iPhone.
	@test -n "$(IOS_DEVICE)" || { echo "Set IOS_DEVICE to the iPhone name or UDID."; exit 2; }
	xcrun devicectl device process launch \
		--device "$(IOS_DEVICE)" \
		--terminate-existing \
		--activate \
		"$(IOS_BUNDLE_ID)"
