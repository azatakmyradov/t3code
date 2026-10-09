# Bots

A bot is a persistent assistant with its own conversation, memory, routines, and task threads.

Create one from the **Bots** section in the sidebar. Choose its home environment, default model, and projects, then teach its role in its main conversation: what to handle, when to follow up, and what to remember. On mobile, bots appear on Home above your threads.

## Conversations and tasks

Select a bot to open its main conversation, where it posts replies, updates, and results. The details panel lists its task threads. Choose **New thread** there, or right-click the bot, to start a separate job; the bot can also start tasks itself. On mobile, touch and hold the bot, or use the chat menu, and choose **Threads & bot settings**.

Bots can delegate to other configured providers and ask other bots for help when those bots allow requests.

## Profile and memory

Bots save useful preferences, facts, and workflow lessons as they work. Choose **Profile & memory** to review, edit, or clear them, or just tell the bot when something changes or should be forgotten.

Set a check-in interval in the profile to have the bot periodically decide whether work is needed. Leave it blank to turn check-ins off. Ask the bot to create a routine or webhook event, or use **Routines & events** to manage them. Proactive work needs the bot's home server to stay online.

**Pause bot** interrupts the main conversation and active tasks; **Resume bot** allows new work again. Changing project access or authority also stops active tasks so they restart with the new permissions. Deleting a bot removes its profile, memory, and routines and archives its main conversation. Task threads stay in their projects.

## Permissions

Set the bot's authority with the access selector in its main conversation's message box. It applies to proactive work, new tasks, and delegated work. Task threads can use a narrower mode but never a broader one. New bots start with approval required; use **Review request** or open the task to answer an approval.

**All projects** selects the projects currently connected to your client. New projects must be selected before the bot can use them. Project selection limits T3's project and thread tools only; it is not a filesystem sandbox for a provider's own tools. Choose a narrower mode when you want approvals.

## Remote environments

1. Add the environment in **Connections**.
2. In **Profile & memory**, choose it under **Remote environments** and select **Grant access**. Your connection must be allowed to manage access there.
3. Select the remote projects the bot may use.

The bot can then start tasks there, or you can pick that workspace in **New thread**. Results and saved notes return to the home bot. A remote task can't start more tasks, ask other bots, or create routines; it includes those needs in its result so the main conversation can act on them. Once its result returns, a remote task thread becomes an ordinary thread on that environment: follow-ups you send there no longer report to the bot. Both servers must support bots, the home server must be able to reach the connection's address, and the destination needs its own configured provider.

**Disconnect** stops the bot's remote tasks and removes its credential. If the destination becomes unreachable, its tasks stop after two minutes. If the credential expires or is revoked, grant access again and restart affected tasks.
