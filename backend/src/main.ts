import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TypedConfigService } from './config/typed-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(TypedConfigService);

  // Security headers
  app.use(helmet());

  // CORS — allow only your frontend in development
  app.enableCors({
    origin:
      config.get('NODE_ENV') === 'development'
        ? ['http://localhost:5173']
        : false, // tighten for production later
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // API versioning prefix
  app.setGlobalPrefix('api/v1');

  const port = config.get('PORT');
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`🚀 Backend running on http://localhost:${port}/api/v1`);
}
bootstrap();
