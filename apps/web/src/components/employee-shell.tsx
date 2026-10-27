import Link from "next/link";
import { ChevronRight, LogOut, MessageSquare, User } from "lucide-react";
import { initials, type Employee } from "@nexo/shared";
import { logout } from "@/app/login/actions";
import { NexoMark } from "./nexo-mark";

// Moldura das telas do funcionário (Telas 2, 3 e Meu perfil).
export function EmployeeShell({
  employee,
  active,
  children,
}: {
  employee: Employee;
  active: "atendimento" | "perfil";
  children: React.ReactNode;
}) {
  const nav = [
    { key: "atendimento", href: "/atendimento", label: "Atendimento", Icon: MessageSquare },
    { key: "perfil", href: "/perfil", label: "Meu perfil", Icon: User },
  ] as const;

  return (
    <div className="flex h-screen bg-paper">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-rule px-3.5 pt-5 pb-3.5 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <NexoMark size={20} />
          <span className="text-base font-bold tracking-[-0.2px]">Nexo Assist</span>
        </div>
        <nav className="mt-[22px] flex flex-col gap-0.5">
          {nav.map(({ key, href, label, Icon }) => (
            <Link
              key={key}
              href={href}
              className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] ${
                active === key ? "bg-primary-soft font-semibold text-primary-text" : "font-medium text-ink-2 hover:bg-desk"
              }`}
            >
              <Icon size={16} className={active === key ? "text-primary-text" : "text-ink-3"} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 border-t border-rule px-2 pt-3.5 pb-1">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-primary-soft text-[12.5px] font-bold text-primary-text">
            {initials(employee.name)}
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-[13.5px] font-semibold">{employee.name}</span>
            <span className="truncate text-[11.5px] text-ink-3">{employee.email}</span>
          </span>
        </div>
        <form action={logout}>
          <button className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium text-ink-2 hover:bg-desk">
            <LogOut size={16} className="text-ink-3" />
            Sair
          </button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function TopBar({ here, children }: { here: string; children?: React.ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-rule px-5 md:px-8">
      <p className="flex flex-1 items-center gap-2 text-[13.5px]">
        <span className="text-ink-3">Service desk de TI</span>
        <ChevronRight size={14} className="text-ink-3" />
        <span className="font-semibold">{here}</span>
      </p>
      {children}
      <form action={logout} className="md:hidden">
        <button className="text-[13px] text-ink-3">Sair</button>
      </form>
    </header>
  );
}
