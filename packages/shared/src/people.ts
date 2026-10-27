// Diretório fictício da Nexo usado nos dados de exemplo. Os dois serviços
// precisam dos mesmos IDs: o web para o login e o de chamados para o seed.

export type Employee = {
  id: string;
  name: string;
  email: string;
  department: string;
  /** Equipamento principal; o agent usa para saber se um artigo se aplica. */
  device: string;
};

export type Analyst = {
  id: string;
  name: string;
  email: string;
  level: "N1" | "N2";
};

export const EMPLOYEES: Employee[] = [
  { id: "u-ana", name: "Ana Souza", email: "ana.souza@nexo.com.br", department: "Financeiro", device: "Notebook Dell Latitude · Windows 11" },
  { id: "u-carla", name: "Carla Mendes", email: "carla.mendes@nexo.com.br", department: "Comercial", device: "Notebook Lenovo ThinkPad · Windows 10" },
  { id: "u-bruno", name: "Bruno Tavares", email: "bruno.tavares@nexo.com.br", department: "Marketing", device: "MacBook Air · macOS" },
  { id: "u-diego", name: "Diego Ramos", email: "diego.ramos@nexo.com.br", department: "Operações", device: "Desktop Dell OptiPlex · Windows 10" },
  { id: "u-elisa", name: "Elisa Prado", email: "elisa.prado@nexo.com.br", department: "Pessoas", device: "Notebook Dell Latitude · Windows 11" },
];

export const ANALYSTS: Analyst[] = [
  { id: "a-rafael", name: "Rafael Lima", email: "rafael.lima@nexo.com.br", level: "N2" },
  { id: "a-juliana", name: "Juliana Costa", email: "juliana.costa@nexo.com.br", level: "N1" },
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}
