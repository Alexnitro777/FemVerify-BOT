import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  Client,
  Collection,
} from 'discord.js';

export interface SlashCommand {
  data: Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  // Уровень доступа к команде. Если не задан — считается 'admin'.
  // 'admin' — только администраторы; 'mod' — администраторы и модераторы.
  access?: 'admin' | 'mod';
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface ButtonHandler {
  customId: string | RegExp;
  execute: (interaction: ButtonInteraction) => Promise<void>;
}

export interface ModalHandler {
  customId: string | RegExp;
  execute: (interaction: ModalSubmitInteraction) => Promise<void>;
}

export interface BotClient extends Client {
  commands: Collection<string, SlashCommand>;
  buttons: Collection<string, ButtonHandler>;
  modals: Collection<string, ModalHandler>;
}

export type ApplicationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'blacklisted';

export type AppealStatus = 'pending' | 'amnestied' | 'denied';

export interface Application {
  userId: string;
  username: string;
  guildId: string;
  answers: Record<string, string>;
  submittedAt: number;
  status: ApplicationStatus;
  reviewMessageUrl?: string;
  reviewerId?: string;
  reason?: string;
  questionChannelId?: string;
}

export interface Appeal {
  userId: string;
  username: string;
  text: string;
  submittedAt: number;
  status: AppealStatus;
  reviewMessageUrl?: string;
  reviewerId?: string;
  reason?: string;
  // Момент обработки модератором (amnesty/deny). От него считается cooldown 48 ч.
  resolvedAt?: number;
}
