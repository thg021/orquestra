import * as argon2 from "argon2";
import { WeakPasswordError } from "./errors";

export const MIN_PASSWORD_LENGTH = 12;

export interface HashPasswordOptions {
  /** Parâmetros de custo do Argon2id. Menores em teste, padrão da lib em produção. */
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
}

/** Recusa senha abaixo do mínimo antes de qualquer hash ou escrita (TNT edge case). */
export function assertPasswordPolicy(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(MIN_PASSWORD_LENGTH);
  }
}

/** Argon2id com sal por usuário embutido no encoding — nenhuma coluna de sal separada. */
export async function hashPassword(plain: string, options: HashPasswordOptions = {}): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: options.memoryCost,
    timeCost: options.timeCost,
    parallelism: options.parallelism
  });
}

/**
 * Nunca lança para hash malformado — devolve falso. A senha em texto claro nunca
 * aparece no valor de retorno nem em mensagem de erro.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
