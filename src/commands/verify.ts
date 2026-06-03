import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { SlashCommand } from '../types';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('верификация')
    .setDescription('Разместить сообщение с кнопкой верификации в текущем канале')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as unknown as SlashCommand['data'],

  access: 'admin',

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: 'Команду нужно запускать в текстовом канале.', flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('➕ Добро пожаловать!')
      .setColor(0x9b59b6)
      .setDescription(
        'Чтобы получить доступ к серверу, заполни короткую анкету ниже.\n' +
          'Это займёт несколько минут — и поможет нам узнать, кто к нам пришёл.\n\n' +
          '> 💜 Все анкеты проверяет живая администрация, а не бот.\n' +
          '> Чем подробнее и честнее ответы — тем быстрее одобрение.',
      )
      .addFields(
        {
          name: '❓ 1 — Откуда узнал про сервер?',
          value:
            'Конкретно: от кого, с какого сервера, ресурса или соцсети.\n' +
            'Ответы вроде «от друга» или «из интернета» без деталей — отклоняются.',
        },
        {
          name: '💭 2 — Что ожидаешь от сервера?',
          value: 'Расскажи своими словами: общение, игры, ивенты, новые знакомства.',
        },
        {
          name: '📜 3 — Правила прочитаны и приняты?',
          value: 'Достаточно короткого «да», но это значит, что ты с ними ознакомился.',
        },
        {
          name: '📋 Прочитай перед отправкой',
          value:
            'Несколько моментов, из-за которых чаще всего отклоняются анкеты:\n\n' +
            '🔒 **Открой личные сообщения** — без них бот не сможет прислать результат проверки.\n' +
            '⏳ **Подожди** — анкеты не одобряются мгновенно. Каждую проверяет живой администратор.\n' +
            '❓ **Ошибка взаимодействия?** Подожди 1–2 минуты и снова жми кнопку. Если не помогает — напиши администрации в ЛС.',
        },
      )
      .setFooter({ text: 'Нажми кнопку ниже, чтобы открыть анкету' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('verify:start')
        .setLabel('Пройти верификацию')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🟢'),
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: 'Сообщение верификации размещено.', flags: MessageFlags.Ephemeral });
  },
};

export default command;
