import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ANALYSTS, EMPLOYEES, type Analyst, type Employee } from "@nexo/shared";
import { env } from "./env";
import { createSession, deleteSession, getSession } from "./store";

// Login de demonstração: aceita qualquer senha para os e-mails dos dados de
// exemplo (é o que o PRD pede). A sessão, porém, é tratada com cuidado:
// cookie HttpOnly, assinado com HMAC e guardado no banco, para que o servidor
// sempre saiba quem está falando, sem confiar no que vem do navegador.

const COOKIE = "nexo_session";

export type CurrentUser =
  | { role: "employee"; sessionId: string; employee: Employee }
  | { role: "analyst"; sessionId: string; analyst: Analyst };

function sign(value: string): string {
  return createHmac("sha256", env().SESSION_SECRET).update(value).digest("base64url");
}

function verify(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export function findUserByEmail(email: string): { role: "employee" | "analyst"; id: string } | null {
  const normalized = email.trim().toLowerCase();
  const employee = EMPLOYEES.find((e) => e.email === normalized);
  if (employee) return { role: "employee", id: employee.id };
  const analyst = ANALYSTS.find((a) => a.email === normalized);
  if (analyst) return { role: "analyst", id: analyst.id };
  return null;
}

export async function signIn(user: { role: "employee" | "analyst"; id: string }, remember: boolean): Promise<void> {
  const sessionId = createSession(user.id, user.role);
  (await cookies()).set(COOKIE, `${sessionId}.${sign(sessionId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const id = token ? verify(token) : null;
  if (id) deleteSession(id);
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  const id = token ? verify(token) : null;
  const session = id ? getSession(id) : null;
  if (!session) return null;
  if (session.role === "employee") {
    const employee = EMPLOYEES.find((e) => e.id === session.userId);
    return employee ? { role: "employee", sessionId: session.id, employee } : null;
  }
  const analyst = ANALYSTS.find((a) => a.id === session.userId);
  return analyst ? { role: "analyst", sessionId: session.id, analyst } : null;
}

export async function requireEmployee() {
  const user = await currentUser();
  return user?.role === "employee" ? user : null;
}

export async function requireAnalyst() {
  const user = await currentUser();
  return user?.role === "analyst" ? user : null;
}
