import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  UseInterceptors,
  UploadedFiles,
  Logger,
  ClassSerializerInterceptor,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create_user.dto';
import { UpdateUserDto } from './dto/update_user.dto';
import { UserEntity } from './entities/user.entity';
import { JwtAuthGuard } from 'src/auth/auth.guard';
import { AuthRateLimitGuard } from 'src/auth/auth-rate-limit.guard';
import * as path from 'path';
import * as fs from 'fs';

const logger = new Logger('UserController');
@Controller('user')
@UseInterceptors(ClassSerializerInterceptor) // 所有的返回结果排除password字段
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('register')
  // 商业化首发加固：注册限流（同 IP 10 分钟最多 5 次，防公开上线后批量刷号）
  @UseGuards(AuthRateLimitGuard)
  async register(
    // @UploadedFiles() files: Express.Multer.File[],
    @Body() createUserDto: CreateUserDto,
  ) {
    return await this.userService.register(createUserDto);
  }
  /** 更新用户信息 */
  /*  注册时只需要用户名和密码，头像角色等信息可以登录后修改 
      使用 multer 作为中间层实现解析content-type为multipart/form-data的请求 
      FileInterceptor：适合接收单独的file类型参数
      FilesInterceptor：适合当传参中既有string又有file类型,且只有一个file字段
      FileFieldsInterceptor：一个参数可以是数组，适合当传参中有多个字段是file类型
  */
  @Patch('update')
  @UseGuards(JwtAuthGuard)
  // @UseGuards(AuthGuard('jwt')) // 这种方式能调用JwtStrategy，但是不能调用到JwtAuthGuard
  // @UseInterceptors(
  //   //  NOTE:第一个参数要和传参中file类型的字段名称一致
  //   FilesInterceptor('avatar', 10), //FilesInterceptor 是一个特定的拦截器，用于处理多文件上传。会将拦截到的文件交给multer处理
  // )
  async update(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() userInfo: UpdateUserDto,
    @Req() req,
  ) {
    /*  logger.log(req); // req.user即为数据库中查询出来user的完整信息，是在JwtStrategy的validate方法中返回的
     logger.log(files); // files.path即为文件绝对路径
     logger.log(userInfo); // 此次传入的非file类型字段 */

    const newUser = { id: req.user.id, avatar: files[0].path, ...userInfo };
    return await this.userService.update(newUser);
  }

  /** 获取用户信息 */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getUserInfo(@Req() req) {
    const user = req.user as UserEntity;
    return await this.userService.getUserById(user.id);
  }

  /**试验：接收Content-Type为application/json,image/png的请求 */
  @Post('testUpload')
  test(
    @Body() body: any,
    @Req() req,
    @Res() res,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const uploadPath = path.join(__dirname, '../../../', 'testUploads');
    const contentDisposition = req.headers['content-disposition'] as string;
    // 提取文件名
    const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
    if (!filenameMatch) {
      return res
        .status(400)
        .json({ message: 'Invalid Content-Disposition header' });
    }
    const filename = filenameMatch[1];

    // 创建一个文件写入流，保存文件到服务器
    const writeStream = fs.createWriteStream(path.join(uploadPath, filename));
    // note:将请求流直接写入文件,适用于客户端单独的上传一个文件的情况;另外一个方式是采用raw-body库封装一个中间件
    req.pipe(writeStream).on('error', (err) => {
      logger.error('Error writing to file:', err);
      res.status(500).send('Internal Server Error');
    });

    req.on('end', () => {
      res.status(200).send({ message: 'Image uploaded successfully' });
    });

    req.on('error', (err) => {
      logger.error('Upload error:', err);
      res.status(500).send({ error: 'File upload failed' });
    });
  }
}
