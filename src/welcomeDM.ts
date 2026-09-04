import { EmbedBuilder, GuildMember } from 'discord.js';

const serversEmbed = new EmbedBuilder()
  .setColor('#ffb6c1')
  .setTitle('Мяу! Добро пожаловать в нашу пушистую семью :3')
  .setDescription(
    'Приветик, милашка! Ищешь компанию самых милых фурри-фембойчиков? Ты попал прямо по адресу! ' +
      'Мы подготовили для тебя два уютных местечка. Выбирай, где твоим лапкам будет комфортнее, ' +
      'или залетай сразу на оба сервера! 👉👈',
  )
  .addFields(
    {
      name: '🎀 Femboy Party [SFW]',
      value:
        'Наш главный, абсолютно безопасный домик! Здесь мы общаемся, играем, делимся артами и просто мурчим в войсах. ' +
        'Никаких пошлостей, только чистая милота и пушистые обнимашки! UwU\n' +
        '**Прыгнуть к нам:** [Тык сюда~](https://discord.gg/jFAFp3WbrJ)',
      inline: false,
    },
    {
      name: '🔞 FemParty Lounge [NSFW]',
      value:
        'Тссс... А это наша секретная зона для тех, кто уже взрослый! Здесь можно расслабиться, ' +
        'делиться горячим контентом и общаться без цензуры. Только для самых смелых котиков\n' +
        '**Зайти на огонек:** [Тык сюда~](https://discord.gg/zNce8fBVny)',
      inline: false,
    },
  )
  .setFooter({ text: 'Ждем только тебя, лапочка! 💖' });

export async function sendWelcomeDM(member: GuildMember): Promise<void> {
  try {
    await member.send({ embeds: [serversEmbed] });
    console.log(`[welcomeDM] отправлено ЛС для ${member.user.tag}`);
  } catch {
    console.log(`[welcomeDM] не удалось отправить ЛС для ${member.user.tag} (закрыты ЛС)`);
  }
}
