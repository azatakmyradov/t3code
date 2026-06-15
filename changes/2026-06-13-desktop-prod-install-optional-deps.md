# Desktop Prod Install Keeps Optional Deps

Status: current fork-local change.

## Summary

- Changes the desktop artifact staging install from `vp install --prod
--no-optional` to `vp install --prod`.

## Why

Dropping `--no-optional` keeps optional dependencies in the staged production
install so platform-specific optional packages required at runtime are present
in the packaged desktop app.

## Files

- `scripts/build-desktop-artifact.ts`: removes `--no-optional` from the staged
  prod install command and its log label.

## Merge Notes

- If upstream re-adds `--no-optional`, re-evaluate whether the desktop bundle
  still ships every required optional dependency before reverting.

## Verification

- Build the desktop artifact and confirm the packaged app starts.
