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
    label: 'Откуда узнали про сервер?',
    style: TextInputStyle.Paragraph,
    required: true,
    maxLength: 50,
    placeholder:
      'Например: от конкретного участника, с конкретного сервера, из TikTok/Telegram по такой-то ссылке…',
  },
  {
    id: 'expectations',
    label: 'Что ожидаете от сервера?',
    style: TextInputStyle.Paragraph,
    required: true,
    maxLength: 150,
    placeholder: 'Например: хочу найти друзей, общение, компанию для игр, ивенты…',
  },
  {
    id: 'rules',
    label: 'Читали ли правила и согласны ли вы с ними?',
    style: TextInputStyle.Short,
    required: true,
    maxLength: 30,
    placeholder: 'Да, прочитал(а) и согласен(на)',
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
    placeholder: 'Опиши спокойно: за что, как ты понял ситуацию, и почему стоит дать второй шанс.',
  },
];
