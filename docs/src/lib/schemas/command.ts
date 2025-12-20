import { z } from 'zod';

export const commandOptionSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.enum(['string', 'integer', 'number', 'boolean', 'user']),
  required: z.boolean(),
  choices: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  autocomplete: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const commandSubcommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  options: z.array(commandOptionSchema).optional(),
});

export const commandExampleSchema = z.object({
  input: z.string(),
  output: z.string(),
  note: z.string().optional(),
});

export const commandCooldownSchema = z.object({
  duration: z.number(),
  unit: z.enum(['seconds', 'minutes', 'hours']),
});

export const commandSchema = z.object({
  name: z.string(),
  description: z.string(),
  longDescription: z.string().optional(),
  category: z.string(),
  categorySlug: z.string(),
  usage: z.array(z.string()),
  options: z.array(commandOptionSchema).optional(),
  subcommands: z.array(commandSubcommandSchema).optional(),
  examples: z.array(commandExampleSchema).optional(),
  relatedCommands: z.array(z.string()).optional(),
  tips: z.array(z.string()).optional(),
  ephemeral: z.boolean().optional(),
  cooldown: commandCooldownSchema.optional(),
  gameConfig: z.record(z.unknown()).optional(),
});

export const commandCategorySchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  icon: z.string(),
  commands: z.array(commandSchema),
});

export type ValidatedCommand = z.infer<typeof commandSchema>;
export type ValidatedCommandCategory = z.infer<typeof commandCategorySchema>;
