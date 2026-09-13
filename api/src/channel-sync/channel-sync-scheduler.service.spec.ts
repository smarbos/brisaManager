import { Test } from '@nestjs/testing';
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
});
