import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ServerSettings } from "@t3tools/contracts";
import { ListTodoIcon } from "lucide-react";
import { useCallback } from "react";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { usePrimarySettings } from "../hooks/useSettings";
import { isJiraConfigured } from "./jira/jiraConfig";

export function shouldShowJiraSidebarItem(settings: ServerSettings): boolean {
  return isJiraConfigured(settings);
}

export function ForkSidebarNav() {
  const settings = usePrimarySettings();
  const configured = shouldShowJiraSidebarItem(settings);
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleJiraClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/jira" });
  }, [isMobile, navigate, setOpenMobile]);

  if (!configured) {
    return null;
  }

  return (
    <SidebarGroup className="px-2 pt-0 pb-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            isActive={pathname === "/jira"}
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:ring-0 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
            onClick={handleJiraClick}
          >
            <ListTodoIcon className="size-3.5 text-muted-foreground/70" />
            <span className="flex-1 truncate text-left text-xs">Jira</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
