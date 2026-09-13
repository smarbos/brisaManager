import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ChannelSyncSchedulerService } from './channel-sync-scheduler.service';
import { ChannelSyncService } from './channel-sync.service';

describe('ChannelSyncSchedulerService', () => {
  it('calls ChannelSyncService.syncAll on its scheduled handler', async () => {
    const syncAll = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSyncSchedulerService,
        { provide: ChannelSyncService, useValue: { syncAll } },
      ],
    }).compile();

    const scheduler = moduleRef.get(ChannelSyncSchedulerService);
    await scheduler.handleScheduledSync();

    expect(syncAll).toHaveBeenCalled();
  });

  it('does not throw when ChannelSyncService.syncAll rejects, and logs the failure instead', async () => {
    const syncAll = jest.fn().mockRejectedValue(new Error('feed provider unreachable'));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSyncSchedulerService,
        { provide: ChannelSyncService, useValue: { syncAll } },
      ],
    }).compile();

    const scheduler = moduleRef.get(ChannelSyncSchedulerService);
    const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(scheduler.handleScheduledSync()).resolves.toBeUndefined();

    expect(syncAll).toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('feed provider unreachable'),
      expect.anything(),
    );

    loggerErrorSpy.mockRestore();
  });
});
