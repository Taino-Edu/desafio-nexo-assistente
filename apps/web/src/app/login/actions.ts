"use server";

import { redirect } from "next/navigation";
import { findUserByEmail, signIn, signOut } from "@/server/auth";

export type LoginState = { error: string | null; email: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Informe o e-mail e a senha.", email };

  const user = findUserByEmail(email);
  if (!user) return { error: "Não encontramos esse e-mail corporativo.", email };

  await signIn(user, form.get("remember") === "on");
  redirect(user.role === "employee" ? "/atendimento" : "/console");
}

export async function logout(): Promise<void> {
  await signOut();
  redirect("/login");
}
