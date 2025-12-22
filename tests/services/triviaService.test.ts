import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { EmbedBuilder, Client } from 'discord.js';

// Mock dependencies before importing
jest.unstable_mockModule('../../trivia/triviaDb.js', () => ({
  isQuestionAsked: jest.fn(),
  recordQuestionHash: jest.fn(),
  saveActiveQuestion: jest.fn(),
  getActiveQuestion: jest.fn(),
  getAnyActiveQuestion: jest.fn(),
  getUserAnswer: jest.fn(),
  recordAnswer: jest.fn(),
  addPoints: jest.fn(),
  getCorrectAnswers: jest.fn(),
  closeQuestion: jest.fn(),
}));

jest.unstable_mockModule('../../economy/economyDb.js', () => ({
  getOrCreateUser: jest.fn(),
  addToWallet: jest.fn(),
}));

jest.unstable_mockModule('../../nflmon/nflmonService.js', () => ({
  rollForNflmon: jest.fn(),
  addXpToTraining: jest.fn(),
}));

// Import after mocking
const { TriviaService } = await import('../../trivia/triviaService.js');
const triviaDb = await import('../../trivia/triviaDb.js');

// Cast mocks for easier use
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetActiveQuestion = triviaDb.getActiveQuestion as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetAnyActiveQuestion = triviaDb.getAnyActiveQuestion as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetCorrectAnswers = triviaDb.getCorrectAnswers as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCloseQuestion = triviaDb.closeQuestion as any;

describe('TriviaService', () => {
  let service: InstanceType<typeof TriviaService>;
  let mockClient: Partial<Client>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockChannel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockChannelFetch: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockChannel = {
      send: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      isTextBased: () => true,
    };

    mockChannelFetch = jest.fn<() => Promise<unknown>>().mockResolvedValue(mockChannel);

    mockClient = {
      channels: {
        fetch: mockChannelFetch,
      } as unknown as Client['channels'],
    };

    service = new TriviaService(mockClient as Client);
  });

  describe('buildQuestionEmbed', () => {
    const question = {
      id: '1',
      question: 'Who won Super Bowl LI?',
      answer: 'Patriots',
      type: 'free_form' as const,
      point_value: 2,
    };
    const windowClosesAt = new Date('2024-01-01T14:00:00Z');

    test('uses correct color for nfl category', () => {
      const embed = service.buildQuestionEmbed(question, 'nfl', windowClosesAt);
      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBe(0x013369);
      expect(embed.data.title).toBe('NFL Trivia');
    });

    test('uses correct color for wpfl category', () => {
      const embed = service.buildQuestionEmbed(question, 'wpfl', windowClosesAt);
      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBe(0x00ff88);
      expect(embed.data.title).toBe('WPFL Trivia');
    });

    test('includes question in description', () => {
      const embed = service.buildQuestionEmbed(question, 'nfl', windowClosesAt);
      expect(embed.data.description).toBe('Who won Super Bowl LI?');
    });

    test('includes point value in embed', () => {
      const embed = service.buildQuestionEmbed(question, 'nfl', windowClosesAt);
      const pointsField = embed.data.fields?.find((f) => f.name === 'Points');
      expect(pointsField?.value).toBe('2');
    });

    test('uses default point value of 1 when not specified', () => {
      const noPointsQuestion = { ...question, point_value: undefined };
      const embed = service.buildQuestionEmbed(noPointsQuestion, 'nfl', windowClosesAt);
      const pointsField = embed.data.fields?.find((f) => f.name === 'Points');
      expect(pointsField?.value).toBe('1');
    });
  });

  describe('buildResultsEmbed', () => {
    const question = {
      id: 1,
      category: 'nfl' as const,
      question: 'Who won Super Bowl LI?',
      answer: 'Patriots',
      acceptable_answers: null,
      choices: null,
      point_value: 2,
      channel_id: '123',
      window_closes_at: new Date(),
      is_closed: false,
    };

    test('lists winner usernames', () => {
      const winners = [{ username: 'user1' }, { username: 'user2' }];
      const embed = service.buildResultsEmbed(question, winners, 'nfl');

      const winnersField = embed.data.fields?.find((f) => f.name.includes('Winners'));
      expect(winnersField?.value).toBe('user1, user2');
    });

    test('shows "No one got it!" when no winners', () => {
      const embed = service.buildResultsEmbed(question, [], 'nfl');

      const winnersField = embed.data.fields?.find((f) => f.name.includes('Winners'));
      expect(winnersField?.value).toBe('No one got it!');
    });

    test('shows answer in embed', () => {
      const embed = service.buildResultsEmbed(question, [], 'nfl');

      const answerField = embed.data.fields?.find((f) => f.name === 'Answer');
      expect(answerField?.value).toBe('Patriots');
    });

    test('includes point value in winners field name', () => {
      const embed = service.buildResultsEmbed(question, [], 'nfl');

      const winnersField = embed.data.fields?.find((f) => f.name.includes('Winners'));
      expect(winnersField?.name).toContain('+2 pts');
    });
  });

  describe('closeCurrentQuestion', () => {
    test('posts results embed to channel', async () => {
      mockGetAnyActiveQuestion.mockResolvedValue({
        id: 1,
        category: 'nfl',
        question_id: '1',
        question: 'Test question?',
        answer: 'Test answer',
        acceptable_answers: null,
        choices: null,
        type: 'free_form',
        point_value: 1,
        source_data: null,
        channel_id: '123456789',
        window_closes_at: new Date(),
        is_closed: false,
        sent_at: new Date(),
      });
      mockGetCorrectAnswers.mockResolvedValue([{ user_id: '123', username: 'winner' }]);
      mockCloseQuestion.mockResolvedValue(undefined);

      await service.closeCurrentQuestion();

      expect(mockChannel.send).toHaveBeenCalledWith({
        embeds: [expect.any(EmbedBuilder)],
      });
      expect(triviaDb.closeQuestion).toHaveBeenCalledWith(1);
    });

    test('does nothing if no active question', async () => {
      mockGetAnyActiveQuestion.mockResolvedValue(null);

      await service.closeCurrentQuestion();

      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    test('does nothing if question already closed', async () => {
      mockGetAnyActiveQuestion.mockResolvedValue({
        id: 1,
        category: 'nfl',
        question_id: '1',
        question: 'Test?',
        answer: 'Answer',
        acceptable_answers: null,
        choices: null,
        type: 'free_form',
        point_value: 1,
        source_data: null,
        channel_id: '123',
        window_closes_at: new Date(),
        is_closed: true,
        sent_at: new Date(),
      });

      await service.closeCurrentQuestion();

      expect(triviaDb.getCorrectAnswers).not.toHaveBeenCalled();
    });
  });
});
