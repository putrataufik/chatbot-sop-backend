// FILE: src/modules/users/users.controller.ts

import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from './entities/user.entity';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET semua user → hanya ADMIN
  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get semua user (Admin only)' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll() {
    return this.usersService.findAll();
  }

  // GET profil diri sendiri → semua role
  @Get('me')
  @ApiOperation({ summary: 'Get profil user yang sedang login' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  getMe(@Request() req: any) {
    const { password_hash, ...result } = req.user;
    return result;
  }

  // GET user by id → hanya ADMIN
  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get user by ID (Admin only)' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  @ApiResponse({ status: 404, description: 'User tidak ditemukan' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findById(id);
  }

  // PATCH update user → ADMIN bisa update siapa saja
  //                   → USER hanya bisa update diri sendiri
  @Patch(':id')
  @ApiOperation({ summary: 'Update user' })
  @ApiResponse({ status: 200, description: 'Berhasil diupdate' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User tidak ditemukan' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @Request() req: any,
  ) {
    // USER hanya boleh update diri sendiri
    if (req.user.role !== UserRole.ADMIN && req.user.id !== id) {
      throw new ForbiddenException('Anda tidak memiliki akses');
    }
    return this.usersService.update(id, dto);
  }

  // DELETE user → hanya ADMIN
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Hapus user (Admin only)' })
  @ApiResponse({ status: 200, description: 'Berhasil dihapus' })
  @ApiResponse({ status: 404, description: 'User tidak ditemukan' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }
}