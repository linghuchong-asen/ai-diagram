import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        // health 端点依赖 DataSource：单测用最小桩（仅 query: SELECT 1）
        {
          provide: DataSource,
          useValue: { query: jest.fn().mockResolvedValue([{ ok: 1 }]) },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('DB 可连通时返回 ok/db=up', async () => {
      const res = await appController.health();
      expect(res.status).toBe('ok');
      expect(res.db).toBe('up');
      expect(res.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });
});
