import { ModalSubmitInteraction, GuildMember, MessageFlags } from 'discord.js';
import { ModalHandler, GuildConfig } from '../types';
import {
  getSpecialBlacklist,
  upsertSpecialBlacklist,
  removeSpecialBlacklist,
} from '../storage';
import { buildDmEmbed, postDecisionMessage } from '../ui';
import { canManageByHierarchy } from '../permissions';
import { logSettledFailures } from '../concurrency';

function getRoleAndName(gc: GuildConfig, type: 'ЧСЗ' | 'ЧСА') {
  if (type === 'ЧСЗ') {
    return { roleId: gc.roles.blacklistZ, name: 'ЧС знакомств' };
  }
  return { roleId: gc.roles.blacklistA, name: 'ЧС администрации' };
}

const handler: ModalHandler = {
  customId: /^special_bl:(add|remove):(ЧСЗ|ЧСА):\d+$/,

  async execute(interaction: ModalSubmitInteraction, gc: GuildConfig): Promise<void> {
    const [, action, rawType, userId] = interaction.customId.split(':');
    const type = rawType as 'ЧСЗ' | 'ЧСА';
    const isAdd = action === 'add';
    const reason = interaction.fields.getTextInputValue('reason').trim();

    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Команду нужно запускать на сервере.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!reason) {
      await interaction.reply({
        content: `Укажите причину ${isAdd ? 'занесения в' : 'снятия с'} ${type}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const guildId = guild.id;
    const { roleId, name } = getRoleAndName(gc, type);

    if (!roleId) {
      await interaction.editReply({
        content: `Роль для ${name} (${type}) не настроена на этом сервере.`,
      });
      return;
    }

    const [user, member, moderator, existing] = await Promise.all([
      interaction.client.users.fetch(userId).catch(() => null),
      guild.members.cache.get(userId) ?? guild.members.fetch(userId).catch(() => null),
      guild.members.cache.get(interaction.user.id) ??
        guild.members.fetch(interaction.user.id).catch(() => null),
      getSpecialBlacklist(guildId, userId, type),
    ]);

    if (!user) {
      await interaction.editReply({ content: 'Пользователь не найден в Discord.' });
      return;
    }

    const hasRole = member?.roles.cache.has(roleId);

    if (member && (!moderator || !canManageByHierarchy(moderator as GuildMember, member))) {
      await interaction.editReply({
        content: `Нельзя изменить роль ${name} участнику, чья роль выше вашей или равна ей.`,
      });
      return;
    }

    const logChannel = gc.channels.blacklistLog ?? gc.channels.decisions;

    if (isAdd) {
      if (hasRole) {
        await interaction.editReply({ content: `Участник уже имеет роль ${name}.` });
        return;
      }
      if (existing) {
        await interaction.editReply({ content: `Участник уже находится в базе данных (${type}).` });
        return;
      }

      let roleOk = true;
      if (member) {
        roleOk = await member.roles
          .add(roleId)
          .then(() => true)
          .catch((e) => {
            console.error(`[specialBlacklistReason] roles.add failed for ${type}`, e);
            return false;
          });
      }

      await upsertSpecialBlacklist({
        guildId,
        userId,
        type,
        reason,
        reviewerId: interaction.user.id,
      });

      const baseReply = `Участник <@${userId}> занесён в ${name} (${type}).`;
      await interaction.editReply({
        content: roleOk
          ? baseReply
          : `${baseReply}\n⚠️ Не удалось выдать роль — проверьте иерархию ролей бота.`,
      });

      const dmText =
        type === 'ЧСЗ'
          ? `Вы добавлены в черный список знакомств.\nПричина: \`${reason}\``
          : `Вы добавлены в черный список администрации.\nПричина: \`${reason}\``;

      logSettledFailures(
        'specialBlacklistReason:add',
        await Promise.allSettled([
          user
            .send({
              embeds: [buildDmEmbed(`🚫 Вы добавлены в ${type}`, dmText, 0x992d22)],
            })
            .catch(() => null),
          postDecisionMessage(interaction.client, logChannel, 'application', {
            label: type,
            color: 0x992d22,
            reviewerId: interaction.user.id,
            targetUserId: userId,
            reason: { title: `Причина ${type}`, text: reason },
            title: `Выдача ${type}`,
          }),
        ]),
      );
    } else {
      if (!hasRole && !existing) {
        await interaction.editReply({ content: `Участник не находится в ${name}.` });
        return;
      }

      let roleOk = true;
      if (member && hasRole) {
        roleOk = await member.roles
          .remove(roleId)
          .then(() => true)
          .catch((e) => {
            console.error(`[specialBlacklistReason] roles.remove failed for ${type}`, e);
            return false;
          });
      }

      await removeSpecialBlacklist(guildId, userId, type);

      const baseReply = `Участник <@${userId}> снят с ${name} (${type}).`;
      await interaction.editReply({
        content: roleOk
          ? baseReply
          : `${baseReply}\n⚠️ Не удалось снять роль — проверьте иерархию ролей бота.`,
      });

      const dmText =
        type === 'ЧСЗ'
          ? `С вас снят черный список знакомств.\nПричина: \`${reason}\``
          : `С вас снят черный список администрации.\nПричина: \`${reason}\``;

      logSettledFailures(
        'specialBlacklistReason:remove',
        await Promise.allSettled([
          user
            .send({
              embeds: [buildDmEmbed(`✅ Снятие ${type}`, dmText, 0x57f287)],
            })
            .catch(() => null),
          postDecisionMessage(interaction.client, logChannel, 'application', {
            label: `Снят ${type}`,
            color: 0x57f287,
            reviewerId: interaction.user.id,
            targetUserId: userId,
            reason: { title: `Причина снятия ${type}`, text: reason },
            title: `Снятие ${type}`,
          }),
        ]),
      );
    }
  },
};

export default handler;
