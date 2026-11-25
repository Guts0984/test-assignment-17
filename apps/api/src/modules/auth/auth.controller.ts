import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public, type AuthedRequest } from '../../common/auth/auth.guard';
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

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'logout', summary: 'Signs out: this access token stops working at once' })
  async logout(@Req() req: Request): Promise<{ ok: true }> {
    await this.auth.logout((req as AuthedRequest).token);
    return { ok: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'me', summary: 'The signed-in staff member' })
  me(@CurrentStaff() staff: StaffIdentity): { id: string; name: string; roles: StaffIdentity['roles'] } {
    return { id: staff.id, name: staff.name, roles: staff.roles };
  }
}
