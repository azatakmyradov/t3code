import type { BotProfile, BotSummary } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironmentIdentities, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { BotEditor } from "./BotEditor";
import { useOpenBotThread } from "./botCommands";

export function BotProfileDialog({ bot, onClose }: { bot: BotSummary; onClose: () => void }) {
  const detail = useEnvironmentQuery(
    serverEnvironment.bots.detail({ environmentId: bot.environmentId, input: { botId: bot.id } }),
  );
  // The detail query refreshes in the background; the form edits the profile as first loaded.
  const [profile, setProfile] = useState<BotProfile | null>(null);
  if (profile === null && detail.data && !detail.isPending) setProfile(detail.data.bot);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{bot.name}</DialogTitle>
          <DialogDescription>Profile, permissions, and memory.</DialogDescription>
        </DialogHeader>
        {profile ? (
          <BotEditor environmentId={bot.environmentId} bot={profile} onSaved={onClose} />
        ) : (
          <DialogPanel>
            <p
              role={detail.error ? "alert" : "status"}
              className={
                detail.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
              }
            >
              {detail.error ?? "Loading profile…"}
            </p>
          </DialogPanel>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export function NewBotDialog({ onClose }: { onClose: () => void }) {
  const environments = useEnvironmentIdentities();
  const primary = usePrimaryEnvironmentId();
  const environmentId = primary ?? environments[0]?.environmentId ?? null;
  const openThread = useOpenBotThread();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New bot</DialogTitle>
          <DialogDescription>Give it a name, then teach its role through chat.</DialogDescription>
        </DialogHeader>
        {environmentId ? (
          <BotEditor
            environmentId={environmentId}
            bot={null}
            onSaved={async (bot) => {
              onClose();
              await openThread(bot.environmentId, bot.threadId);
            }}
          />
        ) : (
          <DialogPanel>
            <p className="text-sm text-muted-foreground">Connect an environment to create a bot.</p>
          </DialogPanel>
        )}
      </DialogPopup>
    </Dialog>
  );
}
