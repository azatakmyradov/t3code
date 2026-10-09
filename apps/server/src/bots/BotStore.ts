import {
  BOT_NAVIGATION_THREAD_LIMIT,
  BotError,
  BotMessage,
  BotProfile,
  BotSummary,
  BotTask,
  BotTaskStartInput,
  BotConnection,
  BotNavigationThread,
  type BotId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const decodeBot = Schema.decodeUnknownEffect(Schema.fromJsonString(BotProfile));
const decodeTask = Schema.decodeUnknownEffect(Schema.fromJsonString(BotTask));
const decodeConnection = Schema.decodeUnknownEffect(Schema.fromJsonString(BotConnection));
const isBotError = Schema.is(BotError);
const decodeMessage = Schema.decodeUnknownEffect(Schema.fromJsonString(BotMessage));
const encodeMessage = Schema.encodeEffect(Schema.fromJsonString(BotMessage));
const encodeBot = Schema.encodeEffect(Schema.fromJsonString(BotProfile));
const encodeTask = Schema.encodeEffect(Schema.fromJsonString(BotTask));
const encodeLaunch = Schema.encodeEffect(Schema.fromJsonString(BotTaskStartInput));
const decodeLaunch = Schema.decodeUnknownEffect(Schema.fromJsonString(BotTaskStartInput));
const unavailable = (cause: unknown) => new BotError({ code: "unavailable", cause });

/** The home bot context a destination task runs under, owned by one paired session. */
interface BotGuest {
  readonly bot: BotProfile;
  readonly sessionId: string;
  readonly expires: string;
}

export class BotStore extends Context.Service<
  BotStore,
  {
    readonly messages: (botId: BotId) => Effect.Effect<ReadonlyArray<BotMessage>, BotError>;
    readonly addMessage: (botId: BotId, message: BotMessage) => Effect.Effect<boolean, BotError>;
    /** Ids of user messages whose answer has not been recorded yet. */
    readonly pendingMessages: (botId: BotId) => Effect.Effect<ReadonlyArray<string>, BotError>;
    readonly markAnswered: (id: string) => Effect.Effect<void, BotError>;
    readonly message: (id: string) => Effect.Effect<BotMessage | null, BotError>;
    readonly list: () => Effect.Effect<ReadonlyArray<BotSummary>, BotError>;
    /** Each bot's most recent task threads plus every unfinished one, newest first. */
    readonly navigationThreads: () => Effect.Effect<ReadonlyArray<BotNavigationThread>, BotError>;
    readonly get: (id: BotId) => Effect.Effect<BotProfile, BotError>;
    readonly forThread: (threadId: ThreadId) => Effect.Effect<BotProfile | null, BotError>;
    readonly save: (bot: BotProfile, expectedRevision?: number) => Effect.Effect<void, BotError>;
    /** The bot's latest tasks, plus every older task still awaiting its result. */
    readonly tasks: (botId: BotId) => Effect.Effect<ReadonlyArray<BotTask>, BotError>;
    /** Tasks whose result has not been reported to the bot yet. */
    readonly activeTasks: (botId: BotId) => Effect.Effect<ReadonlyArray<BotTask>, BotError>;
    /** Tasks whose latest known result was already reported to the bot. */
    readonly reportedTasks: (botId: BotId) => Effect.Effect<ReadonlyArray<BotTask>, BotError>;
    /** Requests this bot sent that have no reply yet. */
    readonly pendingRequests: (
      botId: BotId,
    ) => Effect.Effect<ReadonlyArray<{ id: string; targetBotId: BotId; text: string }>, BotError>;
    readonly task: (id: string) => Effect.Effect<BotTask | null, BotError>;
    readonly taskForThread: (id: ThreadId) => Effect.Effect<BotTask | null, BotError>;
    /**
     * Upserts a task. The launch input is kept from the first save so a retry can replay it;
     * a guest records the remote bot context and lease a destination task runs under.
     */
    readonly saveTask: (
      task: BotTask,
      options?: { readonly launchInput?: BotTaskStartInput; readonly guest?: BotGuest },
    ) => Effect.Effect<void, BotError>;
    readonly launchInput: (id: string) => Effect.Effect<BotTaskStartInput | null, BotError>;
    readonly guest: (id: string) => Effect.Effect<BotGuest | null, BotError>;
    readonly syncGuest: (
      id: string,
      bot: BotProfile,
      expires: string,
    ) => Effect.Effect<void, BotError>;
    readonly expiredGuests: (now: string) => Effect.Effect<ReadonlyArray<BotTask>, BotError>;
    /**
     * Keeps a destination task's final state as its session's receipt and detaches its thread,
     * which becomes the destination's own.
     */
    readonly releaseTask: (task: BotTask) => Effect.Effect<void, BotError>;
    readonly request: (
      id: string,
    ) => Effect.Effect<
      { senderBotId: BotId; targetBotId: BotId; text: string; reply: string | null } | null,
      BotError
    >;
    readonly saveRequest: (input: {
      id: string;
      sender: BotId;
      target: BotId;
      text: string;
    }) => Effect.Effect<void, BotError>;
    readonly saveReply: (id: string, text: string) => Effect.Effect<void, BotError>;
    /** Replies to this bot's requests that have not been delivered to it yet. */
    readonly pendingReplies: (
      botId: BotId,
    ) => Effect.Effect<ReadonlyArray<{ id: string; reply: string }>, BotError>;
    readonly markReplyDelivered: (id: string) => Effect.Effect<void, BotError>;
    readonly remove: (id: BotId, revision: number) => Effect.Effect<void, BotError>;
    readonly connections: (botId: BotId) => Effect.Effect<ReadonlyArray<BotConnection>, BotError>;
    readonly saveConnection: (
      botId: BotId,
      connection: BotConnection,
    ) => Effect.Effect<void, BotError>;
    readonly removeConnection: (
      botId: BotId,
      environmentId: string,
    ) => Effect.Effect<void, BotError>;
  }
>()("t3/bots/BotStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const get = Effect.fn("BotStore.get")(function* (id: BotId) {
    const rows = yield* sql<{ body: string }>`SELECT body FROM bots WHERE id = ${id}`.pipe(
      Effect.mapError(unavailable),
    );
    if (!rows[0]) return yield* new BotError({ code: "not_found" });
    return yield* decodeBot(rows[0].body).pipe(Effect.mapError(unavailable));
  });
  const tasks = Effect.fn("BotStore.tasks")(function* (botId: BotId) {
    const rows = yield* sql<{
      body: string;
    }>`SELECT body FROM bot_tasks WHERE bot_id = ${botId} AND (reported = 0 OR rowid IN (
        SELECT rowid FROM bot_tasks WHERE bot_id = ${botId} ORDER BY rowid DESC LIMIT 100
      )) ORDER BY rowid DESC`.pipe(Effect.mapError(unavailable));
    return yield* Effect.forEach(rows, (row) =>
      decodeTask(row.body).pipe(Effect.mapError(unavailable)),
    );
  });
  return BotStore.of({
    get,
    tasks,
    navigationThreads: () =>
      sql`SELECT botId, environmentId, threadId, title FROM (
          SELECT task.bot_id AS botId,
            json_extract(task.body, '$.environmentId') AS environmentId,
            task.thread_id AS threadId,
            json_extract(task.body, '$.title') AS title,
            task.rowid AS position,
            task.reported AS reported,
            ROW_NUMBER() OVER (PARTITION BY task.bot_id ORDER BY task.rowid DESC) AS recency
          FROM bot_tasks task JOIN bots bot ON bot.id = task.bot_id
        )
        WHERE recency <= ${BOT_NAVIGATION_THREAD_LIMIT} OR reported = 0
        ORDER BY position DESC`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(BotNavigationThread))),
        Effect.mapError(unavailable),
      ),
    remove: Effect.fn("BotStore.remove")(function* (id, revision) {
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const rows =
              yield* sql`DELETE FROM bots WHERE id = ${id} AND revision = ${revision} RETURNING id`;
            if (rows.length === 0) return yield* new BotError({ code: "conflict" });
            yield* sql`DELETE FROM bot_messages WHERE bot_id = ${id}`;
            yield* sql`DELETE FROM bot_tasks WHERE bot_id = ${id}`;
            yield* sql`DELETE FROM bot_requests WHERE sender_bot_id = ${id} OR target_bot_id = ${id}`;
            yield* sql`DELETE FROM bot_connections WHERE bot_id = ${id}`;
          }),
        )
        .pipe(Effect.mapError((cause) => (isBotError(cause) ? cause : unavailable(cause))));
    }),
    message: Effect.fn("BotStore.message")(function* (id) {
      const rows = yield* sql<{
        body: string;
      }>`SELECT body FROM bot_messages WHERE id = ${id}`.pipe(Effect.mapError(unavailable));
      return rows[0] === undefined
        ? null
        : yield* decodeMessage(rows[0].body).pipe(Effect.mapError(unavailable));
    }),
    messages: Effect.fn("BotStore.messages")(function* (botId) {
      const rows = yield* sql<{
        body: string;
      }>`SELECT body FROM (SELECT rowid, body FROM bot_messages WHERE bot_id = ${botId} ORDER BY rowid DESC LIMIT 100) ORDER BY rowid`.pipe(
        Effect.mapError(unavailable),
      );
      return yield* Effect.forEach(rows, (row) =>
        decodeMessage(row.body).pipe(Effect.mapError(unavailable)),
      );
    }),
    addMessage: Effect.fn("BotStore.addMessage")(function* (botId, message) {
      const body = yield* encodeMessage(message).pipe(Effect.mapError(unavailable));
      const rows =
        yield* sql`INSERT INTO bot_messages (id, bot_id, body, pending) VALUES (${message.id}, ${botId}, ${body}, ${message.role === "user" ? 1 : 0}) ON CONFLICT(id) DO NOTHING RETURNING id`.pipe(
          Effect.mapError(unavailable),
        );
      return rows.length > 0;
    }),
    pendingMessages: (botId) =>
      sql<{
        id: string;
      }>`SELECT id FROM bot_messages WHERE bot_id = ${botId} AND pending = 1 LIMIT 100`.pipe(
        Effect.map((rows) => rows.map((row) => row.id)),
        Effect.mapError(unavailable),
      ),
    activeTasks: Effect.fn("BotStore.activeTasks")(function* (botId) {
      const rows = yield* sql<{
        body: string;
      }>`SELECT body FROM bot_tasks WHERE bot_id = ${botId} AND reported = 0`.pipe(
        Effect.mapError(unavailable),
      );
      return yield* Effect.forEach(rows, (row) =>
        decodeTask(row.body).pipe(Effect.mapError(unavailable)),
      );
    }),
    reportedTasks: Effect.fn("BotStore.reportedTasks")(function* (botId) {
      const rows = yield* sql<{
        body: string;
      }>`SELECT body FROM bot_tasks WHERE bot_id = ${botId} AND reported = 1`.pipe(
        Effect.mapError(unavailable),
      );
      return yield* Effect.forEach(rows, (row) =>
        decodeTask(row.body).pipe(Effect.mapError(unavailable)),
      );
    }),
    pendingRequests: (botId) =>
      sql<{
        id: string;
        targetBotId: BotId;
        text: string;
      }>`SELECT id, target_bot_id AS targetBotId, text FROM bot_requests WHERE sender_bot_id = ${botId} AND reply IS NULL`.pipe(
        Effect.mapError(unavailable),
      ),
    markAnswered: (id) =>
      sql`UPDATE bot_messages SET pending = 0 WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(unavailable),
      ),
    list: Effect.fn("BotStore.list")(function* () {
      const rows = yield* sql<{ body: string }>`SELECT body FROM bots ORDER BY rowid`.pipe(
        Effect.mapError(unavailable),
      );
      return yield* Effect.forEach(rows, (row) =>
        decodeBot(row.body).pipe(
          Effect.map((bot) => {
            const { memory: _memory, instructions: _instructions, ...summary } = bot;
            return summary;
          }),
          Effect.mapError(unavailable),
        ),
      );
    }),
    forThread: Effect.fn("BotStore.forThread")(function* (threadId) {
      const rows = yield* sql<{
        body: string;
      }>`SELECT body FROM bots WHERE thread_id = ${threadId}`.pipe(Effect.mapError(unavailable));
      if (rows[0]) return yield* decodeBot(rows[0].body).pipe(Effect.mapError(unavailable));
      const task = yield* sql<{
        bot_id: BotId;
        guest_context: string | null;
        guest_expires: string | null;
      }>`SELECT bot_id, guest_context, guest_expires FROM bot_tasks WHERE thread_id = ${threadId}`.pipe(
        Effect.mapError(unavailable),
      );
      if (!task[0]) return null;
      if (task[0].guest_context === null) return yield* get(task[0].bot_id);
      const bot = yield* decodeBot(task[0].guest_context).pipe(Effect.mapError(unavailable));
      const now = DateTime.formatIso(yield* DateTime.now);
      return task[0].guest_expires === null || task[0].guest_expires < now
        ? { ...bot, paused: true }
        : bot;
    }),
    save: Effect.fn("BotStore.save")(function* (bot, expectedRevision) {
      const body = yield* encodeBot(bot).pipe(Effect.mapError(unavailable));
      if (expectedRevision === undefined) {
        yield* sql`INSERT INTO bots (id, thread_id, revision, body) VALUES (${bot.id}, ${bot.threadId}, ${bot.revision}, ${body}) ON CONFLICT(id) DO NOTHING`.pipe(
          Effect.mapError(unavailable),
        );
      } else {
        const rows =
          yield* sql`UPDATE bots SET revision = ${bot.revision}, body = ${body} WHERE id = ${bot.id} AND revision = ${expectedRevision} RETURNING id`.pipe(
            Effect.mapError(unavailable),
          );
        if (rows.length === 0) return yield* new BotError({ code: "conflict" });
      }
    }),
    task: Effect.fn("BotStore.task")(function* (id) {
      const rows = yield* sql<{ body: string }>`SELECT body FROM bot_tasks WHERE id = ${id}`.pipe(
        Effect.mapError(unavailable),
      );
      return rows[0] ? yield* decodeTask(rows[0].body).pipe(Effect.mapError(unavailable)) : null;
    }),
    taskForThread: Effect.fn("BotStore.taskForThread")(function* (id) {
      const rows = yield* sql<{
        body: string;
      }>`SELECT body FROM bot_tasks WHERE thread_id = ${id}`.pipe(Effect.mapError(unavailable));
      return rows[0] ? yield* decodeTask(rows[0].body).pipe(Effect.mapError(unavailable)) : null;
    }),
    saveTask: Effect.fn("BotStore.saveTask")(function* (task, options) {
      const body = yield* encodeTask(task).pipe(Effect.mapError(unavailable));
      const guest = options?.guest;
      const context =
        guest === undefined ? null : yield* encodeBot(guest.bot).pipe(Effect.mapError(unavailable));
      const launchInput =
        options?.launchInput === undefined
          ? null
          : yield* encodeLaunch(options.launchInput).pipe(Effect.mapError(unavailable));
      yield* sql`INSERT INTO bot_tasks (id, bot_id, thread_id, reported, body, guest_context, guest_session, guest_expires, launch_input) VALUES (${task.id}, ${task.botId}, ${task.threadId}, ${task.reported ? 1 : 0}, ${body}, ${context}, ${guest?.sessionId ?? null}, ${guest?.expires ?? null}, ${launchInput}) ON CONFLICT(id) DO UPDATE SET reported = excluded.reported, body = excluded.body, guest_context = COALESCE(excluded.guest_context, guest_context), guest_expires = COALESCE(excluded.guest_expires, guest_expires)`.pipe(
        Effect.mapError(unavailable),
      );
    }),
    launchInput: Effect.fn("BotStore.launchInput")(function* (id) {
      const rows = yield* sql<{
        launch_input: string | null;
      }>`SELECT launch_input FROM bot_tasks WHERE id = ${id}`.pipe(Effect.mapError(unavailable));
      return rows[0]?.launch_input == null
        ? null
        : yield* decodeLaunch(rows[0].launch_input).pipe(Effect.mapError(unavailable));
    }),
    guest: Effect.fn("BotStore.guest")(function* (id) {
      const rows = yield* sql<{
        guest_context: string | null;
        guest_session: string;
        guest_expires: string;
      }>`SELECT guest_context, guest_session, guest_expires FROM bot_tasks WHERE id = ${id}`.pipe(
        Effect.mapError(unavailable),
      );
      return rows[0]?.guest_context == null
        ? null
        : {
            bot: yield* decodeBot(rows[0].guest_context).pipe(Effect.mapError(unavailable)),
            sessionId: rows[0].guest_session,
            expires: rows[0].guest_expires,
          };
    }),
    syncGuest: Effect.fn("BotStore.syncGuest")(function* (id, bot, expires) {
      const body = yield* encodeBot(bot).pipe(Effect.mapError(unavailable));
      yield* sql`UPDATE bot_tasks SET guest_context = ${body}, guest_expires = ${expires} WHERE id = ${id}`.pipe(
        Effect.mapError(unavailable),
      );
    }),
    expiredGuests: Effect.fn("BotStore.expiredGuests")(function* (now) {
      const rows = yield* sql<{
        body: string;
      }>`SELECT body FROM bot_tasks WHERE guest_expires < ${now} AND reported = 0`.pipe(
        Effect.mapError(unavailable),
      );
      return yield* Effect.forEach(rows, (row) =>
        decodeTask(row.body).pipe(Effect.mapError(unavailable)),
      );
    }),
    releaseTask: Effect.fn("BotStore.releaseTask")(function* (task) {
      const body = yield* encodeTask(task).pipe(Effect.mapError(unavailable));
      yield* sql`UPDATE bot_tasks SET thread_id = NULL, reported = 1, body = ${body} WHERE id = ${task.id}`.pipe(
        Effect.mapError(unavailable),
      );
    }),
    request: Effect.fn("BotStore.request")(function* (id) {
      const rows = yield* sql<{
        senderBotId: BotId;
        targetBotId: BotId;
        text: string;
        reply: string | null;
      }>`SELECT sender_bot_id AS senderBotId, target_bot_id AS targetBotId, text, reply FROM bot_requests WHERE id = ${id}`.pipe(
        Effect.mapError(unavailable),
      );
      return rows[0] ?? null;
    }),
    saveRequest: (input) =>
      sql`INSERT INTO bot_requests (id, sender_bot_id, target_bot_id, text) VALUES (${input.id}, ${input.sender}, ${input.target}, ${input.text}) ON CONFLICT(id) DO NOTHING`.pipe(
        Effect.asVoid,
        Effect.mapError(unavailable),
      ),
    saveReply: (id, text) =>
      sql`UPDATE bot_requests SET reply = ${text} WHERE id = ${id} AND (reply IS NULL OR reply = ${text})`.pipe(
        Effect.asVoid,
        Effect.mapError(unavailable),
      ),
    pendingReplies: (botId) =>
      sql<{
        id: string;
        reply: string;
      }>`SELECT id, reply FROM bot_requests WHERE sender_bot_id = ${botId} AND reply IS NOT NULL AND delivered = 0`.pipe(
        Effect.mapError(unavailable),
      ),
    markReplyDelivered: (id) =>
      sql`UPDATE bot_requests SET delivered = 1 WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(unavailable),
      ),
    connections: Effect.fn("BotStore.connections")(function* (botId) {
      const rows = yield* sql<{
        body: string;
      }>`SELECT body FROM bot_connections WHERE bot_id = ${botId}`.pipe(
        Effect.mapError(unavailable),
      );
      return yield* Effect.forEach(rows, (row) =>
        decodeConnection(row.body).pipe(Effect.mapError(unavailable)),
      );
    }),
    saveConnection: (botId, connection) =>
      sql`INSERT INTO bot_connections (bot_id, environment_id, body) VALUES (${botId}, ${connection.environmentId}, ${JSON.stringify(connection)}) ON CONFLICT(bot_id, environment_id) DO UPDATE SET body = excluded.body`.pipe(
        Effect.asVoid,
        Effect.mapError(unavailable),
      ),
    removeConnection: (botId, environmentId) =>
      sql`DELETE FROM bot_connections WHERE bot_id = ${botId} AND environment_id = ${environmentId}`.pipe(
        Effect.asVoid,
        Effect.mapError(unavailable),
      ),
  });
});
export const layer = Layer.effect(BotStore, make);
