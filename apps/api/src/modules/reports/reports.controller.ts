import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { StaffIdentity } from '../../common/auth/access';
import { Roles } from '../../common/auth/auth.guard';
import { CurrentStaff } from '../../common/auth/current-staff';
import { requireHotel } from '../../common/auth/hotel-access';
import { ReportDto, ReportQueryDto } from './dto/reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('api/hotels/:hotelId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('revenue')
  @Roles('revenue', 'admin')
  @ApiOperation({ operationId: 'getRevenueReport', summary: 'Occupancy, ADR, RevPAR, cancellations and no-shows by sales channel' })
  @ApiQuery({ name: 'from', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: true, description: 'YYYY-MM-DD, exclusive' })
  @ApiQuery({ name: 'roomTypeId', required: false })
  @ApiQuery({ name: 'source', required: false, enum: ['web', 'channel'] })
  @ApiOkResponse({ type: ReportDto })
  revenue(@Param('hotelId', ParseUUIDPipe) hotelId: string, @Query() q: ReportQueryDto, @CurrentStaff() staff: StaffIdentity) {
    requireHotel(staff, hotelId, ['revenue', 'admin']);
    return this.reports.revenue({ hotelId, ...q });
  }
}
