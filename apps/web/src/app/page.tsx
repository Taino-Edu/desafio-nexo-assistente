import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(user.role === "employee" ? "/atendimento" : "/console");
}
