import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';

@Module({
  imports: [EnvModule],
})
export class AppModule {}
