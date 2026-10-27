// O agent é instruído a responder em texto simples, mas se vier um **negrito**
// de Markdown ele é exibido como negrito em vez de asteriscos.
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : p,
      )}
    </>
  );
}
