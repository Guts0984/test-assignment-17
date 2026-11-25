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
import { FrontdeskModule } from './modules/frontdesk/frontdesk.module';
import { FolioModule } from './modules/folio/folio.module';
import { HousekeepingModule } from './modules/housekeeping/housekeeping.module';
import { AdminModule } from './modules/admin/admin.module';
import { JobsAdminModule } from './modules/jobs-admin/jobs-admin.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ChannelModule } from './modules/channel/channel.module';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {
  static forRoot(infra: InfraValues): DynamicModule {
    return { module: AppModule, imports: [InfraModule.forRoot(infra), HealthModule, AuthModule, GuestModule, RatesModule, FrontdeskModule, FolioModule, HousekeepingModule, AdminModule, JobsAdminModule, RealtimeModule, ReportsModule, ChannelModule] };
  }
}
