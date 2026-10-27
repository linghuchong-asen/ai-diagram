import {
  ClassSerializerInterceptor,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UseInterceptors,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create_user.dto';
import { UpdateUserDto } from './dto/update_user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { Repository } from 'typeorm';
// Task 4 增长埋点:ObservabilityModule 为 @Global,可直接注入
import { GrowthEventService } from '../observability/growth-event.service';
// 邀请裂变批次:BillingService 承载邀请奖励（会员顺延/日上限口径单一来源）,
// UserModule imports BillingModule 取其导出,无循环依赖
import { BillingService } from '../billing/billing.service';
import { sanitizeInviteCode } from '../billing/invite';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    /* Task 4:增长埋点(register 事件) */
    private readonly growthEvent: GrowthEventService,
    /* 邀请裂变批次:注册成功后触发双向奖励（邀请人 +1 天会员 / 被邀请人 +2 次生成） */
    private readonly billingService: BillingService,
  ) {}

  async register(createUser: CreateUserDto) {
    const { username } = createUser;
    const existUser = await this.userRepository.findOne({
      where: { username },
    });
    if (existUser) {
      throw new HttpException('用户名已存在', HttpStatus.BAD_REQUEST);
    }

    /* create方法只是创建了User对象，save方法才是将User对象保存到数据库中 */
    const newUser = await this.userRepository.create(createUser);
    const saved = await this.userRepository.save(newUser);
    // Task 4 增长埋点:注册成功(漏斗起点,埋点是旁路不影响注册主链路)
    // 快赢批次一(QW1):携带渠道归因字段(前端入口捕获 ?ch=/utm_source 存 localStorage 后随注册提交);
    // 防御性裁剪 ≤64 字符并过滤控制字符,channel 为可选字段(未带则不写入事件)
    const rawChannel =
      typeof createUser.channel === 'string' ? createUser.channel.trim() : '';
    const channel = rawChannel
      ? rawChannel.slice(0, 64).replace(/[\r\n\t]/g, '') || undefined
      : undefined;
    // 分享归因批次:白名单 ^[0-9a-f]{32}$（与 project_share.shareToken 同构），非法静默忽略
    const rawShare = typeof createUser.shareToken === 'string' ? createUser.shareToken.trim() : '';
    const shareToken = /^[0-9a-f]{32}$/.test(rawShare) ? rawShare : undefined;
    this.growthEvent.track('register', {
      userId: saved?.id,
      username,
      channel,
      shareToken,
    });

    // 邀请裂变批次:邀请码归因 + 双向奖励。
    // 白名单校验（非法码静默忽略）；归因落库与奖励均为旁路 —— 任何失败不影响注册结果。
    const inviteCode = sanitizeInviteCode(createUser.inviteCode);
    if (inviteCode) {
      try {
        const inviter = await this.userRepository.findOne({
          where: { inviteCode },
        });
        if (inviter && String(inviter.id) !== String(saved.id)) {
          await this.userRepository.update(String(saved.id), {
            invitedBy: inviteCode,
          });
          await this.billingService.applyInviteRewards(String(saved.id), inviteCode);
        }
      } catch (err) {
        // 归因/奖励失败只留痕：注册主链路不受影响
        console.warn(
          `[InviteReferral] 归因或奖励失败(不影响注册): invitee=${saved?.id} code=${inviteCode}`,
          (err as Error)?.message ?? err,
        );
      }
    }
    return saved;
  }

  /** 更新用户信息 */
  async update(user: Partial<UserEntity>) {
    const existUser = await this.userRepository.findOne({
      where: { id: user.id },
    });
    if (!existUser) {
      throw new HttpException('用户不存在', HttpStatus.BAD_REQUEST);
    }
    const updateUser = this.userRepository.merge(existUser, user);
    return await this.userRepository.save(updateUser);
  }

  async getUserById(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    // NOTE: 配置文件路径要结合multer的文件存储路径和serve-static静态服务的路径
    // avatar 存的是绝对路径，Windows 用 \\ 分隔、Linux/macOS 用 / 分隔，需同时兼容
    if (user?.avatar) {
      const userFileName = user.avatar.split(/[\\/]+/).pop();
      user.avatar = `localhost:3001/${userFileName}`;
    }
    return user;
  }
}
