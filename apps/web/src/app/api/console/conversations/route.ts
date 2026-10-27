import { requireAnalyst } from "@/server/auth";
import { listConversations } from "@/server/store";

export async function GET() {
  const user = await requireAnalyst();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ conversations: listConversations() });
}
