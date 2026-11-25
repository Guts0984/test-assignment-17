import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/auth/auth.guard';
import { CurrentStaff } from '../../common/auth/current-staff';
import type { StaffIdentity } from '../../common/auth/access';
import { unwrap } from '../../common/http-error';
import { clientIp } from '../../common/rate-limit/client-ip';
import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ operationId: 'login', summary: 'Staff login. Failed attempts are rate limited per IP+email, IP and email.' })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(@Body() body: LoginDto, @Req() req: Request): Promise<LoginResponseDto> {
    return unwrap(await this.auth.login({ ip: clientIp(req), email: body.email, password: body.password }));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'me', summary: 'The signed-in staff member' })
  me(@CurrentStaff() staff: StaffIdentity): { id: string; name: string; roles: StaffIdentity['roles'] } {
    return { id: staff.id, name: staff.name, roles: staff.roles };
  }
}
