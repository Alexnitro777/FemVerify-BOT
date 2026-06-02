Discord-бот для верификации участников через анкеты, с модерацией заявок и апелляциями. Дополнительно автоматически выдаёт роль за тег сервера (Server Tag). Команды — слеш-команды (`/верификация`, `/апелляции`, `/тег`), данные хранятся в SQLite через встроенный модуль `node:sqlite`.

## 1. Структура проекта

```
FemVerify-BOT/
├── src/
│   ├── commands/           Слеш-команды (/верификация, /апелляции — админ, /формы, /формычсп, /тег)
│   ├── buttons/            Кнопки (verifyStart, review — 4 решения, questionClose, appealStart, appealReview)
│   ├── modals/             Модалки (verifySubmit, reviewReason, appealSubmit)
│   ├── handlers/           Автозагрузка обработчиков и роутер interactionCreate
│   ├── roleTag.ts          Детект тега сервера + автовыдача/снятие роли
│   ├── config.ts           Чтение и валидация config.json
│   ├── permissions.ts      Проверка прав (admin / mod) по ролям из конфига
│   ├── questions.ts        Вопросы анкеты и апелляции (до 5 полей — лимит Discord)
│   ├── storage.ts          Хранилище SQLite (node:sqlite): applications + appeals
│   ├── ui.ts               Построение embed и кнопок
│   ├── types.ts            Общие типы
│   ├── deploy-commands.ts  Регистрация slash-команд
│   └── index.ts            Точка входа
├── config.example.json     Шаблон конфига (токен, роли, каналы, категория)
├── config.json             Реальный конфиг (не в git, монтируется в Docker как volume)
├── Dockerfile              Сборка образа
├── docker-compose.yml      Описание сервиса bot
├── tsconfig.json           Настройки TypeScript
├── package.json            Зависимости и npm-скрипты
└── README.md
```

## 2. Быстрый старт с Docker

### 2.1. Предварительные требования

- Установленный Docker (вместе с Docker Compose).
- В Discord Developer Portal включён интент **Server Members Intent**, у бота есть права **Manage Roles** и **Manage Channels**, а его роль выше управляемых ролей.

Если Docker ещё не установлен, поставь его одной командой:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

### 2.2. Установка и запуск

1. **Клонируй репозиторий:**
    
    ```bash
    git clone https://github.com/Alexnitro777/FemVerify-BOT.git
    cd FemVerify-BOT
    ```
    
2. **Настрой конфиг:**
    
    ```bash
    cp config.example.json config.json
    ```
    
    Впиши в `config.json` `token`, `clientId`, `guildId`, ID ролей, каналов и категорию для каналов-вопросов.
    
3. **Запусти бота:**
    
    ```bash
    docker compose up -d --build
    ```
    
    При старте контейнер автоматически регистрирует слеш-команды (`node dist/deploy-commands.js`) и запускает бота. База SQLite сохраняется в `./data/bot.db` на хосте.
    

## 3. Управление контейнером

```bash
# Просмотр логов в реальном времени
docker compose logs -f

# Остановка бота
docker compose stop

# Запуск ранее собранного контейнера
docker compose start

# Перезапуск (например, после правки config.json)
docker compose restart

# Пересборка после изменений в коде
docker compose up -d --build

# Остановка и удаление контейнера
docker compose down
```

> `config.json` смонтирован в контейнер как volume (read-only), база лежит в `./data/bot.db` и переживает пересборку образа. Перезапуск нужен при изменении `config.json`, а пересборка — при изменении кода или добавлении новых команд.
>
