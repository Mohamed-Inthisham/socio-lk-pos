import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { TypedConfigService } from './typed-config.service';

export function buildTypeOrmConfig(
  config: TypedConfigService,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.get('DB_HOST'),
    port: config.get('DB_PORT'),
    username: config.get('DB_USERNAME'),
    password: config.get('DB_PASSWORD'),
    database: config.get('DB_NAME'),

    // Industrial-grade settings
    synchronize: false, // NEVER true in any environment — migrations only
    logging:
      config.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],

    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],

    // Connection pool
    extra: {
      max: 20, // max concurrent connections
    },
  };
}
