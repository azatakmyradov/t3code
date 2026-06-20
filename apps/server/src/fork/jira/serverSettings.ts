/**
 * Fork seam for Jira API-token secret handling in server settings.
 *
 * Owns the materialize / persist / redact / clear-redaction logic for the Jira
 * `apiToken`, mirroring upstream's `materializeProviderEnvironmentSecrets` /
 * `persistProviderEnvironmentSecrets`. Upstream `serverSettings.ts` binds these
 * once and keeps its existing `.flatMap(...)` / redaction call sites, so a
 * future upstream pipeline refactor conflicts only on the thin hook lines.
 */
import { type ServerSettings, type ServerSettingsError, type ServerSettingsPatch } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ServerSecretStoreShape } from "../../auth/ServerSecretStore.ts";

const JIRA_API_TOKEN_SECRET_NAME = "fork-jira-api-token";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type ToSettingsError = (detail: string, cause: unknown) => ServerSettingsError;

/** Redact the Jira `apiToken` from a settings object before it leaves the server. */
export function forkRedactJiraSettingsForClient(settings: ServerSettings): ServerSettings {
  const jira = settings.fork.jira;
  const hasToken = jira.apiToken.length > 0 || jira.apiTokenRedacted === true;
  const { apiTokenRedacted: _omit, ...withoutRedaction } = jira;
  return {
    ...settings,
    fork: {
      ...settings.fork,
      jira: {
        ...withoutRedaction,
        apiToken: "",
        ...(hasToken ? { apiTokenRedacted: true } : {}),
      },
    },
  };
}

/**
 * When a settings patch clears the Jira token (explicit empty string and not
 * flagged redacted), drop the redaction marker so the cleared state persists.
 */
export function forkClearJiraRedactionWhenRequested(
  patch: ServerSettingsPatch,
  next: ServerSettings,
): ServerSettings {
  const jiraPatch = patch.fork?.jira;
  if (
    jiraPatch?.apiToken === undefined ||
    jiraPatch.apiToken.trim().length > 0 ||
    jiraPatch.apiTokenRedacted === true
  ) {
    return next;
  }

  const { apiTokenRedacted: _omit, ...jiraWithoutRedaction } = next.fork.jira;
  return {
    ...next,
    fork: {
      ...next.fork,
      jira: jiraWithoutRedaction,
    },
  };
}

/** Bind the Jira-token materializer to a secret store and error constructor. */
export const forkMaterializeJiraSecret =
  (secretStore: ServerSecretStoreShape, toSettingsError: ToSettingsError) =>
  (settings: ServerSettings): Effect.Effect<ServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      if (settings.fork.jira.apiTokenRedacted !== true) {
        return settings;
      }

      const secret = yield* secretStore
        .get(JIRA_API_TOKEN_SECRET_NAME)
        .pipe(
          Effect.mapError((cause) =>
            toSettingsError("failed to read Jira API token secret", cause),
          ),
        );

      return {
        ...settings,
        fork: {
          ...settings.fork,
          jira: {
            ...settings.fork.jira,
            apiToken: secret ? textDecoder.decode(secret) : "",
          },
        },
      };
    });

/** Bind the Jira-token persister to a secret store and error constructor. */
export const forkPersistJiraSecret =
  (secretStore: ServerSecretStoreShape, toSettingsError: ToSettingsError) =>
  (next: ServerSettings): Effect.Effect<ServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const jira = next.fork.jira;
      const token = jira.apiToken.trim();

      if (token.length > 0) {
        yield* secretStore
          .set(JIRA_API_TOKEN_SECRET_NAME, textEncoder.encode(token))
          .pipe(
            Effect.mapError((cause) => toSettingsError("failed to persist Jira API token", cause)),
          );
        return {
          ...next,
          fork: {
            ...next.fork,
            jira: {
              ...jira,
              apiToken: "",
              apiTokenRedacted: true,
            },
          },
        };
      }

      if (jira.apiTokenRedacted === true) {
        return {
          ...next,
          fork: {
            ...next.fork,
            jira: {
              ...jira,
              apiToken: "",
              apiTokenRedacted: true,
            },
          },
        };
      }

      yield* secretStore
        .remove(JIRA_API_TOKEN_SECRET_NAME)
        .pipe(
          Effect.mapError((cause) => toSettingsError("failed to remove Jira API token", cause)),
        );
      const { apiTokenRedacted: _omit, ...withoutRedaction } = jira;
      return {
        ...next,
        fork: {
          ...next.fork,
          jira: {
            ...withoutRedaction,
            apiToken: "",
          },
        },
      };
    });
