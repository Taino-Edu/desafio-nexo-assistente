import { redirect } from "next/navigation";
import { requireAnalyst } from "@/server/auth";
import { listConversations } from "@/server/store";
import { Console } from "./console";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const user = await requireAnalyst();
  if (!user) redirect("/login");
  return <Console analyst={user.analyst} initial={listConversations()} />;
}
