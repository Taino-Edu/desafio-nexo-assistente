import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { NexoMark } from "@/components/nexo-mark";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.role === "employee" ? "/atendimento" : "/console");

  return (
    <main className="flex min-h-screen">
      {/* Vitrine (Tela 1 do protótipo) */}
      <section className="hidden w-[800px] shrink-0 flex-col justify-between bg-ink px-16 pt-10 pb-12 lg:flex">
        <div className="flex items-center gap-2.5">
          <NexoMark size={24} color="#FFFFFF" />
          <span className="text-[17px] font-bold tracking-[-0.2px] text-white">Nexo Assist</span>
        </div>

        <div className="flex flex-col gap-9">
          <div className="flex flex-col gap-[18px]">
            <p className="text-[13.5px] font-medium text-white/55">Service desk de TI da Nexo</p>
            <h2 className="font-display text-[54px] leading-[1.04] tracking-[-1.2px] text-white">
              Seu problema de TI, resolvido em uma conversa.
            </h2>
            <p className="w-[520px] text-base leading-[1.55] text-white/65">
              Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central de ajuda e chama um analista
              quando precisa.
            </p>
          </div>

          <div className="pl-24">
            <div className="flex w-[500px] flex-col gap-2.5 rounded-2xl border border-white/8 bg-white/4 p-[18px]">
              <div className="flex justify-end">
                <p className="rounded-[12px_12px_4px_12px] bg-paper px-3.5 py-[9px] text-[13.5px]">
                  Meu notebook não conecta na VPN. Erro 809.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="flex gap-1.5 text-[12.5px]">
                  <span className="font-semibold text-white/80">Nexo Assist</span>
                  <span className="text-white/45">consultou seus chamados · criou um chamado</span>
                </p>
                <p className="w-[380px] rounded-[4px_12px_12px_12px] bg-white/8 px-3.5 py-2.5 text-[13.5px] leading-normal text-white">
                  Pronto: abri o chamado com prioridade alta. Um analista fala com você em até 4 h úteis.
                </p>
                <p className="flex w-fit items-center gap-2 rounded-xl bg-paper px-3 py-[7px] text-[12.5px]">
                  <span className="size-[7px] rounded-full bg-warning" />
                  <span className="font-data font-semibold">INC-20517</span>
                  <span className="text-ink-3">Rede e VPN · Alta · em até 4 h</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-3 border-t border-white/10 pt-6">
          {[
            ["8 s", "primeira resposta, em média"],
            ["72%", "resolvidos sem fila"],
            ["6", "analistas online agora"],
          ].map(([value, label], i) => (
            <div key={label} className={`flex flex-col gap-1.5 ${i > 0 ? "border-l border-white/10 pl-6" : ""}`}>
              <dt className="flex items-center gap-2 font-display text-[34px] tracking-[-0.6px] text-white">
                {value}
                {i === 2 && <span className="size-2 rounded-full bg-success" />}
              </dt>
              <dd className="text-[13.5px] text-white/55">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Formulário */}
      <section className="flex flex-1 flex-col px-6 py-10 sm:px-14">
        <p className="flex justify-end gap-1.5 text-[13.5px]">
          <span className="text-ink-3">Problema para entrar?</span>
          <span className="font-semibold text-primary-text">Ligue no ramal 4000</span>
        </p>
        <div className="flex flex-1 items-center justify-center py-10">
          <LoginForm />
        </div>
        <p className="flex justify-between text-[12.5px] text-ink-3">
          <span>© 2026 Nexo · Service desk de TI</span>
          <span>Privacidade e uso de dados</span>
        </p>
      </section>
    </main>
  );
}
