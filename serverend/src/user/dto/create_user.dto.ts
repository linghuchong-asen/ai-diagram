import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsFieldNotProvided } from './update_user_decorate.util';

export class CreateUserDto {
  @IsNotEmpty({ message: '用户名不能为空' })
  readonly username: string;
  readonly nickname: string;
  @IsNotEmpty({ message: '密码不能为空' })
  readonly password: string;
  readonly avatar: string;
  readonly email: string;
  readonly role: string;
  /* 快赢批次一(QW1)注册渠道归因:可选字段,仅用于 register 埋点,不落库
     (UserEntity 无 channel 列,TypeORM 自动忽略非列字段) */
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '渠道标识过长' })
  readonly channel?: string;
  /* 邀请裂变批次:可选邀请码。服务端做白名单正则校验后再归因,
     非法/不存在的码一律静默忽略 —— 注册永不因邀请码失败 */
  @IsOptional()
  @IsString()
  @MaxLength(16, { message: '邀请码过长' })
  readonly inviteCode?: string;
  /* 分享归因批次:可选分享 token（32 位 hex），仅用于 register 埋点归因，不落库。
     白名单校验在 service 层（^[0-9a-f]{32}$），非法静默忽略 */
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '分享标识过长' })
  readonly shareToken?: string;
  @IsFieldNotProvided()
  readonly createTime: Date;
  @IsFieldNotProvided()
  readonly updateTime: Date;

  /* 前端传参字段有时和存入数据库中的不一致，以下是一段示例
  @Expose({ name: 'page_size' }) // 转换字段名
  @Transform(({ value }) => parseInt(value, 10)) // 转换值
  readonly pageSize: number;
   */
}
