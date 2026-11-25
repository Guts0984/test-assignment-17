import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { StaffIdentity } from '../../common/auth/access';
import { Roles } from '../../common/auth/auth.guard';
import { CurrentStaff } from '../../common/auth/current-staff';
import { FailedJobsDto, JobRetriedDto } from './dto/jobs.dto';
import { JobsAdminService } from './jobs-admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('api/admin/jobs')
export class JobsAdminController {
  constructor(private readonly jobs: JobsAdminService) {}

  @Get('failed')
  @ApiOperation({ operationId: 'listFailedJobs', summary: 'Jobs that used up their attempts (hold-expiry, night-audit, channel-push, email)' })
  @ApiOkResponse({ type: FailedJobsDto })
  failed(@CurrentStaff() staff: StaffIdentity) {
    return this.jobs.failed(staff);
  }

  @Post(':queue/:jobId/retry')
  @HttpCode(200)
  @ApiOperation({ operationId: 'retryFailedJob' })
  @ApiOkResponse({ type: JobRetriedDto })
  retry(@Param('queue') queue: string, @Param('jobId') jobId: string, @CurrentStaff() staff: StaffIdentity) {
    return this.jobs.retry(staff, queue, jobId);
  }
}
