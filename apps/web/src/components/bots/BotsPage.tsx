import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Navigate } from "@tanstack/react-router";
import { BotIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { isElectron } from "../../env";
import { botNavigationAtom } from "../../state/bots";
import { useThreadShell } from "../../state/entities";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { NewBotDialog } from "./BotProfileDialog";

/** `/bots` opens the first bot's main conversation, or invites creating one. */
export function BotsPage() {
  const first = useAtomValue(botNavigationAtom)[0]?.bot;
  const firstThread = useThreadShell(
    first ? scopeThreadRef(first.environmentId, first.threadId) : null,
  );
  const [creating, setCreating] = useState(false);

  // While creating, the dialog navigates to the new bot once its conversation syncs.
  if (first && firstThread && !creating) {
    return (
      <Navigate
        to="/$environmentId/$threadId"
        params={{ environmentId: first.environmentId, threadId: first.threadId }}
        replace
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel="Bots breadcrumb">
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">Bots</h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <Empty size="hero">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BotIcon />
          </EmptyMedia>
          <EmptyTitle>No bots yet</EmptyTitle>
          <EmptyDescription>
            Bots are persistent assistants with their own memory, routines, and task threads.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            New bot
          </Button>
        </EmptyContent>
      </Empty>
      {creating && <NewBotDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
