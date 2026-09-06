/**
 * Erro de domínio: carrega um código estável para o chamador decidir o que fazer
 * (mapear para status HTTP, logar, etc). A mensagem é descrição técnica para quem lê
 * o log — nunca o texto mostrado ao usuário final. Tradução para português de
 * interface acontece na borda da API (T17), não aqui.
 */
export class DomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class DuplicateTenantNameError extends DomainError {
  constructor(name: string) {
    super("TENANT_NAME_DUPLICATE", `Tenant com nome "${name}" já existe.`);
  }
}

export class WeakPasswordError extends DomainError {
  constructor(minLength: number) {
    super("PASSWORD_TOO_WEAK", `Senha precisa ter ao menos ${minLength} caracteres.`);
  }
}

export class LastOwnerError extends DomainError {
  constructor() {
    super("LAST_OWNER_PROTECTED", "Operação removeria ou rebaixaria o último owner do tenant.");
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super("INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
  }
}

export class NoMembershipError extends DomainError {
  constructor() {
    super("NO_MEMBERSHIP", "Usuário sem vínculo com nenhum tenant.");
  }
}

export class InsufficientRoleError extends DomainError {
  constructor() {
    super("INSUFFICIENT_ROLE", "Papel insuficiente para executar esta operação.");
  }
}

export class RateLimitedError extends DomainError {
  constructor() {
    super("RATE_LIMITED", "Muitas tentativas em pouco tempo.");
  }
}
