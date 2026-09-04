import { Client, Events, GuildMember } from 'discord.js';
import { getGuildConfig } from './guildConfig';
import { getUserGlobalStatus, upsertBlacklistedApplication } from './storage';
import { postDecisionMessage } from './ui';
import { hasServerTag } from './roleTag';
import { resolveJoinMethod } from './inviteTracker';
import { sendWelcomeDM } from './welcomeDM';
import { logSettledFailures } from './concurrency';

const BLACKLIST_REASON = 'Глобальный ЧС при входе';
const VERIFY_REASON = 'Уже верифицирован на другом сервере проекта';

async function handleMemberJoin(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  const guild = member.guild;
  const guildId = guild.id;

  const [gc, status] = await Promise.all([
    getGuildConfig(guildId),
    getUserGlobalStatus(member.id),
  ]);
  if (!gc) return;

  const wanted: string[] = [];
  if (status.blacklisted) wanted.push(gc.roles.blacklist);
  else if (status.verified) wanted.push(gc.roles.verified);
  if (gc.roles.roleTag && hasServerTag(member.user, guildId)) wanted.push(gc.roles.roleTag);

  const toAdd = wanted.filter((roleId) => !member.roles.cache.has(roleId));

  let rolesApplied = true;
  if (toAdd.length > 0) {
    rolesApplied = await member.roles
      .add(toAdd, 'Автоматическая выдача ролей при входе')
      .then(() => true)
      .catch((e) => {
        console.error(`[memberJoin] не удалось выдать роли для ${member.id}:`, e);
        return false;
      });
  }

  const blacklistRoleGranted = rolesApplied && toAdd.includes(gc.roles.blacklist);
  const verifiedRoleGranted = rolesApplied && toAdd.includes(gc.roles.verified);

  const tail: Promise<unknown>[] = [resolveJoinMethod(guild, member.id)];

  if (!status.joinedBefore) tail.push(sendWelcomeDM(member));

  if (status.blacklisted) {
    tail.push(
      upsertBlacklistedApplication({
        guildId,
        userId: member.id,
        username: member.user.tag,
        reason: BLACKLIST_REASON,
        reviewerId: member.client.user.id,
        keepExistingReason: true,
      }),
    );
    if (blacklistRoleGranted) {
      tail.push(
        postDecisionMessage(member.client, gc.channels.blacklistLog, 'application', {
          label: 'Авто-ЧС',
          color: 0x992d22,
          reviewerId: member.client.user.id,
          targetUserId: member.id,
          reason: { title: 'Причина', text: BLACKLIST_REASON },
          title: 'Автоматическая выдача ЧСП',
        }),
      );
    }
  } else if (verifiedRoleGranted) {
    tail.push(
      postDecisionMessage(member.client, gc.channels.decisions, 'application', {
        label: 'Авто-Верификация',
        color: 0x57f287,
        reviewerId: member.client.user.id,
        targetUserId: member.id,
        reason: { title: 'Причина', text: VERIFY_REASON },
        title: 'Автоматическая верификация',
      }),
    );
  }

  logSettledFailures('memberJoin', await Promise.allSettled(tail));
}

export function registerMemberJoin(client: Client): void {
  client.on(Events.GuildMemberAdd, (member) => {
    void handleMemberJoin(member).catch((e) =>
      console.error('[memberJoin] handler failed', e),
    );
  });
}
