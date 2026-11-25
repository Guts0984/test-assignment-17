import { DynamicModule, Global, Module } from '@nestjs/common';
import { DEPS, type WorkerDeps } from './infra/deps';
import { ChannelPushModule, EmailModule, HoldExpiryModule, NightAuditModule, ReconcilerModule } from './jobs/jobs.module';

@Global()
@Module({})
export class DepsModule {
  static forRoot(deps: WorkerDeps): DynamicModule {
    return { module: DepsModule, providers: [{ provide: DEPS, useValue: deps }], exports: [DEPS] };
  }
}

@Module({})
export class WorkerModule {
  static forRoot(deps: WorkerDeps, opts: { reconciler?: boolean } = {}): DynamicModule {
    const jobs = [HoldExpiryModule, NightAuditModule, ChannelPushModule, EmailModule];
    return { module: WorkerModule, imports: [DepsModule.forRoot(deps), ...jobs, ...(opts.reconciler === false ? [] : [ReconcilerModule])] };
  }
}
