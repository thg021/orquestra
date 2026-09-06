import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthThrottle } from "./throttle";

@Module({
  controllers: [AuthController],
  providers: [AuthThrottle]
})
export class AuthModule {}
