import { MonitorIcon, MoonIcon, RotateCcwIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../../components/ui/number-field";
import { Switch } from "../../components/ui/switch";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import {
  DEFAULT_APPEARANCE_DARK_COLORS,
  DEFAULT_APPEARANCE_LIGHT_COLORS,
  DEFAULT_WEB_APPEARANCE_SETTINGS,
  type AppearanceSettings as AppearanceSettingsValue,
  type AppearanceThemeColors,
  isAppearanceDefault,
  normalizeFontFamilyInput,
  normalizeHexColorInput,
} from "./appearanceDefaults";
import { useAppearanceSettings } from "./appearanceSettingsStore";

type EditableTheme = "light" | "dark";
type AppearanceThemeMode = "system" | "light" | "dark";
type ColorField = Exclude<keyof AppearanceThemeColors, "contrast">;

const THEME_MODE_OPTIONS: ReadonlyArray<{
  value: AppearanceThemeMode;
  label: string;
  icon: typeof MonitorIcon;
}> = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

const EDITABLE_THEME_OPTIONS: ReadonlyArray<{
  value: EditableTheme;
  label: string;
  icon: typeof SunIcon;
}> = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

const COLOR_FIELD_LABELS: Record<ColorField, string> = {
  accentColor: "Accent color",
  backgroundColor: "Background color",
  foregroundColor: "Foreground color",
};

const COLOR_FIELD_DESCRIPTIONS: Record<ColorField, string> = {
  accentColor: "Used for selected controls, rings, and primary actions.",
  backgroundColor: "Sets the main app surface for this theme.",
  foregroundColor: "Sets the primary text color for this theme.",
};

function defaultColorsForTheme(theme: EditableTheme): AppearanceThemeColors {
  return theme === "dark" ? DEFAULT_APPEARANCE_DARK_COLORS : DEFAULT_APPEARANCE_LIGHT_COLORS;
}

function updateAppearanceThemeColors(
  appearance: AppearanceSettingsValue,
  theme: EditableTheme,
  patch: Partial<AppearanceThemeColors>,
): AppearanceSettingsValue {
  return {
    ...appearance,
    [theme]: {
      ...appearance[theme],
      ...patch,
    },
  };
}

function boundedInteger(value: number, min: number, max: number): number | null {
  if (!Number.isInteger(value)) {
    return null;
  }

  return Math.min(max, Math.max(min, value));
}

function ColorSettingRow(props: {
  readonly appearance: AppearanceSettingsValue;
  readonly editableTheme: EditableTheme;
  readonly field: ColorField;
  readonly onAppearanceChange: (next: AppearanceSettingsValue) => void;
}) {
  const value = props.appearance[props.editableTheme][props.field];
  const defaultValue = defaultColorsForTheme(props.editableTheme)[props.field];
  const [draft, setDraft] = useState<string>(value);
  const normalizedDraft = normalizeHexColorInput(draft);
  const invalid = normalizedDraft === null;
  const title = COLOR_FIELD_LABELS[props.field];

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const saveColor = (nextValue: string) => {
    const normalized = normalizeHexColorInput(nextValue);
    setDraft(nextValue);
    if (!normalized || normalized === value) {
      return;
    }

    props.onAppearanceChange(
      updateAppearanceThemeColors(props.appearance, props.editableTheme, {
        [props.field]: normalized,
      }),
    );
  };

  return (
    <SettingsRow
      title={title}
      description={COLOR_FIELD_DESCRIPTIONS[props.field]}
      status={invalid ? "Use #RGB or #RRGGBB." : null}
      resetAction={
        value !== defaultValue ? (
          <SettingResetButton label={title.toLowerCase()} onClick={() => saveColor(defaultValue)} />
        ) : null
      }
      control={
        <div className="flex w-full items-center gap-2 sm:w-56">
          <Input
            nativeInput
            aria-invalid={invalid || undefined}
            aria-label={title}
            className="min-w-0 flex-1"
            size="sm"
            value={draft}
            onChange={(event) => saveColor(event.currentTarget.value)}
          />
          <input
            aria-label={`${title} picker`}
            className={cn(
              "h-7.5 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5",
              "[&::-webkit-color-swatch]:rounded-[calc(var(--radius-md)-1px)] [&::-webkit-color-swatch]:border-0",
              "[&::-webkit-color-swatch-wrapper]:p-0",
            )}
            type="color"
            value={value}
            onChange={(event) => saveColor(event.currentTarget.value)}
          />
        </div>
      }
    />
  );
}

function NumberSettingRow(props: {
  readonly title: string;
  readonly description: string;
  readonly value: number;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly ariaLabel: string;
  readonly onValueChange: (value: number) => void;
}) {
  const handleValueChange = (nextValue: number | null) => {
    if (nextValue === null) {
      return;
    }

    const normalized = boundedInteger(nextValue, props.min, props.max);
    if (normalized === null || normalized === props.value) {
      return;
    }

    props.onValueChange(normalized);
  };

  return (
    <SettingsRow
      title={props.title}
      description={props.description}
      resetAction={
        props.value !== props.defaultValue ? (
          <SettingResetButton
            label={props.title.toLowerCase()}
            onClick={() => props.onValueChange(props.defaultValue)}
          />
        ) : null
      }
      control={
        <NumberField
          aria-label={props.ariaLabel}
          className="w-32"
          max={props.max}
          min={props.min}
          size="sm"
          step={1}
          value={props.value}
          onValueChange={handleValueChange}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={`Decrease ${props.title.toLowerCase()}`} />
            <NumberFieldInput aria-label={props.ariaLabel} inputMode="numeric" />
            <NumberFieldIncrement aria-label={`Increase ${props.title.toLowerCase()}`} />
          </NumberFieldGroup>
        </NumberField>
      }
    />
  );
}

function FontFamilyRow(props: {
  readonly title: string;
  readonly description: string;
  readonly value: string;
  readonly defaultValue: string;
  readonly onValueChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  const normalizedDraft = normalizeFontFamilyInput(draft);
  const invalid = normalizedDraft === null;

  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  const saveFontFamily = (nextValue: string) => {
    setDraft(nextValue);
    const normalized = normalizeFontFamilyInput(nextValue);
    if (!normalized || normalized === props.value) {
      return;
    }

    props.onValueChange(normalized);
  };

  return (
    <SettingsRow
      title={props.title}
      description={props.description}
      status={invalid ? "Enter a non-empty CSS font-family value." : null}
      resetAction={
        props.value !== props.defaultValue ? (
          <SettingResetButton
            label={props.title.toLowerCase()}
            onClick={() => saveFontFamily(props.defaultValue)}
          />
        ) : null
      }
      control={
        <Input
          nativeInput
          aria-invalid={invalid || undefined}
          aria-label={props.title}
          className="w-full sm:w-72"
          size="sm"
          value={draft}
          onChange={(event) => saveFontFamily(event.currentTarget.value)}
        />
      }
    />
  );
}

export function AppearanceSettings() {
  const { appearance, setAppearance, resetAppearance } = useAppearanceSettings();
  const { theme, setTheme } = useTheme();
  const [editableTheme, setEditableTheme] = useState<EditableTheme>("light");
  const editedColors = appearance[editableTheme];
  const editedDefaults = defaultColorsForTheme(editableTheme);

  const updateAppearance = (nextAppearance: AppearanceSettingsValue) => {
    setAppearance(nextAppearance);
  };

  const resetButton = (
    <Button
      size="xs"
      variant="outline"
      disabled={isAppearanceDefault(appearance) && theme === "system"}
      onClick={() => {
        setTheme("system");
        resetAppearance();
      }}
    >
      <RotateCcwIcon className="mx-1 size-3.5" />
      Reset Appearance
    </Button>
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Mode" headerAction={resetButton}>
        <SettingsRow
          title="Theme mode"
          description="Follow the system setting or force a specific appearance."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme mode" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <ToggleGroup
              aria-label="Theme mode"
              className="w-full sm:w-auto"
              size="sm"
              variant="outline"
              value={[theme]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "system" || next === "light" || next === "dark") {
                  setTheme(next);
                }
              }}
            >
              {THEME_MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <Toggle
                    key={option.value}
                    value={option.value}
                    className="flex-1 px-3 sm:flex-none"
                  >
                    <Icon className="size-3.5" />
                    {option.label}
                  </Toggle>
                );
              })}
            </ToggleGroup>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Theme"
        headerAction={
          <ToggleGroup
            aria-label="Theme colors to edit"
            size="xs"
            variant="outline"
            value={[editableTheme]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "light" || next === "dark") {
                setEditableTheme(next);
              }
            }}
          >
            {EDITABLE_THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Toggle key={option.value} value={option.value} className="px-2.5">
                  <Icon className="size-3" />
                  {option.label}
                </Toggle>
              );
            })}
          </ToggleGroup>
        }
      >
        <ColorSettingRow
          appearance={appearance}
          editableTheme={editableTheme}
          field="accentColor"
          onAppearanceChange={updateAppearance}
        />
        <ColorSettingRow
          appearance={appearance}
          editableTheme={editableTheme}
          field="backgroundColor"
          onAppearanceChange={updateAppearance}
        />
        <ColorSettingRow
          appearance={appearance}
          editableTheme={editableTheme}
          field="foregroundColor"
          onAppearanceChange={updateAppearance}
        />
        <NumberSettingRow
          title="Contrast"
          description="Controls derived surface, border, and input intensity."
          value={editedColors.contrast}
          defaultValue={editedDefaults.contrast}
          min={0}
          max={100}
          ariaLabel={`${editableTheme} contrast`}
          onValueChange={(contrast) =>
            updateAppearance(updateAppearanceThemeColors(appearance, editableTheme, { contrast }))
          }
        />
      </SettingsSection>

      <SettingsSection title="Typography">
        <FontFamilyRow
          title="UI font family"
          description="CSS font-family stack used for app controls and content."
          value={appearance.uiFontFamily}
          defaultValue={DEFAULT_WEB_APPEARANCE_SETTINGS.uiFontFamily}
          onValueChange={(uiFontFamily) => updateAppearance({ ...appearance, uiFontFamily })}
        />
        <FontFamilyRow
          title="Code font family"
          description="CSS font-family stack used for code blocks and monospace text."
          value={appearance.codeFontFamily}
          defaultValue={DEFAULT_WEB_APPEARANCE_SETTINGS.codeFontFamily}
          onValueChange={(codeFontFamily) => updateAppearance({ ...appearance, codeFontFamily })}
        />
        <NumberSettingRow
          title="UI font size"
          description="Base font size for the app interface."
          value={appearance.uiFontSize}
          defaultValue={DEFAULT_WEB_APPEARANCE_SETTINGS.uiFontSize}
          min={10}
          max={24}
          ariaLabel="UI font size"
          onValueChange={(uiFontSize) => updateAppearance({ ...appearance, uiFontSize })}
        />
        <NumberSettingRow
          title="Code font size"
          description="Base font size for code and preformatted text."
          value={appearance.codeFontSize}
          defaultValue={DEFAULT_WEB_APPEARANCE_SETTINGS.codeFontSize}
          min={10}
          max={24}
          ariaLabel="Code font size"
          onValueChange={(codeFontSize) => updateAppearance({ ...appearance, codeFontSize })}
        />
        <SettingsRow
          title="Font smoothing"
          description="Use antialiasing and optimized text rendering."
          resetAction={
            appearance.fontSmoothing !== DEFAULT_WEB_APPEARANCE_SETTINGS.fontSmoothing ? (
              <SettingResetButton
                label="font smoothing"
                onClick={() =>
                  updateAppearance({
                    ...appearance,
                    fontSmoothing: DEFAULT_WEB_APPEARANCE_SETTINGS.fontSmoothing,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              aria-label="Font smoothing"
              checked={appearance.fontSmoothing}
              onCheckedChange={(checked) =>
                updateAppearance({ ...appearance, fontSmoothing: Boolean(checked) })
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Chrome">
        <SettingsRow
          title="Translucent sidebar"
          description="Blur the app background through the desktop sidebar."
          resetAction={
            appearance.translucentSidebar !== DEFAULT_WEB_APPEARANCE_SETTINGS.translucentSidebar ? (
              <SettingResetButton
                label="translucent sidebar"
                onClick={() =>
                  updateAppearance({
                    ...appearance,
                    translucentSidebar: DEFAULT_WEB_APPEARANCE_SETTINGS.translucentSidebar,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              aria-label="Translucent sidebar"
              checked={appearance.translucentSidebar}
              onCheckedChange={(checked) =>
                updateAppearance({ ...appearance, translucentSidebar: Boolean(checked) })
              }
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
