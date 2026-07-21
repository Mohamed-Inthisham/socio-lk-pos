import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TypedConfigService } from './config/typed-config.service';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(TypedConfigService);

  // Security headers
  app.use(helmet());

  // Parse cookies from incoming requests
  app.use(cookieParser());

  // CORS — allow only your frontend in development
  app.enableCors({
    origin:
      config.get('NODE_ENV') === 'development'
        ? ['http://localhost:5173']
        : false, // tighten for production later
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Global validation — every DTO is validated automatically
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // API versioning prefix
  app.setGlobalPrefix('api/v1');

  // Swagger — dev-only, mounted OUTSIDE the /api/v1 prefix
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SOCIO.LK POS API')
      .setDescription('Point of Sale system for mobile shops in Sri Lanka')
      .setVersion('1.0')
      .addCookieAuth('access_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
      })
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get('PORT');
  await app.listen(port);

  console.log(`🚀 Backend running on http://localhost:${port}/api/v1`);
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start backend:', error);
  process.exit(1);
});
