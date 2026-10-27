// 语图留存与裂变加强批次 - 每日签到服务单测（纯逻辑直测，mock 仓库）
// 覆盖：首签发奖、当日幂等、连签续期、断签重置、满 7 天送会员、旁路容错。
import { CheckinService, CHECKIN_VIP_CYCLE } from './checkin.service';
import { inviteDayKey } from '../../billing/invite';

/** 仓库桩：findOne / save / create / query（默认无实现，用例按需 mock） */
function makeRepo() {
  return {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    query: jest.fn(),
  };
}

function makeService() {
  const checkinRepo = makeRepo();
  const usageRepo = makeRepo();
  const billing = { grantVipDays: jest.fn(async () => new Date()) };
  const service = new CheckinService(
    checkinRepo as never,
    usageRepo as never,
    billing as never,
  );
  return { service, checkinRepo, usageRepo, billing };
}

const TODAY = inviteDayKey();

describe('每日签到（留存与裂变加强批次）', () => {
  it('首次签到：streak=1，额度 +1，无会员奖励', async () => {
    const { service, checkinRepo, usageRepo, billing } = makeService();
    checkinRepo.findOne.mockResolvedValue(null); // 今日未签 & 昨日未签
    checkinRepo.save.mockImplementation((x: unknown) => Promise.resolve(x));

    const result = await service.checkin('u1');

    expect(result).toMatchObject({
      checkedToday: true,
      streak: 1,
      alreadyChecked: false,
      bonusGranted: true,
      vipRewarded: false,
    });
    expect(checkinRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', day: TODAY, streak: 1 }),
    );
    // 额度奖励 SQL：bonus_generate +1
    expect(usageRepo.query).toHaveBeenCalledTimes(1);
    expect(String(usageRepo.query.mock.calls[0][0])).toContain('bonus_generate');
    expect(billing.grantVipDays).not.toHaveBeenCalled();
  });

  it('当日重复签到 → 幂等返回，不再发奖不落库', async () => {
    const { service, checkinRepo, usageRepo, billing } = makeService();
    checkinRepo.findOne.mockResolvedValueOnce({ userId: 'u1', day: TODAY, streak: 3 });

    const result = await service.checkin('u1');

    expect(result).toMatchObject({ checkedToday: true, streak: 3, alreadyChecked: true, bonusGranted: false });
    expect(checkinRepo.save).not.toHaveBeenCalled();
    expect(usageRepo.query).not.toHaveBeenCalled();
    expect(billing.grantVipDays).not.toHaveBeenCalled();
  });

  it(`昨日已签 streak=${CHECKIN_VIP_CYCLE - 1} → 今日连签满 7 天 → 会员 +1 天`, async () => {
    const { service, checkinRepo, billing } = makeService();
    checkinRepo.findOne
      .mockResolvedValueOnce(null) // 今日未签
      .mockResolvedValueOnce({ userId: 'u1', day: inviteDayKey(new Date(Date.now() - 86_400_000)), streak: 6 }); // 昨日 6 天
    checkinRepo.save.mockImplementation((x: unknown) => Promise.resolve(x));

    const result = await service.checkin('u1');

    expect(result.streak).toBe(7);
    expect(result.vipRewarded).toBe(true);
    expect(billing.grantVipDays).toHaveBeenCalledWith('u1', 1, 'checkin_vip');
  });

  it('断签（昨日无记录）→ streak 重置 1，无会员奖励', async () => {
    const { service, checkinRepo, billing } = makeService();
    checkinRepo.findOne
      .mockResolvedValueOnce(null) // 今日未签
      .mockResolvedValueOnce(null); // 昨日未签
    checkinRepo.save.mockImplementation((x: unknown) => Promise.resolve(x));

    const result = await service.checkin('u1');

    expect(result.streak).toBe(1);
    expect(result.vipRewarded).toBe(false);
    expect(billing.grantVipDays).not.toHaveBeenCalled();
  });

  it('额度发放失败 → 签到仍成功（bonusGranted=false，旁路）', async () => {
    const { service, checkinRepo, usageRepo } = makeService();
    checkinRepo.findOne.mockResolvedValue(null);
    checkinRepo.save.mockImplementation((x: unknown) => Promise.resolve(x));
    usageRepo.query.mockRejectedValue(new Error('db down'));

    const result = await service.checkin('u1');

    expect(result.checkedToday).toBe(true);
    expect(result.bonusGranted).toBe(false);
    expect(result.vipRewarded).toBe(false);
  });

  it('status：今日已签 → checkedToday=true；异常 → 按未签兜底', async () => {
    const { service, checkinRepo } = makeService();
    checkinRepo.findOne
      .mockResolvedValueOnce({ userId: 'u1', day: TODAY, streak: 2 })
      .mockResolvedValueOnce({ userId: 'u1', day: TODAY, streak: 2 });
    expect(await service.status('u1')).toEqual({ checkedToday: true, streak: 2 });

    checkinRepo.findOne.mockRejectedValue(new Error('db down'));
    expect(await service.status('u1')).toEqual({ checkedToday: false, streak: 0 });
  });
});
