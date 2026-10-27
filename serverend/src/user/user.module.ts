import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
// 邀请裂变批次:注册链路触发邀请奖励（BillingService 为奖励口径单一来源），
// BillingModule 仅依赖 TypeOrm，与本模块无循环依赖
import { BillingModule } from '../billing/billing.module';

import * as path from 'path';
// const diskStorage = require('@nestjs/platform-express/multer');
@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    MulterModule.register({
      /*  diskStorage 来配置文件存储路径和文件命名规则 */
      storage: diskStorage({
        destination: path.resolve(__dirname, '../../../uploads'), // 指定文件存储的目录
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = path.extname(file.originalname);
          cb(null, file.fieldname + '-' + uniqueSuffix + ext); // 生成唯一的文件名
        },
      }),
    }),
    // 邀请裂变批次:取 BillingService（applyInviteRewards）
    BillingModule,
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
