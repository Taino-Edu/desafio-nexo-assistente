// Modelo de linguagem falso para testes: segue um roteiro de passos (chamar
// ferramentas ou escrever texto). Assim os testes exercitam o turno inteiro
// (Mastra, ferramentas, regras, banco, stream) sem rede, custo ou acaso.

export type ScriptStep =
  | { tools: { name: string; input: Record<string, unknown> }[] }
  | { text: string };

type CallOptions = { toolChoice?: unknown; prompt?: unknown };

export function scriptedModel(steps: ScriptStep[]) {
  const calls: CallOptions[] = [];
  let index = 0;

  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };

  const model = {
    specificationVersion: "v2" as const,
    provider: "roteiro",
    modelId: "roteiro-de-teste",
    supportedUrls: {},
    async doGenerate(): Promise<never> {
      throw new Error("scriptedModel só implementa streaming");
    },
    async doStream(options: CallOptions) {
      calls.push(options);
      const step = steps[index++] ?? { text: "" };
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      if ("tools" in step) {
        step.tools.forEach((t, i) =>
          parts.push({ type: "tool-call", toolCallId: `call-${index}-${i}`, toolName: t.name, input: JSON.stringify(t.input) }),
        );
        parts.push({ type: "finish", finishReason: "tool-calls", usage });
      } else {
        parts.push({ type: "text-start", id: "t" });
        for (const word of step.text.split(/(?<= )/)) parts.push({ type: "text-delta", id: "t", delta: word });
        parts.push({ type: "text-end", id: "t" });
        parts.push({ type: "finish", finishReason: "stop", usage });
      }
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
      };
    },
  };

  return { model, calls, remaining: () => steps.length - index };
}
