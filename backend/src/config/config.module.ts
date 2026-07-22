import { Global, Module } from '@nestjs/common';
import { TypedConfigService } from './typed-config.service';

@Global()
@Module({
  providers: [TypedConfigService],
  exports: [TypedConfigService],
})
export class TypedConfigModule {}
