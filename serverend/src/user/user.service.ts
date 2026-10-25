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

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    /* Task 4:增长埋点(register 事件) */
    private readonly growthEvent: GrowthEventService,
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
    this.growthEvent.track('register', { userId: saved?.id, username });
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
