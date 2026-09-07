import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SchemaForm, type JsonObjectSchema } from "../../src/schema-form/schema-form";

afterEach(() => cleanup());

const FULL_SCHEMA: JsonObjectSchema = {
  type: "object",
  required: ["nome", "senha"],
  properties: {
    nome: { type: "string", title: "Nome" },
    status: { type: "string", enum: ["ativo", "pausado"], title: "Status" },
    dias: { type: "number", title: "Dias" },
    habilitado: { type: "boolean", title: "Habilitado" },
    emails: { type: "array", items: { type: "string" }, title: "E-mails" },
    senha: { type: "string", secret: true, title: "Senha" }
  }
};

describe("SchemaForm", () => {
  it("renderiza todos os construtos do subconjunto: texto, enum, número, booleano, lista de texto", () => {
    render(<SchemaForm schema={FULL_SCHEMA} values={{}} onChange={() => {}} />);

    expect(screen.getByLabelText("Nome")).toHaveProperty("tagName", "INPUT");
    expect(screen.getByLabelText("Nome")).toHaveProperty("type", "text");
    expect(screen.getByLabelText("Status").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Dias")).toHaveProperty("type", "number");
    expect(screen.getByLabelText("Habilitado")).toHaveProperty("type", "checkbox");
    expect(screen.getByLabelText("E-mails").tagName).toBe("TEXTAREA");
  });

  it("campo marcado como secreto renderiza mascarado (password) e nunca recebe valor do servidor", () => {
    render(
      <SchemaForm
        schema={FULL_SCHEMA}
        values={{ senha: "valor-vindo-do-servidor" }}
        onChange={() => {}}
      />
    );

    const senhaInput = screen.getByLabelText("Senha") as HTMLInputElement;
    expect(senhaInput.type).toBe("password");
    expect(senhaInput.value).toBe("");
  });

  it("dispara onChange com o valor novo ao digitar num campo de texto", () => {
    const handleChange = vi.fn();
    render(<SchemaForm schema={FULL_SCHEMA} values={{}} onChange={handleChange} />);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });

    expect(handleChange).toHaveBeenCalledWith(expect.objectContaining({ nome: "Ana" }));
  });

  it("erros do servidor aparecem ao lado do campo correspondente", () => {
    render(
      <SchemaForm
        schema={FULL_SCHEMA}
        values={{}}
        onChange={() => {}}
        fieldErrors={[{ path: "nome", message: "Nome é obrigatório" }]}
      />
    );

    expect(screen.getByText("Nome é obrigatório")).toBeDefined();
  });
});
