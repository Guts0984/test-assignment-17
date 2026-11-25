import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { StaffIdentity } from '../../common/auth/access';
import { Roles } from '../../common/auth/auth.guard';
import { CurrentStaff } from '../../common/auth/current-staff';
import { FolioDto, FolioLineInputDto } from './dto/folio.dto';
import { FolioService } from './folio.service';

@ApiTags('folio')
@ApiBearerAuth()
@Roles('frontdesk', 'admin')
@Controller('api/bookings/:id/folio')
export class FolioController {
  constructor(private readonly folio: FolioService) {}

  @Get()
  @ApiOperation({ operationId: 'getFolio', summary: 'Guest folio: lines and the balance (the sum of the lines)' })
  @ApiOkResponse({ type: FolioDto })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: StaffIdentity) {
    return this.folio.get(staff, id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'addFolioLine', summary: 'Appends a charge, payment or refund (lines are never changed)' })
  @ApiOkResponse({ type: FolioDto })
  add(@Param('id', ParseUUIDPipe) id: string, @Body() body: FolioLineInputDto, @CurrentStaff() staff: StaffIdentity) {
    return this.folio.add(staff, id, body);
  }

  @Post(':lineId/storno')
  @HttpCode(200)
  @ApiOperation({ operationId: 'stornoFolioLine', summary: 'Reverses a line with a new storno line; a line can be reversed once' })
  @ApiOkResponse({ type: FolioDto })
  storno(@Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string, @CurrentStaff() staff: StaffIdentity) {
    return this.folio.storno(staff, id, lineId);
  }
}
