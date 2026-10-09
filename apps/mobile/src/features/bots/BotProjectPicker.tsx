import { LegendList } from "@legendapp/list/react-native";
import {
  BOT_PROJECT_SELECTION_LIMIT,
  botProjectKey,
  botProjectOptions,
  filterBotProjectOptions,
  selectAllBotProjects,
  toggleBotProject,
} from "@t3tools/client-runtime/state/bots";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { BotPermissions } from "@t3tools/contracts";
import { useMemo, useRef, useState } from "react";
import { Keyboard, Modal, Platform, View, type TextInputInstance } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPill } from "../../components/ControlPill";
import { MaterialListRow } from "../../components/MaterialListRow";
import { MaterialSearchField } from "../../components/MaterialSearchField";
import { useProjects, useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";

type Projects = BotPermissions["projects"];

/** A settings row that opens a searchable, multi-select sheet of the bot's projects. */
export function BotProjectPicker({
  value,
  onChange,
}: {
  value: Projects;
  onChange: (value: Projects) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsRow
        icon="folder"
        label="Projects"
        value={value.length === 0 ? "None" : `${value.length} selected`}
        valuePosition="trailing"
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
      />
      {open ? (
        <BotProjectSheet
          value={value}
          onChange={onChange}
          onClose={() => {
            Keyboard.dismiss();
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function BotProjectSheet({
  value,
  onChange,
  onClose,
}: {
  value: Projects;
  onChange: (value: Projects) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInputInstance>(null);
  const allProjects = useProjects();
  const serverConfigs = useServerConfigs();
  const { environments } = useEnvironments();
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  // Scratch projects hold loose threads, not work a bot should be granted.
  const projects = useMemo(
    () =>
      allProjects.filter(
        (project) =>
          !isScratchProject(
            project,
            serverConfigs.get(project.environmentId)?.scratchWorkspaceRoot,
          ),
      ),
    [allProjects, serverConfigs],
  );
  const options = useMemo(
    () => botProjectOptions(projects, environments, value),
    [projects, environments, value],
  );
  const selected = useMemo(() => new Set(value.map(botProjectKey)), [value]);
  const filtered = useMemo(
    () => filterBotProjectOptions(options, selected, query, selectedOnly),
    [options, selected, query, selectedOnly],
  );
  const available = options.filter((option) => option.available);
  const allSelected = available.length > 0 && available.every((option) => selected.has(option.key));
  const overLimit =
    new Set([...selected, ...available.map((option) => option.key)]).size >
    BOT_PROJECT_SELECTION_LIMIT;
  const atLimit = value.length >= BOT_PROJECT_SELECTION_LIMIT;

  return (
    <Modal
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        automaticOffset
        behavior="padding"
        className="flex-1 bg-sheet-solid"
        style={{ paddingTop: Platform.OS === "android" ? insets.top : 16 }}
      >
        <View className="gap-3 px-4 pb-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="gap-1">
              <Text accessibilityRole="header" className="text-xl font-t3-semibold text-foreground">
                Projects
              </Text>
              <Text className="text-sm text-foreground-muted" accessibilityLiveRegion="polite">
                {value.length} selected
              </Text>
            </View>
            <ControlPill variant="pill" label="Done" onPress={onClose} />
          </View>
          <View className="flex-row">
            <MaterialSearchField
              autoFocus={false}
              inputRef={searchRef}
              accessibilityLabel="Search projects"
              clearAccessibilityLabel="Clear project search"
              placeholder="Search projects or environments"
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <SettingsSection>
            <SettingsSwitchRow
              icon="folder"
              label="All projects"
              value={allSelected}
              disabled={available.length === 0 || (!allSelected && overLimit)}
              onValueChange={(checked) =>
                onChange(
                  checked
                    ? selectAllBotProjects(value, options)
                    : value.filter(
                        (access) =>
                          !available.some((option) => option.key === botProjectKey(access)),
                      ),
                )
              }
            />
            <SettingsSwitchRow
              icon="line.3.horizontal.decrease"
              label="Selected only"
              value={selectedOnly}
              onValueChange={setSelectedOnly}
            />
            <SettingsActionRow
              icon="xmark"
              label="Clear selection"
              disabled={value.length === 0}
              onPress={() => onChange([])}
            />
          </SettingsSection>
          {atLimit || overLimit ? (
            <Text className="px-1 text-xs text-foreground-muted">
              Choose up to {BOT_PROJECT_SELECTION_LIMIT} projects.
            </Text>
          ) : null}
        </View>
        <LegendList
          className="flex-1"
          data={filtered}
          extraData={value}
          keyExtractor={(item) => item.key}
          estimatedItemSize={72}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}
          ListEmptyComponent={
            <Text className="py-12 text-center text-sm text-foreground-muted">
              {query
                ? "No matching projects."
                : selectedOnly
                  ? "No projects selected."
                  : "No projects available."}
            </Text>
          }
          renderItem={({ item, index }) => {
            const checked = selected.has(item.key);
            const disabled = !checked && (atLimit || !item.available);
            const startsEnvironment =
              filtered[index - 1]?.access.environmentId !== item.access.environmentId;
            return (
              <View>
                {startsEnvironment ? (
                  <Text
                    accessibilityRole="header"
                    className="px-1 pb-2 pt-4 text-xs font-t3-medium text-foreground-muted"
                  >
                    {item.environmentLabel}
                  </Text>
                ) : null}
                <MaterialListRow
                  className="bg-sheet-solid"
                  title={item.title}
                  subtitle={item.available ? item.path : "Unavailable. Deselect to remove access."}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled }}
                  disabled={disabled}
                  onPress={() => onChange(toggleBotProject(value, item.access))}
                  trailing={
                    <SymbolView
                      name={checked ? "checkmark.circle" : "circle"}
                      size={22}
                      tintColorClassName={checked ? "accent-focus" : "accent-icon-muted"}
                    />
                  }
                />
              </View>
            );
          }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}
