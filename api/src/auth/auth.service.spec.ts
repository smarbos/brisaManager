import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { adminUser: { findUnique: jest.Mock } };
  let jwtService: JwtService;

  beforeEach(async () => {
    prisma = { adminUser: { findUnique: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('signed-token') } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
  });

  it('throws UnauthorizedException when the user does not exist', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(null);

    await expect(service.login('missing@labrisa.com.ar', 'password')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the password does not match', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    prisma.adminUser.findUnique.mockResolvedValue({ id: '1', email: 'admin@labrisa.com.ar', passwordHash });

    await expect(service.login('admin@labrisa.com.ar', 'wrong-password')).rejects.toThrow(UnauthorizedException);
  });

  it('returns an access token when credentials are valid', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    prisma.adminUser.findUnique.mockResolvedValue({ id: '1', email: 'admin@labrisa.com.ar', passwordHash });

    const result = await service.login('admin@labrisa.com.ar', 'correct-password');

    expect(result).toEqual({ accessToken: 'signed-token' });
    expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: '1', email: 'admin@labrisa.com.ar' });
  });
});
