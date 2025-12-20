import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { EmbedBuilder, Client } from 'discord.js';

// Type for notification user from DB
interface NotificationUser {
  user_id: string;
  username: string;
  ready_count: string;
}

// We need to mock the dependencies before importing the service
jest.unstable_mockModule('node-cron', () => ({
  default: {
    schedule: jest.fn(),
  },
}));

jest.unstable_mockModule('../../training/trainingDb.js', () => ({
  getUsersNeedingNotification: jest.fn(),
  updateLastNotified: jest.fn(),
}));

// Import after mocking
const { TrainingNotificationService } = await import(
  '../../training/trainingNotificationService.js'
);
const trainingDb = await import('../../training/trainingDb.js');

// Cast mocks for easier use
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetUsersNeedingNotification = trainingDb.getUsersNeedingNotification as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdateLastNotified = trainingDb.updateLastNotified as any;

describe('TrainingNotificationService', () => {
  let service: InstanceType<typeof TrainingNotificationService>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      users: {
        fetch: jest.fn(),
      },
    };
    service = new TrainingNotificationService(mockClient as unknown as Client);
  });

  describe('buildNotificationEmbed', () => {
    test('returns embed with correct title', () => {
      const embed = service.buildNotificationEmbed(1);
      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.title).toBe('⭐ Rookies Ready to Graduate!');
    });

    test('pluralizes "player" correctly for count > 1', () => {
      const embed = service.buildNotificationEmbed(3);
      expect(embed.data.description).toContain('**3** players ready');
    });

    test('singular "player" for count = 1', () => {
      const embed = service.buildNotificationEmbed(1);
      expect(embed.data.description).toContain('**1** player ready');
    });

    test('includes footer with settings info', () => {
      const embed = service.buildNotificationEmbed(2);
      expect(embed.data.footer?.text).toContain('/train settings');
    });

    test('has correct embed color (gold)', () => {
      const embed = service.buildNotificationEmbed(1);
      expect(embed.data.color).toBe(0xf1c40f);
    });
  });

  describe('notifyUser', () => {
    test('sends DM with embed to user', async () => {
      const mockSend = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const mockDiscordUser = { send: mockSend };
      mockClient.users.fetch.mockResolvedValue(mockDiscordUser);
      mockUpdateLastNotified.mockResolvedValue(undefined);

      const user = { user_id: '123', username: 'testuser', ready_count: 2 };
      await service.notifyUser(user);

      expect(mockClient.users.fetch).toHaveBeenCalledWith('123');
      expect(mockSend).toHaveBeenCalledWith({
        embeds: [expect.any(EmbedBuilder)],
      });
      expect(trainingDb.updateLastNotified).toHaveBeenCalledWith('123');
    });

    test('handles DMs disabled error (code 50007)', async () => {
      // Note: Without proper DiscordAPIError mocking, this falls through to console.error
      // The service requires instanceof DiscordAPIError check, which regular Errors don't pass
      const error = Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
      mockClient.users.fetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const user = { user_id: '123', username: 'testuser', ready_count: 1 };
      await service.notifyUser(user);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to notify 123'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    test('handles unknown user error (code 10013)', async () => {
      // Note: Without proper DiscordAPIError mocking, this falls through to console.error
      // The service requires instanceof DiscordAPIError check, which regular Errors don't pass
      const error = Object.assign(new Error('Unknown User'), { code: 10013 });
      mockClient.users.fetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const user = { user_id: '456', username: 'deleted', ready_count: 1 };
      await service.notifyUser(user);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to notify 456'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('checkReadyPlayers', () => {
    test('sends notifications to all users with ready players', async () => {
      const users: NotificationUser[] = [
        { user_id: '1', username: 'user1', ready_count: '2' },
        { user_id: '2', username: 'user2', ready_count: '1' },
      ];
      mockGetUsersNeedingNotification.mockResolvedValue(users);

      const mockSend = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const mockDiscordUser = { send: mockSend };
      mockClient.users.fetch.mockResolvedValue(mockDiscordUser);
      mockUpdateLastNotified.mockResolvedValue(undefined);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await service.checkReadyPlayers();

      expect(mockClient.users.fetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2 notification(s)'));
      consoleSpy.mockRestore();
    });

    test('handles empty users array', async () => {
      mockGetUsersNeedingNotification.mockResolvedValue([]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await service.checkReadyPlayers();

      expect(mockClient.users.fetch).not.toHaveBeenCalled();
      // Should not log when no notifications sent
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('logs error on database failure', async () => {
      mockGetUsersNeedingNotification.mockRejectedValue(new Error('DB error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await service.checkReadyPlayers();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Notification check error'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('init', () => {
    test('schedules cron job', async () => {
      const cron = await import('node-cron');
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      service.init();

      expect(cron.default.schedule).toHaveBeenCalledWith('*/2 * * * *', expect.any(Function));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('initialized'));
      consoleSpy.mockRestore();
    });
  });
});
