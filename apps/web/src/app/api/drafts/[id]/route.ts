import { z } from "zod";
import { requireEmployee } from "@/server/auth";
import { actOnDraft, DraftActionError } from "@/server/drafts";

const body = z.object({ action: z.enum(["confirmar", "cancelar"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireEmployee();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  try {
    const messages = await actOnDraft(user.employee, (await params).id, parsed.data.action);
    return Response.json({ messages });
  } catch (err) {
    if (err instanceof DraftActionError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[drafts]", err);
    return Response.json({ error: "Erro inesperado." }, { status: 500 });
  }
}
