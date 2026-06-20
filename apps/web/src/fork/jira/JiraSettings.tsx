import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { CheckIcon, LoaderIcon, PlugZapIcon, Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { normalizeJiraSiteUrl } from "./jiraConfig";
import { jiraEnvironment } from "./jiraState";

type JiraSettingsForm = {
  readonly siteUrl: string;
  readonly email: string;
  readonly apiToken: string;
};

function fieldValue(value: string): string {
  return value.trim();
}

export function JiraSettingsPanel() {
  const settings = usePrimarySettings();

  return (
    <JiraSettingsPanelContent
      key={[
        settings.fork.jira.siteUrl,
        settings.fork.jira.email,
        settings.fork.jira.apiTokenRedacted === true ? "token" : "no-token",
      ].join("\n")}
      settings={settings}
    />
  );
}

function JiraSettingsPanelContent(props: { readonly settings: UnifiedSettings }) {
  const settings = props.settings;
  const updateSettings = useUpdatePrimarySettings();
  const primaryEnvironment = usePrimaryEnvironment();
  const validateConnection = useAtomCommand(jiraEnvironment.validateConnection, {
    reportFailure: false,
  });
  const [form, setForm] = useState<JiraSettingsForm>(() => ({
    siteUrl: settings.fork.jira.siteUrl,
    email: settings.fork.jira.email,
    apiToken: "",
  }));
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const patchForm = useCallback((patch: Partial<JiraSettingsForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  const buildSavedJiraSettings = useCallback(() => {
    const normalizedSiteUrl = normalizeJiraSiteUrl(form.siteUrl);
    const apiToken = form.apiToken.trim();
    return {
      siteUrl: normalizedSiteUrl,
      email: fieldValue(form.email),
      apiToken,
      ...(apiToken.length === 0 && settings.fork.jira.apiTokenRedacted
        ? { apiTokenRedacted: true }
        : {}),
    };
  }, [form, settings.fork.jira.apiTokenRedacted]);

  const handleSave = useCallback(() => {
    try {
      const jira = buildSavedJiraSettings();
      updateSettings({
        fork: {
          ...settings.fork,
          jira,
        },
      });
      setForm({
        siteUrl: jira.siteUrl,
        email: jira.email,
        apiToken: "",
      });
      toastManager.add({
        type: "success",
        title: "Jira settings saved",
      });
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not save Jira settings",
          description: error instanceof Error ? error.message : "Invalid Jira settings.",
        }),
      );
    }
  }, [buildSavedJiraSettings, settings.fork, updateSettings]);

  const handleTestConnection = useCallback(async () => {
    if (!primaryEnvironment) return;
    setIsTestingConnection(true);
    try {
      const siteUrl = normalizeJiraSiteUrl(form.siteUrl);
      const result = await validateConnection({
        environmentId: primaryEnvironment.environmentId,
        input: {
          siteUrl,
          email: fieldValue(form.email),
          apiToken: form.apiToken.trim(),
          apiTokenRedacted:
            form.apiToken.trim().length === 0 && settings.fork.jira.apiTokenRedacted === true,
        },
      });
      if (result._tag === "Success") {
        toastManager.add({
          type: "success",
          title: "Jira connection works",
          description: `Authenticated as ${result.value.displayName}.`,
        });
      } else {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Jira connection failed",
            description: error instanceof Error ? error.message : "Could not validate Jira.",
          }),
        );
      }
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Jira connection failed",
          description: error instanceof Error ? error.message : "Invalid Jira settings.",
        }),
      );
    }
    setIsTestingConnection(false);
  }, [
    form.apiToken,
    form.email,
    form.siteUrl,
    primaryEnvironment,
    settings.fork.jira.apiTokenRedacted,
    validateConnection,
  ]);

  const handleClear = useCallback(() => {
    setForm({
      siteUrl: "",
      email: "",
      apiToken: "",
    });
    updateSettings({
      fork: {
        ...settings.fork,
        jira: {
          ...DEFAULT_UNIFIED_SETTINGS.fork.jira,
          apiToken: "",
        },
      },
    });
  }, [settings.fork, updateSettings]);

  const tokenStatus = settings.fork.jira.apiTokenRedacted
    ? "A token is stored. Enter a new token to replace it."
    : "Paste an Atlassian API token.";

  return (
    <div className="scrollbar-gutter-both flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <section className="space-y-2">
          <div className="px-1">
            <h1 className="text-lg font-semibold tracking-tight">Jira</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect Jira Cloud with an Atlassian email and API token.
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid gap-4 border-b border-border/70 p-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
              <label className="text-sm font-medium text-foreground" htmlFor="jira-site-url">
                Site URL
              </label>
              <Input
                id="jira-site-url"
                nativeInput
                value={form.siteUrl}
                placeholder="https://example.atlassian.net"
                onChange={(event) => patchForm({ siteUrl: event.currentTarget.value })}
              />
            </div>
            <div className="grid gap-4 border-b border-border/70 p-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
              <label className="text-sm font-medium text-foreground" htmlFor="jira-email">
                Email
              </label>
              <Input
                id="jira-email"
                nativeInput
                type="email"
                value={form.email}
                placeholder="you@example.com"
                onChange={(event) => patchForm({ email: event.currentTarget.value })}
              />
            </div>
            <div className="grid gap-4 border-b border-border/70 p-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
              <label className="pt-1 text-sm font-medium text-foreground" htmlFor="jira-token">
                API token
              </label>
              <div className="space-y-1.5">
                <Input
                  id="jira-token"
                  nativeInput
                  type="password"
                  value={form.apiToken}
                  placeholder={settings.fork.jira.apiTokenRedacted ? "Configured" : ""}
                  onChange={(event) => patchForm({ apiToken: event.currentTarget.value })}
                />
                <p className="text-xs text-muted-foreground/75">{tokenStatus}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2 px-1">
          <Button size="sm" onClick={handleSave}>
            <CheckIcon className="size-4" />
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isTestingConnection || !primaryEnvironment}
            onClick={() => void handleTestConnection()}
          >
            {isTestingConnection ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <PlugZapIcon className="size-4" />
            )}
            Test connection
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClear}>
            <Trash2Icon className="size-4" />
            Clear integration
          </Button>
        </div>
      </div>
    </div>
  );
}
