import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * StorageModule: dono do cliente S3 único (Garage). É @Global para que qualquer módulo de arquivos
 * possa injetar StorageService sem reimportá-lo. A integração no AppModule é feita à parte.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
