/**
 * `/ask-admin` -- commissioner controls for /ask (log Stage 14, decision 17).
 *
 * The one thing needed weekly in season is `resync`: draft-2026's Tuesday
 * republish is otherwise noticed up to six hours later, and the only faster
 * route was SSH to the host to delete INDEX.md. `status` says whether to run
 * it. `usage` is the only reader of the ledger and the feedback table, which
 * exist to be read. `pause` and `resume` are the incident switch, from a
 * phone, for the design's highest-ranked failure.
 *
 * Gated by Discord itself: the builder's default member permission hides the
 * command from everyone without Administrator, and a server admin can widen
 * that per channel or role in Server Settings without a code change.
 */

import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { ASK } from '../../ask/askConfig.js';
import { credentialConfigured } from '../../ask/askAuth.js';
import { isAskPaused, setAskPaused } from '../../ask/pause.js';
import { inFlight } from '../../ask/concurrency.js';
import { activeThreads } from '../../ask/threadQueue.js';
import { leagueDateTime, startOfDay, startOfMonth } from '../../ask/leagueTime.js';
import {
  countAllQuestionsSince,
  countByUserSince,
  recentRuns,
  recentThumbsDown,
  type UserCount,
  type RecentRun,
  type RecentThumbsDown,
} from '../../ask/askDb.js';
import { ensureFresh, type SyncOutcome } from '../../wpfl/artifactSync.js';
import { cacheExtents, type SourceExtents } from '../../wpfl/historyCache.js';
import { cacheDir, readAsOf, type AsOf } from '../../wpfl/layout.js';
import { warmSqlDatabase } from '../../wpfl/sqlTool.js';
import { getWpflMemberByDiscordId } from '../../constants/wpflMembers.js';
import { NO_MENTIONS } from '../../ask/mentions.js';
import { truncate } from '../../helpers/utils.js';

export const data = new SlashCommandBuilder()
  .setName('ask-admin')
  .setDescription('Commissioner controls for /ask')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription(
        'What /ask is running on: as-of dates, cache extents, queue, credential, pause'
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('resync')
      .setDescription('Fetch the artifact and the decade cache now, ignoring the freshness windows')
  )
  .addSubcommand((sub) =>
    sub
      .setName('usage')
      .setDescription(
        "This month against the cap, today's by member, the last runs and thumbs-downs"
      )
  )
  .addSubcommand((sub) => sub.setName('pause').setDescription('Refuse every /ask until resume'))
  .addSubcommand((sub) => sub.setName('resume').setDescription('Lift a pause'));

export interface AskStatus {
  readonly dataDir: string;
  readonly asOf: AsOf;
  readonly extents: Readonly<Record<string, SourceExtents>>;
  readonly inFlight: number;
  readonly activeThreads: number;
  readonly credential: boolean;
  readonly paused: boolean;
}

export interface AskUsage {
  readonly monthTotal: number;
  readonly monthCap: number;
  readonly today: readonly UserCount[];
  readonly runs: readonly RecentRun[];
  readonly thumbsDown: readonly RecentThumbsDown[];
}

const RECENT = 5;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  let content: string;
  switch (interaction.options.getSubcommand(true)) {
    case 'status':
      content = renderStatus(gatherStatus());
      break;
    case 'resync': {
      const outcome: SyncOutcome = await ensureFresh({ force: true });
      // A reshred retires the materialized database; rebuild it now rather
      // than inside the next member's turn.
      if (outcome.kind === 'reshredded') warmSqlDatabase();
      content = renderSync(outcome);
      break;
    }
    case 'usage':
      content = renderUsage(await gatherUsage());
      break;
    case 'pause':
      setAskPaused(true);
      content = '/ask is paused. `/ask-admin resume` lifts it; so does a restart.';
      break;
    case 'resume':
      setAskPaused(false);
      content = '/ask is back.';
      break;
    default:
      content = 'Unknown subcommand.';
  }

  await interaction.editReply({ content, allowedMentions: NO_MENTIONS });
}

function gatherStatus(): AskStatus {
  return {
    dataDir: ASK.DATA_DIR,
    asOf: readAsOf(),
    extents: cacheExtents(cacheDir(ASK.DATA_DIR)),
    inFlight: inFlight(),
    activeThreads: activeThreads(),
    credential: credentialConfigured(),
    paused: isAskPaused(),
  };
}

async function gatherUsage(): Promise<AskUsage> {
  const now = new Date();
  const [monthTotal, today, runs, thumbsDown] = await Promise.all([
    countAllQuestionsSince(startOfMonth(now)),
    countByUserSince(startOfDay(now)),
    recentRuns(RECENT),
    recentThumbsDown(RECENT),
  ]);
  return { monthTotal, monthCap: ASK.MONTHLY_QUERIES_TOTAL, today, runs, thumbsDown };
}

export function renderStatus(status: AskStatus): string {
  const yesNo = (value: boolean): string => (value ? 'yes' : 'no');
  const extents: string[] = Object.entries(status.extents).map(
    ([file, e]) =>
      `  ${file}: ${e.seasonMin}–${e.seasonMax}${e.latestWeek === null ? '' : `, latest week ${e.latestWeek}`}`
  );

  return [
    '**/ask status**',
    '```',
    `data dir:          ${status.dataDir}`,
    `artifact generated ${status.asOf.generated ?? 'unknown'}`,
    `facts as of        ${status.asOf.factsAsOf ?? 'unknown'}`,
    `news as of         ${status.asOf.newsAsOf ?? 'unknown'}`,
    `artifact etag      ${status.asOf.etag ?? 'unknown'}`,
    `cache fetched      ${status.asOf.cacheFetchedAt ?? 'never'}`,
    ...(extents.length === 0 ? ['  (no cache files)'] : extents),
    `in flight:         ${status.inFlight} (max ${ASK.MAX_CONCURRENT_QUERIES}), threads active: ${status.activeThreads}`,
    `credential set:    ${yesNo(status.credential)}`,
    `paused:            ${yesNo(status.paused)}`,
    '```',
  ].join('\n');
}

export function renderSync(outcome: SyncOutcome): string {
  switch (outcome.kind) {
    case 'reshredded':
      return `Reshredded: ${outcome.files} files, etag ${outcome.etag ?? 'unknown'}. The cache was refreshed with it.`;
    case 'unchanged':
      return 'Unchanged: the published artifact is the build already on disk.';
    case 'fresh':
      return 'Fresh: nothing to do. (A forced resync should not say this; a sync was already in flight.)';
    case 'failed':
      return `Failed: ${outcome.reason}. The previous shred is still serving.`;
  }
}

export function renderUsage(usage: AskUsage): string {
  const seconds = (ms: number | null): string => (ms === null ? '?' : `${Math.round(ms / 1000)} s`);

  const today: string[] =
    usage.today.length === 0
      ? ['  nobody yet']
      : usage.today.map((row) => `  ${memberName(row.userId)}: ${row.count}`);

  const runs: string[] =
    usage.runs.length === 0
      ? ['  none']
      : usage.runs.map(
          (run) =>
            `  ${leagueDateTime(run.createdAt)} ${memberName(run.userId)} · ${run.subtype ?? '?'} · ${seconds(run.durationMs)} · $${run.costUsd.toFixed(2)} est${run.counted ? '' : ' · uncounted'}${run.error === null ? '' : ` · ${run.error}`}\n    "${truncate(run.prompt, 80)}"`
        );

  const downs: string[] =
    usage.thumbsDown.length === 0
      ? ['  none']
      : usage.thumbsDown.map(
          (down) =>
            `  ${leagueDateTime(down.updatedAt)} ${memberName(down.userId)} on message ${down.messageId} in thread ${down.threadId ?? 'unknown'}`
        );

  return [
    '**/ask usage**',
    '```',
    `this month: ${usage.monthTotal} of ${usage.monthCap}`,
    'today:',
    ...today,
    `last ${RECENT} runs:`,
    ...runs,
    `last ${RECENT} thumbs-downs:`,
    ...downs,
    '```',
  ].join('\n');
}

/** A canonical owner name where there is one; a snowflake is never shown as a ping. */
function memberName(userId: string): string {
  return getWpflMemberByDiscordId(userId)?.owner ?? `user ${userId}`;
}
