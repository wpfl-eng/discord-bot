import { Collection } from 'discord.js';
import type { TriviaService } from '../trivia/triviaService.js';
import type { CommandModule } from './commands.js';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, CommandModule>;
    triviaService: TriviaService;
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DISCORD_TOKEN: string;
      DISCORD_CLIENT_ID: string;
      DISCORD_GUILD_ID: string;
      ESPN_S2: string;
      SWID: string;
      LEAGUE_ID: string;
      SLEEPER_LEAGUE_ID?: string;
      OPEN_API_KEY?: string;
      API_KEY?: string;
      BOT_ID?: string;
      GENERAL_CHANNEL_ID?: string;
      PORT?: string;
    }
  }
}

export {};
