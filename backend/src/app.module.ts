import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/validate-env';
import { TypedConfigModule } from './config/config.module';
import { TypedConfigService } from './config/typed-config.service';
import { buildTypeOrmConfig } from './config/typeorm.config';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
