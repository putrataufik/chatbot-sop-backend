import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Global prefix → semua endpoint: /api/chatbot-sop/...
  app.setGlobalPrefix('api/chatbot-sop');

  // 2. Validasi otomatis semua DTO
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 3. CORS untuk Angular nanti
  app.enableCors({
    origin: 'http://localhost:4200',
    credentials: true,
  });

  // 4. Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Chatbot SOP API')
    .setDescription(
      'REST API untuk Chatbot SOP berbasis Recursive Language Model',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  fs.writeFileSync('./swagger-spec.json', JSON.stringify(document, null, 2));

  // 5. Jalankan server
  const port = process.env.APP_PORT || 3000;
  await app.listen(port);

  console.log(`
  ================================================
   Chatbot SOP Backend is running!
  ================================================
   API     : http://localhost:${port}/api/chatbot-sop
   Swagger : http://localhost:${port}/api/docs
  ================================================
  `);
}
bootstrap();