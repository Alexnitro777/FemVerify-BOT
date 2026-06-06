import { TextInputStyle } from 'discord.js';

export interface Question {
  id: string;
  label: string;
  style: TextInputStyle;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
}


export const verifyQuestions: Question[] = [
  {
    id: 'source',
    label: 'Откуда узнал о сервере?',
    style: TextInputStyle.Paragraph,
    required: true,
    maxLength: 200,
    placeholder:
      'Например: от конкретного участника, с конкретного сервера, из TikTok/Telegram по такой-то ссылке…',
  },
  {
    id: 'expectations',
    label: 'Что ожидаешь от сервера?',
    style: TextInputStyle.Paragraph,
    required: true,
    maxLength: 200,
    placeholder: 'Например: ищу друзей, тиммейтов, общение, компанию для игр…',
  },
  {
    id: 'age',
    label: 'Сколько вам лет?',
    style: TextInputStyle.Short,
    required: true,
    maxLength: 4,
    placeholder: 'Укажи свой реальный возраст',
  },
  {
    id: 'community',
    label: 'Твое отношение к фурри/фембой сообществу?',
    style: TextInputStyle.Paragraph,
    required: true,
    maxLength: 300,
    placeholder: 'Как относишься и относишь ли себя к нему — отвечай честно',
  },
  {
    id: 'rules',
    label: 'Правила прочитаны и приняты?',
    style: TextInputStyle.Short,
    required: true,
    maxLength: 30,
    placeholder: 'Да',
  },
];

export const appealQuestions: Question[] = [
  {
    id: 'text',
    label: 'Текст апелляции',
    style: TextInputStyle.Paragraph,
    required: true,
    minLength: 20,
    maxLength: 150,
    placeholder: 'Опиши спокойно: за что, как ты понял ситуацию и почему стоит дать второй шанс.',
  },
];
