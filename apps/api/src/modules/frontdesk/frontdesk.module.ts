import { Module } from '@nestjs/common';
import { FrontdeskController } from './frontdesk.controller';
import { FrontdeskService } from './frontdesk.service';

@Module({ controllers: [FrontdeskController], providers: [FrontdeskService], exports: [FrontdeskService] })
export class FrontdeskModule {}
