"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { login, type LoginState } from "./actions";

const DEMO_USERS = [
  { email: "ana.souza@nexo.com.br", label: "Ana Souza · funcionária" },
  { email: "diego.ramos@nexo.com.br", label: "Diego Ramos · funcionário" },
  { email: "rafael.lima@nexo.com.br", label: "Rafael Lima · analista N2" },
];

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null, email: "" });
  const [email, setEmail] = useState(state.email);
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);

  return (
    <form action={action} className="flex w-full max-w-[380px] flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[40px] leading-[1.1] tracking-[-0.8px]">Entrar</h1>
        <p className="text-[15.5px] leading-normal text-ink-3">Use seu e-mail corporativo e a senha da rede Nexo.</p>
      </div>

      <div className="flex flex-col gap-[18px]">
        <label className="flex flex-col gap-2">
          <span className="text-[13.5px] font-medium">E-mail corporativo</span>
          <span className="flex h-11 items-center gap-2.5 rounded-lg border border-line bg-paper pr-2 pl-3.5 focus-within:border-cta">
            <Mail size={16} className="text-ink-3" />
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@nexo.com.br"
              className="w-full bg-transparent text-[14.5px] outline-none placeholder:text-ink-3"
            />
          </span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="flex justify-between text-[13.5px] font-medium">
            Senha
            <span className="text-primary-text" title="Na demonstração qualquer senha funciona">
              Esqueci minha senha
            </span>
          </span>
          <span className="flex h-11 items-center gap-2.5 rounded-lg border border-line bg-paper pr-2 pl-3.5 focus-within:border-cta">
            <LockKeyhole size={16} className="text-ink-3" />
            <input
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              placeholder="Qualquer senha na demonstração"
              className="w-full bg-transparent text-[14.5px] outline-none placeholder:text-ink-3"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="grid size-[30px] place-items-center rounded-md text-ink-3 hover:bg-desk"
              aria-label={show ? "Ocultar senha" : "Mostrar senha"}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-[9px] pt-0.5 text-[13.5px] text-ink-2">
          <input type="checkbox" name="remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="sr-only" />
          <span className={`grid size-[18px] place-items-center rounded-md border ${remember ? "border-cta bg-cta" : "border-line bg-paper"}`}>
            {remember && <Check size={12} className="text-white" strokeWidth={3} />}
          </span>
          Manter conectado neste computador
        </label>
      </div>

      {state.error && (
        <p role="alert" className="-mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13.5px] text-danger-text">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex h-11 items-center justify-center gap-2 rounded-lg bg-cta text-[15.5px] font-semibold text-white hover:bg-cta-hover disabled:opacity-70"
      >
        {pending ? "Entrando…" : "Entrar"}
        <ArrowRight size={16} />
      </button>

      <div className="rounded-lg border border-dashed border-line p-3 text-[12.5px] text-ink-3">
        <p className="mb-1.5 font-medium text-ink-2">Contas de demonstração (qualquer senha)</p>
        <ul className="flex flex-col gap-1">
          {DEMO_USERS.map((u) => (
            <li key={u.email}>
              <button type="button" onClick={() => setEmail(u.email)} className="text-left hover:text-primary-text">
                <span className="font-data">{u.email}</span> · {u.label.split(" · ")[1]}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
