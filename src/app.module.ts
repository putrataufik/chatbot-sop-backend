import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Import semua module yang sudah di-generate sebelumnya
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SopDocumentsModule } from './modules/sop-documents/sop-documents.module';
import { ChatModule } from './modules/chat/chat.module';
import { RlmModule } from './modules/rlm/rlm.module';
import { TokenUsageLog } from './modules/rlm/entities/token-usage-log.entity';

@Module({
  imports: [
    // 1. Setup ConfigModule untuk membaca file .env secara global
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. Setup TypeORM dengan koneksi ke MySQL
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USERNAME', 'chatbot_user'),
        password: configService.get<string>('DB_PASSWORD', 'chatbot_password'),
        
        // PERUBAHAN DI SINI: Sesuaikan dengan .env milikmu (DB_NAME)
        database: configService.get<string>('DB_NAME', 'chatbot_sop_db'),
        
        autoLoadEntities: true, 
        synchronize: true, 
      }),
    }),

    // 3. Daftarkan module aplikasi
    AuthModule,
    UsersModule,
    SopDocumentsModule,
    ChatModule,
    RlmModule,
  ],
})
export class AppModule {}