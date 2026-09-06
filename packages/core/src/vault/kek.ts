import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "../errors";

const KEK_LENGTH_BYTES = 32;
const VERSION_FILENAME = /^\d+$/;
const HEX_CONTENT = /^[0-9a-fA-F]+$/;

/**
 * KEK ausente, ilegível ou de tamanho errado. Lançado no boot — nunca inclui o
 * conteúdo do arquivo na mensagem, só o caminho e a versão (ADR-001: erro de fluxo
 * de segredo é sanitizado antes de virar log).
 */
export class InvalidKekError extends DomainError {
  constructor(message: string) {
    super("INVALID_KEK", message);
  }
}

export interface KekSet {
  /** Maior versão presente — usada para cifrar dado novo. */
  readonly currentVersion: number;
  /** Chave da versão pedida; lança se essa versão não foi carregada. */
  get(version: number): Buffer;
}

function decodeContent(raw: Buffer): Buffer {
  if (raw.length === KEK_LENGTH_BYTES) return raw;
  const text = raw.toString("utf8").trim();
  if (HEX_CONTENT.test(text)) return Buffer.from(text, "hex");
  return raw;
}

function readKekFile(path: string, version: number): Buffer {
  const raw = readFileSync(path);
  const key = decodeContent(raw);
  if (key.length !== KEK_LENGTH_BYTES) {
    throw new InvalidKekError(
      `KEK versão ${version} tem tamanho inválido (esperado ${KEK_LENGTH_BYTES} bytes).`
    );
  }
  return key;
}

/**
 * Carrega todas as versões de KEK de um diretório — um arquivo por versão, nome do
 * arquivo é o número da versão (é o formato que o Docker secret monta: um secret por
 * versão, todos no mesmo diretório). Chamado no boot: ausência, permissão negada ou
 * tamanho errado derrubam o processo antes de qualquer credencial poder ser tocada.
 */
export function loadKeks(dirPath: string): KekSet {
  let entries: string[];
  try {
    if (!statSync(dirPath).isDirectory()) {
      throw new InvalidKekError(`Caminho de KEK não é um diretório: "${dirPath}".`);
    }
    entries = readdirSync(dirPath);
  } catch (error) {
    if (error instanceof InvalidKekError) throw error;
    throw new InvalidKekError(`Diretório de KEK não encontrado ou sem permissão: "${dirPath}".`);
  }

  const keys = new Map<number, Buffer>();
  for (const entry of entries) {
    if (!VERSION_FILENAME.test(entry)) continue; // ex.: .gitkeep — não é uma versão
    const version = Number(entry);
    if (version <= 0) continue;
    const fullPath = join(dirPath, entry);
    if (!statSync(fullPath).isFile()) continue;
    keys.set(version, readKekFile(fullPath, version));
  }

  if (keys.size === 0) {
    throw new InvalidKekError(
      `Nenhuma KEK encontrada em "${dirPath}". Espera-se ao menos um arquivo cujo nome é o número da versão.`
    );
  }

  const currentVersion = Math.max(...keys.keys());

  return {
    currentVersion,
    get(version: number): Buffer {
      const key = keys.get(version);
      if (!key) {
        throw new InvalidKekError(`KEK versão ${version} não está carregada.`);
      }
      return key;
    }
  };
}
