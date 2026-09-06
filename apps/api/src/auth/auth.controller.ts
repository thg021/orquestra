import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { loginRequestSchema, type LoginResponse, type MeResponse } from "@orquestra/contracts";
import { login as loginService, logout as logoutService, me as meService } from "./auth.service";
import { AuthThrottle } from "./throttle";
import { Protected } from "./protected.decorator";
import { getFullAuthContext } from "./auth-context";
import { SESSION_COOKIE_NAME } from "./session.guard";
import { normalizeEmail } from "../identity/identity.repository";

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/"
};

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthThrottle) private readonly throttle: AuthThrottle) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<LoginResponse> {
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    const input = parsed.data;
    const throttleKey = normalizeEmail(input.email);

    // Bloqueado: nem chega a olhar a credencial — resposta idêntica pra senha certa e errada (RATE-02).
    this.throttle.check(throttleKey);

    try {
      const result = await loginService(input.email, input.password);
      this.throttle.reset(throttleKey);

      res.cookie(SESSION_COOKIE_NAME, result.token, {
        ...SESSION_COOKIE_OPTIONS,
        expires: result.expiresAt
      });

      return {
        user: { id: result.userId, email: result.userEmail },
        tenant: { id: result.tenantId, name: result.tenantName },
        role: result.role
      };
    } catch (error) {
      this.throttle.registerFailure(throttleKey);
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Protected()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const ctx = getFullAuthContext(req);
    await logoutService(ctx.sessionId);
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  }

  @Get("me")
  @Protected()
  async me(@Req() req: Request): Promise<MeResponse> {
    const ctx = getFullAuthContext(req);
    const result = await meService(ctx.userId);
    return {
      user: { id: result.userId, email: result.userEmail },
      tenant: { id: result.tenantId, name: result.tenantName },
      role: result.role
    };
  }
}
