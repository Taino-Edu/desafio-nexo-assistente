import { redirect } from "next/navigation";
import { requireEmployee } from "@/server/auth";
import { EmployeeShell, TopBar } from "@/components/employee-shell";

export default async function PerfilPage() {
  const user = await requireEmployee();
  if (!user) redirect("/login");
  const e = user.employee;

  const row = "flex flex-col gap-1.5 border-t border-rule py-4 sm:flex-row sm:items-center sm:gap-6";
  return (
    <EmployeeShell employee={e} active="perfil">
      <TopBar here="Meu perfil" />
      <main className="mx-auto w-full max-w-[640px] px-5 py-10">
        <h1 className="font-display text-[32px] tracking-[-0.6px]">Meu perfil</h1>
        <p className="mt-1 text-[14.5px] text-ink-3">Seus dados de acesso ao service desk de TI.</p>
        <div className="mt-8">
          <div className={row}>
            <span className="w-48 text-[13.5px] text-ink-3">Nome</span>
            <span className="text-[14.5px] font-medium">{e.name}</span>
          </div>
          <div className={row}>
            <span className="w-48 text-[13.5px] text-ink-3">E-mail corporativo</span>
            <span className="flex flex-1 items-center justify-between gap-3 text-[14.5px] font-medium">
              {e.email}
              <span className="rounded-full bg-desk px-2.5 py-1 text-[12px] font-medium text-ink-3">Gerenciado pela TI</span>
            </span>
          </div>
          <div className={row}>
            <span className="w-48 text-[13.5px] text-ink-3">Área</span>
            <span className="text-[14.5px] font-medium">{e.department}</span>
          </div>
          <div className={row}>
            <span className="w-48 text-[13.5px] text-ink-3">Equipamento</span>
            <span className="text-[14.5px] font-medium">{e.device}</span>
          </div>
          <div className={`${row} border-b`}>
            <span className="w-48 text-[13.5px] text-ink-3">Senha</span>
            <span className="flex flex-1 flex-col gap-1">
              <span className="text-[14.5px] font-medium">Alterada há 42 dias</span>
              <span className="text-[12.5px] text-ink-3">A troca de senha é feita em senha.nexo.com.br (veja a central de ajuda).</span>
            </span>
          </div>
        </div>
      </main>
    </EmployeeShell>
  );
}
