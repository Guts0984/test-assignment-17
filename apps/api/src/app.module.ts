import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/error.filter';
import { AuthGuard } from './common/auth/auth.guard';
import { InfraModule, type InfraValues } from './infra/infra.module';
import { AuthModule } from './modules/auth/auth.module';
import { GuestModule } from './modules/guest/guest.module';
import { RatesModule } from './modules/rates/rates.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {
  static forRoot(infra: InfraValues): DynamicModule {
    return { module: AppModule, imports: [InfraModule.forRoot(infra), HealthModule, AuthModule, GuestModule, RatesModule] };
  }
}
