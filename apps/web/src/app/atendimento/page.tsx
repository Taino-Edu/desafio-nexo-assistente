import { redirect } from "next/navigation";
import { requireEmployee } from "@/server/auth";
import { SESSION_MESSAGE_LIMIT } from "@/server/agent/run-turn";
import {
  countEmployeeMessagesInSession,
  getOrCreateActiveConversation,
  listDecisions,
  listMessages,
  withLiveDrafts,
} from "@/server/store";
import { EmployeeShell } from "@/components/employee-shell";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";

export default async function AtendimentoPage() {
  const user = await requireEmployee();
  if (!user) redirect("/login");
  const conversation = getOrCreateActiveConversation(user.employee.id);

  return (
    <EmployeeShell employee={user.employee} active="atendimento">
      <Chat
        initial={{
          conversation: { id: conversation.id, status: conversation.status, transferDeadline: conversation.transferDeadline },
          messages: withLiveDrafts(listMessages(conversation.id)),
          decisions: listDecisions(conversation.id),
          session: { used: countEmployeeMessagesInSession(user.sessionId), limit: SESSION_MESSAGE_LIMIT },
        }}
      />
    </EmployeeShell>
  );
}
