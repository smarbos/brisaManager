import { GoogleCalendarSchedulerService } from './google-calendar-scheduler.service';
import { GoogleCalendarPullService } from './google-calendar-pull.service';

describe('GoogleCalendarSchedulerService', () => {
  it('calls GoogleCalendarPullService.pull on its scheduled handler', async () => {
    const pull = jest.fn().mockResolvedValue(undefined);
    const scheduler = new GoogleCalendarSchedulerService({ pull } as unknown as GoogleCalendarPullService);

    await scheduler.handleScheduledPull();

    expect(pull).toHaveBeenCalled();
  });

  it('never throws even if the pull rejects', async () => {
    const pull = jest.fn().mockRejectedValue(new Error('boom'));
    const scheduler = new GoogleCalendarSchedulerService({ pull } as unknown as GoogleCalendarPullService);

    await expect(scheduler.handleScheduledPull()).resolves.toBeUndefined();
  });
});
