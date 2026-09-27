import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from './prisma/prisma.service';

// Read from disk at request time rather than imported as a JSON module: the compiled output
// lives at dist/src/*.js, so a relative import path resolved against the *source* file
// (src/app.controller.ts -> ../package.json) would, after compilation, resolve against the
// *compiled* file's location instead (dist/src -> dist/package.json, which doesn't exist —
// tsc doesn't copy non-TS assets to outDir). process.cwd() is /app in both dev and prod (see
// api/Dockerfile's WORKDIR), where package.json actually lives either way.
const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', version };
  }

  @Get('config')
  config() {
    return { debugMode: process.env.DEBUG_MODE === 'true', version };
  }
}
