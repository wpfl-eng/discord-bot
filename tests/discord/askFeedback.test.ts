import { describe, test, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../../ask/askDb.js', () => ({
  recordFeedback: jest.fn(),
  feedbackCounts: jest.fn(),
}));

const askDb = await import('../../ask/askDb.js');
const { feedbackRow, handleFeedback, FEEDBACK_PREFIX } =
  await import('../../discordCommands/ask/askFeedback.js');
const { findComponentHandler } = await import('../../interactions/componentRouter.js');

/**
 * Two buttons under every answer, counts updated in place (log Stage 14,
 * decision 16). Triage, not learning: a thumbs-down says which thread to open.
 */
describe('askFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (askDb.recordFeedback as jest.Mock).mockImplementation(async () => undefined);
    (askDb.feedbackCounts as jest.Mock).mockImplementation(async () => ({ up: 3, down: 1 }));
  });

  describe('the row', () => {
    test('is two buttons whose ids the router can claim', () => {
      const row = feedbackRow({ up: 0, down: 0 }).toJSON();
      const ids: string[] = row.components.map((c) => (c as { custom_id: string }).custom_id);

      expect(ids).toEqual([`${FEEDBACK_PREFIX}up`, `${FEEDBACK_PREFIX}down`]);
    });

    test('carries the counts on the buttons, so a vote is its own confirmation', () => {
      const row = feedbackRow({ up: 3, down: 1 }).toJSON();
      const labels: string[] = row.components.map((c) => (c as { label: string }).label);

      expect(labels[0]).toMatch(/👍.*3/);
      expect(labels[1]).toMatch(/👎.*1/);
    });

    test('is registered with the component router at import time', () => {
      expect(findComponentHandler(`${FEEDBACK_PREFIX}down`)).not.toBeNull();
    });
  });

  describe('a click', () => {
    const click = (which: 'up' | 'down', over: Record<string, unknown> = {}): never =>
      ({
        isButton: (): boolean => true,
        customId: `${FEEDBACK_PREFIX}${which}`,
        message: { id: 'm1' },
        channelId: 't1',
        user: { id: 'u1' },
        update: jest.fn(async () => undefined),
        deferUpdate: jest.fn(async () => undefined),
        ...over,
      }) as never;

    test('records the vote against the message and the person', async () => {
      await handleFeedback(click('down'));

      expect(askDb.recordFeedback).toHaveBeenCalledWith('m1', 't1', 'u1', -1);
    });

    test('rewrites the buttons with the new counts in place', async () => {
      const interaction = click('up');

      await handleFeedback(interaction);

      const update = (interaction as { update: jest.Mock }).update;
      expect(update).toHaveBeenCalledTimes(1);
      const payload = update.mock.calls[0][0] as { components: { toJSON(): unknown }[] };
      const labels: string[] = (
        payload.components[0].toJSON() as { components: { label: string }[] }
      ).components.map((c) => c.label);
      expect(labels[0]).toMatch(/3/);
      expect(labels[1]).toMatch(/1/);
    });

    test('logs a thumbs-down with the thread, so triage does not wait for an admin query', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});

      await handleFeedback(click('down'));

      expect(log.mock.calls.flat().join(' ')).toMatch(/👎.*t1/);
      log.mockRestore();
    });

    test('acknowledges silently rather than throwing when the write fails', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      (askDb.recordFeedback as jest.Mock).mockImplementation(async () => {
        throw new Error('postgres down');
      });
      const interaction = click('up');

      await expect(handleFeedback(interaction)).resolves.toBeUndefined();

      expect((interaction as { deferUpdate: jest.Mock }).deferUpdate).toHaveBeenCalled();
      error.mockRestore();
    });

    test('ignores anything that is not one of its two buttons', async () => {
      const interaction = click('up', { isButton: (): boolean => false });

      await handleFeedback(interaction);

      expect(askDb.recordFeedback).not.toHaveBeenCalled();
    });
  });
});
