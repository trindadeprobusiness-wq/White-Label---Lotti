import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { opcoesCors } from './config/cors';
import { AppEnv, ENV } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // O analisador de contrato manda o PDF em base64 no corpo: o limite padrão de
  // 100 kB do Express recusaria com 413 e a tela cairia no caminho antigo.
  app.useBodyParser('json', { limit: '21mb' });
  const env = app.get<AppEnv>(ENV);
  // Com credenciais: o refresh do login próprio viaja num cookie de api.* (ver config/cors.ts).
  // Exceção: as rotas públicas que outros sites chamam (publico/imoveis, publico/leads) têm CORS
  // próprio, sem credenciais ('*' ou PUBLIC_CORS_ORIGINS).
  app.enableCors(opcoesCors(env));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(env.port, '0.0.0.0');
}

void bootstrap();
