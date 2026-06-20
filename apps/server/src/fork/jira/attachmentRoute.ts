/**
 * Fork seam for the authenticated Jira attachment image proxy.
 *
 * Jira's `content`/`thumbnail` URLs require Basic auth the browser cannot
 * supply, so the client points `<img>`/links at
 * `${JIRA_ATTACHMENT_ROUTE_PREFIX}/{content|thumbnail}/{restId}` and this route
 * streams the bytes back with the upstream content type. Kept out of upstream
 * `http.ts` entirely; `server.ts` merges `jiraAttachmentRouteLayer` from here.
 */
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
  HttpServerRespondable,
} from "effect/unstable/http";

import { authenticateRawRouteWithScope } from "../../http.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { JIRA_ATTACHMENT_ROUTE_PREFIX } from "./jiraSchemas.ts";
import { normalizeJiraCloudSiteUrl } from "./JiraApi.ts";

class JiraAttachmentSiteUrlError extends Data.TaggedError("JiraAttachmentSiteUrlError")<{
  readonly cause: unknown;
}> {}

/**
 * Authenticated image proxy for Jira attachments. Jira's `content`/`thumbnail`
 * URLs require Basic auth that the browser cannot supply, so the client points
 * `<img>`/links at `${JIRA_ATTACHMENT_ROUTE_PREFIX}/{content|thumbnail}/{restId}`
 * and this route streams the bytes back with the upstream content type.
 */
export const jiraAttachmentRouteLayer = HttpRouter.add(
  "GET",
  `${JIRA_ATTACHMENT_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);

    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const suffix = url.value.pathname.slice(`${JIRA_ATTACHMENT_ROUTE_PREFIX}/`.length);
    const separatorIndex = suffix.indexOf("/");
    if (separatorIndex <= 0) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    const kind = suffix.slice(0, separatorIndex);
    const restIdRaw = suffix.slice(separatorIndex + 1);
    if ((kind !== "content" && kind !== "thumbnail") || restIdRaw.length === 0) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    const restId = decodeURIComponent(restIdRaw);
    // REST attachment ids are simple tokens; reject anything that could escape
    // the attachment path.
    if (!/^[\w.-]+$/u.test(restId)) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null));
    const jira = settings?.fork.jira;
    if (!jira || !jira.siteUrl.trim() || !jira.email.trim() || !jira.apiToken.trim()) {
      return HttpServerResponse.text("Jira is not configured.", { status: 404 });
    }
    const siteUrl = yield* Effect.try({
      try: () => normalizeJiraCloudSiteUrl(jira.siteUrl),
      catch: (cause) => new JiraAttachmentSiteUrlError({ cause }),
    }).pipe(Effect.orElseSucceed(() => null));
    if (siteUrl === null) {
      return HttpServerResponse.text("Jira is not configured.", { status: 404 });
    }

    const authorization = `Basic ${Buffer.from(
      `${jira.email.trim()}:${jira.apiToken.trim()}`,
    ).toString("base64")}`;
    const httpClient = yield* HttpClient.HttpClient;
    const jiraUrl = `${siteUrl}/rest/api/3/attachment/${kind}/${encodeURIComponent(restId)}`;

    return yield* httpClient
      .execute(
        HttpClientRequest.get(jiraUrl).pipe(
          HttpClientRequest.setHeader("authorization", authorization),
        ),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? response.arrayBuffer.pipe(
                Effect.map((buffer) =>
                  HttpServerResponse.uint8Array(new Uint8Array(buffer), {
                    contentType: response.headers["content-type"] ?? "application/octet-stream",
                    headers: {
                      "Cache-Control": "private, max-age=3600",
                      "X-Content-Type-Options": "nosniff",
                    },
                  }),
                ),
              )
            : Effect.succeed(
                HttpServerResponse.text("Attachment not found.", {
                  status: response.status === 404 ? 404 : 502,
                }),
              ),
        ),
        Effect.scoped,
        Effect.orElseSucceed(() =>
          HttpServerResponse.text("Failed to load attachment.", { status: 502 }),
        ),
      );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);
