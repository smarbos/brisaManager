# Core Reservation Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin app for manually tracking reservations (with source: Booking.com/Airbnb/Direct/Other), backed by a NestJS+Prisma+PostgreSQL API, plus the Docker/Traefik infra skeleton (including a placeholder guest-facing app) that later sub-projects build on.

**Architecture:** Three independently-dockerized services — a NestJS+Prisma API, a React admin SPA, and a React guest-app placeholder — orchestrated by Docker Compose locally and by Docker Compose + Traefik in production, all sharing one PostgreSQL database.

**Tech Stack:** Node.js 20, NestJS, Prisma, PostgreSQL 16, React 18 + Vite + TypeScript, Vitest + React Testing Library, Jest + Supertest, Docker Compose, Traefik v3.

**Spec:** `docs/superpowers/specs/2026-09-12-core-reservation-management-design.md`

## Global Constraints

- Infra is Docker Compose based (a `docker-compose.yml` for dev, `docker-compose.prod.yml` as a production override) — per spec and explicit user instruction.
- Backend: Node.js + TypeScript, NestJS framework, Prisma ORM, PostgreSQL.
- Frontend: React + TypeScript, built with Vite.
- Single admin login only (no roles/permissions) for this sub-project.
- `Reservation.source` enum: `BOOKING`, `AIRBNB`, `DIRECT`, `OTHER`.
- `Reservation.status` enum: `PENDING`, `CONFIRMED`, `CANCELLED`, `COMPLETED` (manually set in this sub-project; automated transitions come in sub-project 2).
- Production subdomains: `admin.labrisa.com.ar` → admin-web, `reservas.labrisa.com.ar` → guest-web, `api.labrisa.com.ar` → api.
- Reverse proxy: Traefik, with automatic Let's Encrypt TLS certificates.
- No Booking.com/Airbnb API integration, no guest-onboarding automation, no Google Calendar sync, no marketing features in this sub-project — those are later sub-projects per `TODO.md`.

---

### Task 1: Monorepo scaffold + PostgreSQL via Docker Compose

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`

**Interfaces:**
- Produces: `docker-compose.yml` with a `postgres` service; env vars defined in `.env.example` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`, `API_PORT`, `ADMIN_WEB_PORT`, `GUEST_WEB_PORT`, `VITE_API_URL`, `ADMIN_WEB_ORIGIN`, `GUEST_WEB_ORIGIN`) that every later task's compose service reads from.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
build/
.env
*.log
.DS_Store
```

- [ ] **Step 2: Create `.env.example`**

```
# Postgres
POSTGRES_USER=brisa
POSTGRES_PASSWORD=changeme
POSTGRES_DB=brisa
POSTGRES_PORT=5432

# API
DATABASE_URL=postgresql://brisa:changeme@postgres:5432/brisa?schema=public
JWT_SECRET=changeme-super-secret
JWT_EXPIRES_IN=8h
ADMIN_SEED_EMAIL=admin@labrisa.com.ar
ADMIN_SEED_PASSWORD=changeme
API_PORT=3000
ADMIN_WEB_ORIGIN=http://localhost:5173
GUEST_WEB_ORIGIN=http://localhost:5174

# Frontends
ADMIN_WEB_PORT=5173
GUEST_WEB_PORT=5174
VITE_API_URL=http://localhost:3000
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "${POSTGRES_PORT}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

- [ ] **Step 4: Create local `.env` and bring Postgres up**

Run:
```bash
cp .env.example .env
docker compose up -d postgres
docker compose exec postgres pg_isready -U brisa
```
Expected: `accepting connections`

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example docker-compose.yml
git commit -m "Add monorepo scaffold with dockerized Postgres"
```

---

### Task 2: NestJS API scaffold + Prisma wiring + health check

**Files:**
- Create: `api/` (via `@nestjs/cli`)
- Modify: `api/src/app.module.ts`, `api/src/app.controller.ts`, `api/src/main.ts`, `api/test/app.e2e-spec.ts`
- Delete: `api/src/app.service.ts`, `api/src/app.controller.spec.ts`
- Create: `api/src/prisma/prisma.service.ts`, `api/src/prisma/prisma.module.ts`
- Create: `api/Dockerfile`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `postgres` service + `DATABASE_URL` from Task 1.
- Produces: `PrismaService` (importable from `../prisma/prisma.service`, injectable, extends `PrismaClient`), `PrismaModule` (global — no need to re-import in later feature modules), `GET /health` endpoint, `api` compose service with `dev`/`build`/`prod` Dockerfile targets that Tasks 5, 6, 9, 10 build on.

- [ ] **Step 1: Scaffold the NestJS project**

Run:
```bash
npx @nestjs/cli@latest new api --package-manager npm --skip-git
```
Expected: `api/` created with a working NestJS starter (`src/main.ts`, `src/app.module.ts`, etc.)

- [ ] **Step 2: Install Prisma and initialize it**

Run:
```bash
cd api
npm install @prisma/client
npm install -D prisma
npx prisma init --datasource-provider postgresql
cd ..
```
Expected: `api/prisma/schema.prisma` created with a `datasource db` block and `.env` reference.

- [ ] **Step 3: Point Prisma at `DATABASE_URL`**

Edit `api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Run `cd api && npx prisma generate && cd ..` — expected: `Generated Prisma Client` with no models yet (empty client is fine).

- [ ] **Step 4: Create `PrismaService` and `PrismaModule`**

`api/src/prisma/prisma.service.ts`:
```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

`api/src/prisma/prisma.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 5: Replace the default controller with a `/health` endpoint**

Delete `api/src/app.service.ts` and `api/src/app.controller.spec.ts`.

`api/src/app.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
```

`api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AppController],
})
export class AppModule {}
```

`api/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [process.env.ADMIN_WEB_ORIGIN, process.env.GUEST_WEB_ORIGIN].filter(Boolean),
  });
  await app.listen(process.env.API_PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 6: Replace the default e2e test with a health check test**

`api/test/app.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) returns ok', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });
});
```

- [ ] **Step 7: Create the API Dockerfile**

`api/Dockerfile`:
```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma

FROM base AS dev
RUN npm install
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "start:dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate
COPY --from=build /app/dist ./dist
CMD ["node", "dist/main.js"]
```

- [ ] **Step 8: Add the `api` service to `docker-compose.yml`**

Add under `services:`:
```yaml
  api:
    build:
      context: ./api
      target: dev
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: ${DATABASE_URL}
    ports:
      - "${API_PORT}:3000"
    volumes:
      - ./api:/app
      - /app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
```

- [ ] **Step 9: Bring it up and verify**

Run:
```bash
docker compose up -d --build api
curl -s http://localhost:3000/health
```
Expected: `{"status":"ok"}`

Run the e2e test:
```bash
docker compose exec api npm run test:e2e
```
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add api docker-compose.yml
git commit -m "Add NestJS API scaffold with Prisma wiring and health check"
```

---

### Task 3: Prisma schema — Reservation & AdminUser models

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/...` (via `prisma migrate dev`)
- Create: `api/test/schema.e2e-spec.ts`

**Interfaces:**
- Consumes: Prisma setup from Task 2.
- Produces: Prisma Client types `Reservation`, `AdminUser`, `ReservationSource`, `ReservationStatus` (importable from `@prisma/client`) that Tasks 4 and 5 build on.

- [ ] **Step 1: Add the models to `api/prisma/schema.prisma`**

```prisma
enum ReservationSource {
  BOOKING
  AIRBNB
  DIRECT
  OTHER
}

enum ReservationStatus {
  PENDING
  CONFIRMED
  CANCELLED
  COMPLETED
}

model Reservation {
  id                String            @id @default(uuid())
  guestName         String
  guestPhone        String?
  guestEmail        String?
  checkIn           DateTime
  checkOut          DateTime
  paxCount          Int
  source            ReservationSource
  externalReference String?
  totalAmount       Decimal           @db.Decimal(10, 2)
  currency          String
  status            ReservationStatus @default(PENDING)
  notes             String?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
}

model AdminUser {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
}
```

- [ ] **Step 2: Generate and run the migration**

Run:
```bash
docker compose exec api npx prisma migrate dev --name init
```
Expected: a new folder under `api/prisma/migrations/` and `The following migration(s) have been applied`.

- [ ] **Step 3: Write a schema smoke test**

`api/test/schema.e2e-spec.ts`:
```typescript
import { PrismaClient } from '@prisma/client';

describe('Prisma schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates and reads a Reservation', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Test Guest',
        checkIn: new Date('2026-01-10'),
        checkOut: new Date('2026-01-15'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    const found = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(found?.guestName).toBe('Test Guest');

    await prisma.reservation.delete({ where: { id: reservation.id } });
  });

  it('creates and reads an AdminUser', async () => {
    const user = await prisma.adminUser.create({
      data: { email: 'schema-test@labrisa.com.ar', passwordHash: 'hash' },
    });

    const found = await prisma.adminUser.findUnique({ where: { id: user.id } });
    expect(found?.email).toBe('schema-test@labrisa.com.ar');

    await prisma.adminUser.delete({ where: { id: user.id } });
  });
});
```

- [ ] **Step 4: Run it**

Run:
```bash
docker compose exec api npm run test:e2e
```
Expected: PASS (both `schema.e2e-spec.ts` and `app.e2e-spec.ts` green)

- [ ] **Step 5: Commit**

```bash
git add api/prisma api/test/schema.e2e-spec.ts
git commit -m "Add Reservation and AdminUser Prisma models"
```

---

### Task 4: Auth — admin login with JWT

**Files:**
- Create: `api/src/auth/auth.module.ts`, `api/src/auth/auth.service.ts`, `api/src/auth/auth.controller.ts`, `api/src/auth/jwt.strategy.ts`, `api/src/auth/jwt-auth.guard.ts`, `api/src/auth/dto/login.dto.ts`, `api/src/auth/auth.service.spec.ts`
- Create: `api/prisma/seed.ts`
- Modify: `api/src/app.module.ts`, `api/package.json`

**Interfaces:**
- Consumes: `PrismaService` (Task 2), `AdminUser` model (Task 3).
- Produces: `AuthService.login(email: string, password: string): Promise<{ accessToken: string }>` (throws `UnauthorizedException` on bad credentials), `JwtAuthGuard` (importable from `../auth/jwt-auth.guard`, usable as `@UseGuards(JwtAuthGuard)`), `POST /auth/login` — all consumed by Task 5's guarded routes and Task 6's admin-web login.

- [ ] **Step 1: Install auth dependencies**

Run:
```bash
docker compose exec api npm install @nestjs/jwt @nestjs/passport passport passport-jwt bcryptjs class-validator class-transformer
docker compose exec api npm install -D @types/passport-jwt @types/bcryptjs ts-node
docker compose restart api
```

- [ ] **Step 2: Write the failing `AuthService` test**

`api/src/auth/auth.service.spec.ts`:
```typescript
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
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec api npm test -- auth.service.spec.ts`
Expected: FAIL (`Cannot find module './auth.service'`)

- [ ] **Step 4: Implement `AuthService`, DTO, guard, strategy, controller, module**

`api/src/auth/dto/login.dto.ts`:
```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
```

`api/src/auth/auth.service.ts`:
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwtService.signAsync({ sub: user.id, email: user.email });
    return { accessToken };
  }
}
```

`api/src/auth/jwt.strategy.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: JwtPayload) {
    return { userId: payload.sub, email: payload.email };
  }
}
```

`api/src/auth/jwt-auth.guard.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

`api/src/auth/auth.controller.ts`:
```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }
}
```

`api/src/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
```

Add `AuthModule` to `api/src/app.module.ts` imports.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- auth.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Add the admin user seed script**

`api/prisma/seed.ts`:
```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be set');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash },
  });

  console.log(`Seeded admin user: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Add to `api/package.json` (top-level key):
```json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

- [ ] **Step 7: Seed the admin user and verify login**

Run:
```bash
docker compose exec api npx prisma db seed
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@labrisa.com.ar","password":"changeme"}'
```
Expected: JSON response with an `accessToken` field.

- [ ] **Step 8: Commit**

```bash
git add api/src/auth api/prisma/seed.ts api/package.json api/src/app.module.ts
git commit -m "Add JWT-based admin login"
```

---

### Task 5: Reservations CRUD API

**Files:**
- Create: `api/src/reservations/reservations.module.ts`, `api/src/reservations/reservations.service.ts`, `api/src/reservations/reservations.controller.ts`, `api/src/reservations/reservations.service.spec.ts`
- Create: `api/src/reservations/dto/create-reservation.dto.ts`, `api/src/reservations/dto/update-reservation.dto.ts`, `api/src/reservations/dto/query-reservation.dto.ts`
- Create: `api/test/reservations.e2e-spec.ts`
- Modify: `api/src/app.module.ts`, `api/src/main.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 2), `Reservation`/`ReservationSource`/`ReservationStatus` types (Task 3), `JwtAuthGuard` and `AuthService.login` (Task 4).
- Produces: `POST /reservations`, `GET /reservations?source=&status=`, `GET /reservations/:id`, `PATCH /reservations/:id` (all JWT-guarded) — consumed by Tasks 7 and 8's admin-web pages.

- [ ] **Step 1: Install remaining validation dependency**

Run:
```bash
docker compose exec api npm install @nestjs/mapped-types
docker compose restart api
```

- [ ] **Step 2: Write the failing `ReservationsService` test**

`api/src/reservations/reservations.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let prisma: {
    reservation: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      reservation: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ReservationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ReservationsService);
  });

  const validDto = {
    guestName: 'Jane Doe',
    checkIn: '2026-01-10',
    checkOut: '2026-01-15',
    paxCount: 2,
    source: 'DIRECT' as const,
    totalAmount: 100000,
    currency: 'ARS',
  };

  it('rejects a reservation where checkOut is not after checkIn', async () => {
    await expect(
      service.create({ ...validDto, checkIn: '2026-01-15', checkOut: '2026-01-10' }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('creates a reservation with valid dates', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto });

    const result = await service.create(validDto);

    expect(result).toEqual({ id: '1', ...validDto });
    expect(prisma.reservation.create).toHaveBeenCalled();
  });

  it('throws NotFoundException when updating a reservation that does not exist', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(service.update('missing-id', { guestName: 'New Name' })).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: FAIL (`Cannot find module './reservations.service'`)

- [ ] **Step 4: Implement DTOs and the service**

`api/src/reservations/dto/create-reservation.dto.ts`:
```typescript
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { ReservationSource } from '@prisma/client';

export class CreateReservationDto {
  @IsString()
  @MinLength(1)
  guestName: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;

  @IsOptional()
  @IsString()
  guestEmail?: string;

  @IsDateString()
  checkIn: string;

  @IsDateString()
  checkOut: string;

  @IsInt()
  @IsPositive()
  paxCount: number;

  @IsEnum(ReservationSource)
  source: ReservationSource;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @IsString()
  @MinLength(3)
  currency: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
```

`api/src/reservations/dto/update-reservation.dto.ts`:
```typescript
import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { ReservationStatus } from '@prisma/client';
import { CreateReservationDto } from './create-reservation.dto';

export class UpdateReservationDto extends PartialType(CreateReservationDto) {
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;
}
```

`api/src/reservations/dto/query-reservation.dto.ts`:
```typescript
import { IsEnum, IsOptional } from 'class-validator';
import { ReservationSource, ReservationStatus } from '@prisma/client';

export class QueryReservationDto {
  @IsOptional()
  @IsEnum(ReservationSource)
  source?: ReservationSource;

  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;
}
```

`api/src/reservations/reservations.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QueryReservationDto } from './dto/query-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  private validateDates(checkIn: string, checkOut: string) {
    if (new Date(checkOut) <= new Date(checkIn)) {
      throw new BadRequestException('checkOut must be after checkIn');
    }
  }

  async create(dto: CreateReservationDto) {
    this.validateDates(dto.checkIn, dto.checkOut);

    return this.prisma.reservation.create({
      data: {
        ...dto,
        checkIn: new Date(dto.checkIn),
        checkOut: new Date(dto.checkOut),
      },
    });
  }

  async findAll(query: QueryReservationDto) {
    return this.prisma.reservation.findMany({
      where: {
        source: query.source,
        status: query.status,
      },
      orderBy: { checkIn: 'desc' },
    });
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  async update(id: string, dto: UpdateReservationDto) {
    await this.findOne(id);

    if (dto.checkIn && dto.checkOut) {
      this.validateDates(dto.checkIn, dto.checkOut);
    }

    return this.prisma.reservation.update({
      where: { id },
      data: {
        ...dto,
        checkIn: dto.checkIn ? new Date(dto.checkIn) : undefined,
        checkOut: dto.checkOut ? new Date(dto.checkOut) : undefined,
      },
    });
  }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Implement the controller and module**

`api/src/reservations/reservations.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QueryReservationDto } from './dto/query-reservation.dto';

@UseGuards(JwtAuthGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  create(@Body() dto: CreateReservationDto) {
    return this.reservationsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryReservationDto) {
    return this.reservationsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reservationsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto) {
    return this.reservationsService.update(id, dto);
  }
}
```

`api/src/reservations/reservations.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
```

Add `ReservationsModule` to `api/src/app.module.ts` imports.

Add global validation to `api/src/main.ts` (import `ValidationPipe` from `@nestjs/common`, call before `app.listen`):
```typescript
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
```

- [ ] **Step 7: Write the e2e test**

`api/test/reservations.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('ReservationsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-reservations@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash },
    });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({ where: { guestName: 'E2E Guest' } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-reservations@labrisa.com.ar' } });
    await app.close();
  });

  it('creates, lists, and filters reservations by source', async () => {
    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'E2E Guest',
        checkIn: '2026-02-01',
        checkOut: '2026-02-05',
        paxCount: 3,
        source: 'AIRBNB',
        totalAmount: 50000,
        currency: 'ARS',
      })
      .expect(201);

    const listResponse = await request(app.getHttpServer())
      .get('/reservations?source=AIRBNB')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(listResponse.body.some((r: { guestName: string }) => r.guestName === 'E2E Guest')).toBe(true);
  });

  it('rejects requests without a valid token', async () => {
    await request(app.getHttpServer()).get('/reservations').expect(401);
  });
});
```

- [ ] **Step 8: Run all API tests and confirm they pass**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 9: Commit**

```bash
git add api/src/reservations api/test/reservations.e2e-spec.ts api/src/app.module.ts api/src/main.ts
git commit -m "Add reservations CRUD API with source/status filtering"
```

---

### Task 6: Admin-web scaffold — login and routing shell

**Files:**
- Create: `admin-web/` (via `npm create vite@latest`)
- Create: `admin-web/src/api/client.ts`, `admin-web/src/auth/AuthContext.tsx`, `admin-web/src/auth/LoginPage.tsx`, `admin-web/src/auth/LoginPage.test.tsx`, `admin-web/src/auth/ProtectedRoute.tsx`, `admin-web/src/setupTests.ts`
- Modify: `admin-web/src/App.tsx`, `admin-web/vite.config.ts`, `admin-web/package.json`
- Create: `admin-web/Dockerfile`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `POST /auth/login` from Task 4, via `VITE_API_URL`.
- Produces: `apiClient.request<T>(path, options)` (importable from `../api/client`, attaches `Authorization` header from `localStorage`), `useAuth()` hook (`{ isAuthenticated, login, logout }`), `<ProtectedRoute />` — all consumed by Tasks 7 and 8.

- [ ] **Step 1: Scaffold the Vite React+TS project**

Run:
```bash
npm create vite@latest admin-web -- --template react-ts
cd admin-web
npm install
npm install react-router-dom
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
cd ..
```

- [ ] **Step 2: Configure Vitest**

`admin-web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
});
```

`admin-web/src/setupTests.ts`:
```typescript
import '@testing-library/jest-dom/vitest';
```

Add to `admin-web/package.json` `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 3: Write the API client**

`admin-web/src/api/client.ts`:
```typescript
const API_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('accessToken');

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<{ accessToken: string }> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export const apiClient = { request };
```

- [ ] **Step 4: Write `AuthContext`, `LoginPage`, and `ProtectedRoute`**

`admin-web/src/auth/AuthContext.tsx`:
```tsx
import { createContext, useContext, useState, ReactNode } from 'react';
import { login as loginRequest } from '../api/client';

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem('accessToken')));

  async function login(email: string, password: string) {
    const { accessToken } = await loginRequest(email, password);
    localStorage.setItem('accessToken', accessToken);
    setIsAuthenticated(true);
  }

  function logout() {
    localStorage.removeItem('accessToken');
    setIsAuthenticated(false);
  }

  return <AuthContext.Provider value={{ isAuthenticated, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

`admin-web/src/auth/LoginPage.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>La Brisa - Admin</h1>
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
      </label>
      <label>
        Password
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
    </form>
  );
}
```

`admin-web/src/auth/ProtectedRoute.tsx`:
```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}
```

- [ ] **Step 5: Write the failing `LoginPage` test**

`admin-web/src/auth/LoginPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { AuthProvider } from './AuthContext';
import * as apiClient from '../api/client';

describe('LoginPage', () => {
  it('shows an error when login fails', async () => {
    vi.spyOn(apiClient, 'login').mockRejectedValue(new Error('unauthorized'));

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@labrisa.com.ar' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i));
  });
});
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `cd admin-web && npx vitest run src/auth/LoginPage.test.tsx && cd ..`
Expected: PASS

- [ ] **Step 7: Wire up `App.tsx`**

`admin-web/src/App.tsx`:
```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';

function HomePlaceholder() {
  return <p>Logged in.</p>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<HomePlaceholder />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 8: Create the Dockerfile**

`admin-web/Dockerfile`:
```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

FROM base AS dev
RUN npm install
COPY . .
CMD ["npm", "run", "dev", "--", "--host"]

FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
```

- [ ] **Step 9: Add the `admin-web` service to `docker-compose.yml`**

```yaml
  admin-web:
    build:
      context: ./admin-web
      target: dev
    restart: unless-stopped
    env_file: .env
    environment:
      VITE_API_URL: ${VITE_API_URL}
    ports:
      - "${ADMIN_WEB_PORT}:5173"
    volumes:
      - ./admin-web:/app
      - /app/node_modules
    depends_on:
      - api
```

- [ ] **Step 10: Bring it up and verify manually**

Run:
```bash
docker compose up -d --build admin-web
```
Open `http://localhost:5173` — expected: login form renders; logging in with the seeded admin credentials redirects to the placeholder home page.

- [ ] **Step 11: Commit**

```bash
git add admin-web docker-compose.yml
git commit -m "Add admin-web scaffold with login and protected routing"
```

---

### Task 7: Admin-web — reservation list with filters

**Files:**
- Create: `admin-web/src/reservations/types.ts`, `admin-web/src/api/reservations.ts`, `admin-web/src/reservations/ReservationListPage.tsx`, `admin-web/src/reservations/ReservationListPage.test.tsx`
- Modify: `admin-web/src/App.tsx`

**Interfaces:**
- Consumes: `GET /reservations` (Task 5), `apiClient` (Task 6).
- Produces: `listReservations(filters)` (importable from `../api/reservations`), `Reservation` type — consumed by Task 8.

- [ ] **Step 1: Define shared types**

`admin-web/src/reservations/types.ts`:
```typescript
export type ReservationSource = 'BOOKING' | 'AIRBNB' | 'DIRECT' | 'OTHER';
export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export interface Reservation {
  id: string;
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  checkIn: string;
  checkOut: string;
  paxCount: number;
  source: ReservationSource;
  externalReference?: string;
  totalAmount: number;
  currency: string;
  status: ReservationStatus;
  notes?: string;
}
```

- [ ] **Step 2: Write `listReservations`**

`admin-web/src/api/reservations.ts`:
```typescript
import { apiClient } from './client';
import { Reservation, ReservationSource, ReservationStatus } from '../reservations/types';

export interface ReservationFilters {
  source?: ReservationSource;
  status?: ReservationStatus;
}

export function listReservations(filters: ReservationFilters = {}): Promise<Reservation[]> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.status) params.set('status', filters.status);
  const query = params.toString();
  return apiClient.request(`/reservations${query ? `?${query}` : ''}`);
}
```

- [ ] **Step 3: Write the failing `ReservationListPage` test**

`admin-web/src/reservations/ReservationListPage.test.tsx`:
```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReservationListPage } from './ReservationListPage';
import * as reservationsApi from '../api/reservations';

describe('ReservationListPage', () => {
  it('renders reservations returned by the API', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'AIRBNB',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'PENDING',
      },
    ]);

    render(
      <MemoryRouter>
        <ReservationListPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
  });

  it('refetches when the source filter changes', async () => {
    const spy = vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <ReservationListPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: undefined, status: undefined }));

    fireEvent.change(screen.getByLabelText(/source/i), { target: { value: 'AIRBNB' } });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: 'AIRBNB', status: undefined }));
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `cd admin-web && npx vitest run src/reservations/ReservationListPage.test.tsx && cd ..`
Expected: FAIL (`Cannot find module './ReservationListPage'`)

- [ ] **Step 5: Implement `ReservationListPage`**

`admin-web/src/reservations/ReservationListPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { Reservation, ReservationSource, ReservationStatus } from './types';

export function ReservationListPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [source, setSource] = useState<ReservationSource | ''>('');
  const [status, setStatus] = useState<ReservationStatus | ''>('');

  useEffect(() => {
    listReservations({
      source: source || undefined,
      status: status || undefined,
    }).then(setReservations);
  }, [source, status]);

  return (
    <div>
      <h1>Reservations</h1>
      <Link to="/reservations/new">New reservation</Link>
      <div>
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value as ReservationSource | '')}>
            <option value="">All</option>
            <option value="BOOKING">Booking.com</option>
            <option value="AIRBNB">Airbnb</option>
            <option value="DIRECT">Direct</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | '')}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>Guest</th>
            <th>Check-in</th>
            <th>Check-out</th>
            <th>Source</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id}>
              <td>
                <Link to={`/reservations/${r.id}`}>{r.guestName}</Link>
              </td>
              <td>{r.checkIn}</td>
              <td>{r.checkOut}</td>
              <td>{r.source}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `cd admin-web && npx vitest run src/reservations/ReservationListPage.test.tsx && cd ..`
Expected: PASS (2 tests)

- [ ] **Step 7: Wire it into `App.tsx`**

In `admin-web/src/App.tsx`, replace `HomePlaceholder` usage:
```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { ReservationListPage } from './reservations/ReservationListPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<ReservationListPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 8: Verify manually**

Run: `docker compose restart admin-web`
Open `http://localhost:5173`, log in — expected: reservation list (empty or showing seeded data) with source/status filters.

- [ ] **Step 9: Commit**

```bash
git add admin-web/src
git commit -m "Add reservation list page with source/status filters"
```

---

### Task 8: Admin-web — create/edit reservation form

**Files:**
- Modify: `admin-web/src/api/reservations.ts`
- Create: `admin-web/src/reservations/ReservationFormPage.tsx`, `admin-web/src/reservations/ReservationFormPage.test.tsx`
- Modify: `admin-web/src/App.tsx`

**Interfaces:**
- Consumes: `POST /reservations`, `GET /reservations/:id`, `PATCH /reservations/:id` (Task 5), `Reservation` type (Task 7).
- Produces: `createReservation`, `getReservation`, `updateReservation` (importable from `../api/reservations`).

- [ ] **Step 1: Add API functions**

Add to `admin-web/src/api/reservations.ts`:
```typescript
export type ReservationInput = Omit<Reservation, 'id' | 'status'> & { status?: Reservation['status'] };

export function getReservation(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}`);
}

export function createReservation(input: ReservationInput): Promise<Reservation> {
  return apiClient.request('/reservations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateReservation(id: string, input: Partial<ReservationInput>): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}
```

- [ ] **Step 2: Write the failing `ReservationFormPage` test**

`admin-web/src/reservations/ReservationFormPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReservationFormPage } from './ReservationFormPage';
import * as reservationsApi from '../api/reservations';

describe('ReservationFormPage', () => {
  it('submits a new reservation', async () => {
    const createSpy = vi.spyOn(reservationsApi, 'createReservation').mockResolvedValue({ id: '1' } as never);

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/guest name/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText(/total amount/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd admin-web && npx vitest run src/reservations/ReservationFormPage.test.tsx && cd ..`
Expected: FAIL (`Cannot find module './ReservationFormPage'`)

- [ ] **Step 4: Implement `ReservationFormPage`**

`admin-web/src/reservations/ReservationFormPage.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createReservation, getReservation, updateReservation } from '../api/reservations';
import { Reservation, ReservationSource, ReservationStatus } from './types';

const emptyForm = {
  guestName: '',
  guestPhone: '',
  guestEmail: '',
  checkIn: '',
  checkOut: '',
  paxCount: 1,
  source: 'DIRECT' as ReservationSource,
  externalReference: '',
  totalAmount: 0,
  currency: 'ARS',
  status: 'PENDING' as ReservationStatus,
  notes: '',
};

export function ReservationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      getReservation(id).then((reservation: Reservation) =>
        setForm({
          ...emptyForm,
          ...reservation,
          checkIn: reservation.checkIn.slice(0, 10),
          checkOut: reservation.checkOut.slice(0, 10),
        }),
      );
    }
  }, [id]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditing && id) {
        await updateReservation(id, form);
      } else {
        await createReservation(form);
      }
      navigate('/');
    } catch {
      setError('Could not save the reservation');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditing ? 'Edit reservation' : 'New reservation'}</h1>
      <label>
        Guest name
        <input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} required />
      </label>
      <label>
        Check-in
        <input
          type="date"
          value={form.checkIn}
          onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
          required
        />
      </label>
      <label>
        Check-out
        <input
          type="date"
          value={form.checkOut}
          onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
          required
        />
      </label>
      <label>
        Pax
        <input
          type="number"
          min={1}
          value={form.paxCount}
          onChange={(e) => setForm({ ...form, paxCount: Number(e.target.value) })}
          required
        />
      </label>
      <label>
        Source
        <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ReservationSource })}>
          <option value="BOOKING">Booking.com</option>
          <option value="AIRBNB">Airbnb</option>
          <option value="DIRECT">Direct</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label>
        Total amount
        <input
          type="number"
          min={0}
          value={form.totalAmount}
          onChange={(e) => setForm({ ...form, totalAmount: Number(e.target.value) })}
          required
        />
      </label>
      <label>
        Currency
        <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
      </label>
      {isEditing && (
        <label>
          Status
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ReservationStatus })}>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
      )}
      <label>
        Notes
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Save</button>
    </form>
  );
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd admin-web && npx vitest run src/reservations/ReservationFormPage.test.tsx && cd ..`
Expected: PASS

- [ ] **Step 6: Wire routes into `App.tsx`**

```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { ReservationListPage } from './reservations/ReservationListPage';
import { ReservationFormPage } from './reservations/ReservationFormPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<ReservationListPage />} />
            <Route path="/reservations/new" element={<ReservationFormPage />} />
            <Route path="/reservations/:id" element={<ReservationFormPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 7: Verify manually**

Run: `docker compose restart admin-web`
Open `http://localhost:5173`, log in, click "New reservation", fill the form, save — expected: redirected to the list, new reservation appears; clicking a guest name opens the edit form pre-filled.

- [ ] **Step 8: Commit**

```bash
git add admin-web/src
git commit -m "Add reservation create/edit form"
```

---

### Task 9: Guest-web placeholder scaffold

**Files:**
- Create: `guest-web/` (via `npm create vite@latest`)
- Modify: `guest-web/src/App.tsx`, `guest-web/vite.config.ts`
- Create: `guest-web/Dockerfile`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: `guest-web` service reachable on `GUEST_WEB_PORT`, proving the fourth container in the stack builds and serves — no functional interface consumed by later tasks in this sub-project (sub-project 2 replaces the page content).

- [ ] **Step 1: Scaffold the Vite React+TS project**

Run:
```bash
npm create vite@latest guest-web -- --template react-ts
cd guest-web && npm install && cd ..
```

- [ ] **Step 2: Replace the placeholder page**

`guest-web/src/App.tsx`:
```tsx
export function App() {
  return (
    <main>
      <h1>La Brisa de Mar del Plata</h1>
      <p>Guest portal coming soon.</p>
    </main>
  );
}
```

`guest-web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
  },
});
```

- [ ] **Step 3: Create the Dockerfile**

`guest-web/Dockerfile`:
```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

FROM base AS dev
RUN npm install
COPY . .
CMD ["npm", "run", "dev", "--", "--host"]

FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
```

- [ ] **Step 4: Add the `guest-web` service to `docker-compose.yml`**

```yaml
  guest-web:
    build:
      context: ./guest-web
      target: dev
    restart: unless-stopped
    ports:
      - "${GUEST_WEB_PORT}:5174"
    volumes:
      - ./guest-web:/app
      - /app/node_modules
```

- [ ] **Step 5: Bring it up and verify**

Run:
```bash
docker compose up -d --build guest-web
curl -s http://localhost:5174 | grep -i "coming soon"
```
Expected: match found

- [ ] **Step 6: Commit**

```bash
git add guest-web docker-compose.yml
git commit -m "Add guest-web placeholder app"
```

---

### Task 10: Traefik reverse proxy + production compose override

**Files:**
- Create: `docker-compose.prod.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `api`, `admin-web`, `guest-web` services and their `prod` Dockerfile targets (Tasks 2, 6, 9).
- Produces: `docker-compose.prod.yml`, the production entry point used by the deployment steps in Task 11's README.

- [ ] **Step 1: Add production domain/env vars**

Add to `.env.example`:
```
# Production only
ADMIN_DOMAIN=admin.labrisa.com.ar
GUEST_DOMAIN=reservas.labrisa.com.ar
API_DOMAIN=api.labrisa.com.ar
ACME_EMAIL=admin@labrisa.com.ar
```

- [ ] **Step 2: Create `docker-compose.prod.yml`**

```yaml
services:
  traefik:
    image: traefik:v3.1
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entryPoint.to=websecure
      - --entrypoints.web.http.redirections.entryPoint.scheme=https
      - --certificatesresolvers.leresolver.acme.httpchallenge=true
      - --certificatesresolvers.leresolver.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.leresolver.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.leresolver.acme.storage=/letsencrypt/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_letsencrypt:/letsencrypt

  api:
    build:
      context: ./api
      target: prod
    restart: unless-stopped
    env_file: .env
    labels:
      - traefik.enable=true
      - traefik.http.routers.api.rule=Host(`${API_DOMAIN}`)
      - traefik.http.routers.api.entrypoints=websecure
      - traefik.http.routers.api.tls.certresolver=leresolver
      - traefik.http.services.api.loadbalancer.server.port=3000

  admin-web:
    build:
      context: ./admin-web
      target: prod
    restart: unless-stopped
    labels:
      - traefik.enable=true
      - traefik.http.routers.admin-web.rule=Host(`${ADMIN_DOMAIN}`)
      - traefik.http.routers.admin-web.entrypoints=websecure
      - traefik.http.routers.admin-web.tls.certresolver=leresolver
      - traefik.http.services.admin-web.loadbalancer.server.port=80

  guest-web:
    build:
      context: ./guest-web
      target: prod
    restart: unless-stopped
    labels:
      - traefik.enable=true
      - traefik.http.routers.guest-web.rule=Host(`${GUEST_DOMAIN}`)
      - traefik.http.routers.guest-web.entrypoints=websecure
      - traefik.http.routers.guest-web.tls.certresolver=leresolver
      - traefik.http.services.guest-web.loadbalancer.server.port=80

volumes:
  traefik_letsencrypt:
```

Note: the `prod` targets drop the dev bind-mounts and host port publishing for `api`/`admin-web`/`guest-web` (Compose file overrides replace list-valued keys like `ports` and `volumes` rather than merging them), so only Traefik exposes 80/443 in production.

- [ ] **Step 3: Validate the merged config**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
```
Expected: valid merged YAML output, no errors; `api`/`admin-web`/`guest-web` show `target: prod` and no `ports:` entries other than Traefik's.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml .env.example
git commit -m "Add Traefik reverse proxy and production compose override"
```

---

### Task 11: Root README with setup and deployment instructions

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: every command introduced in Tasks 1–10.

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
# La Brisa de Mar del Plata — Reservation Manager

## Local development

1. Copy environment variables: `cp .env.example .env` (adjust secrets as needed)
2. Start everything: `docker compose up -d --build`
3. Run database migrations: `docker compose exec api npx prisma migrate deploy`
4. Seed the initial admin user: `docker compose exec api npx prisma db seed`
5. Admin app: http://localhost:5173 (or `$ADMIN_WEB_PORT`)
6. Guest app placeholder: http://localhost:5174 (or `$GUEST_WEB_PORT`)
7. API: http://localhost:3000 (or `$API_PORT`)

## Running tests

- API: `docker compose exec api npm test` (unit) and `docker compose exec api npm run test:e2e` (e2e)
- Admin web: `docker compose exec admin-web npm test`

## Production deployment

1. On the server, clone this repo and create `.env` with production secrets, including `ADMIN_DOMAIN`, `GUEST_DOMAIN`, `API_DOMAIN`, and `ACME_EMAIL`
2. Point DNS A records for `admin.labrisa.com.ar`, `reservas.labrisa.com.ar`, and `api.labrisa.com.ar` at the server's IP
3. Start: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
4. Run migrations and seed as above, using the same `docker compose -f ... exec` commands
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document local dev and production deployment steps"
```
