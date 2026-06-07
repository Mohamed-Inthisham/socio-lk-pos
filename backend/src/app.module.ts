import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/validate-env';
import { TypedConfigModule } from './config/config.module';
import { TypedConfigService } from './config/typed-config.service';
import { buildTypeOrmConfig } from './config/typeorm.config';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    TypedConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [TypedConfigModule],
      inject: [TypedConfigService],
      useFactory: (config: TypedConfigService) => buildTypeOrmConfig(config),
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10, // max 10 requests per second
      },
      {
        name: 'long',
        ttl: 60_000, // 1 minute
        limit: 100, // max 100 requests per minute
      },
    ]),
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
