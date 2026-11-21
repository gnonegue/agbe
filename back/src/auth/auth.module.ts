import { Module } from '@nestjs/common';
import { AuthController, CookieCsrfGuard } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, CookieCsrfGuard],
  exports: [AuthService],
})
export class AuthModule {}
