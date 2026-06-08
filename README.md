# FemVerify-BOT

Discord-бот для верификации участников через анкеты, с модерацией заявок и апелляциями. Дополнительно автоматически выдаёт роль за тег сервера (Server Tag). Команды — слеш-команды (`/верификация`, `/апелляция` — админ; `/анкеты`, `/амнистии`, `/тег` — модерация), данные хранятся в SQLite через встроенный модуль `node:sqlite`.

> Краткий обзор всех возможностей — в [`docs/features.md`](docs/features.md). Подробный разбор всех сценариев верификации и апелляций — в [`docs/verification-and-appeals.md`](docs/verification-and-appeals.md).

## 1. Структура проекта

```
FemVerify-BOT/
├── src/
│   ├── commands/              Слеш-команды
│   │   ├── verify.ts          /верификация (admin) — размещает кнопку анкеты
│   │   ├── appeal.ts          /апелляция (admin) — размещает кнопку апелляции
│   │   ├── forms.ts           /анкеты (mod) — список непринятых анкет
│   │   ├── amnesties.ts       /амнистии (mod) — список непринятых апелляций
│   │   ├── tag.ts             /тег (mod) — статистика по тегу сервера
│   │   └── chsp.ts            /чсп (mod) — занести участника в ЧС (снять все роли + роль ЧС)
│   ├── buttons/               Кнопки
│   │   ├── verifyStart.ts     Старт анкеты (verify:start)
│   │   ├── review.ts          4 решения по анкете (approve/reject/question/blacklist)
│   │   ├── appealStart.ts     Старт апелляции (appeal:start)
│   │   ├── appealReview.ts    3 действия по апелляции (amnesty/deny/question)
│   │   └── questionClose.ts   Закрытие канала-вопроса (question:close)
│   ├── modals/                Модалки
│   │   ├── verifySubmit.ts    Отправка анкеты (verify:submit)
│   │   ├── appealSubmit.ts    Отправка апелляции (appeal:submit)
│   │   └── reviewReason.ts    Причина отклонения / ЧС (review:reason)
│   ├── handlers/
│   │   ├── loader.ts          Автозагрузка команд / кнопок / модалок
│   │   └── interactionCreate.ts  Роутер интеракций + проверка доступа к командам
│   ├── roleTag.ts             Детект тега сервера + автовыдача/снятие роли
│   ├── inviteTracker.ts       Трекинг инвайтов — определяет способ вступления
│   ├── leaveCleanup.ts        Обработка выхода участника (статус left)
│   ├── questionCleanup.ts     Автоудаление просроченных каналов-вопросов (TTL 24 ч)
│   ├── questionRestore.ts     Возврат кнопки «Задать вопрос» при закрытии канала
│   ├── applicationCleanup.ts  Автозакрытие анкет по TTL (48 ч → expired)
│   ├── config.ts              Чтение и валидация config.json
│   ├── permissions.ts         Проверка прав (admin / mod) по ролям из конфига
│   ├── roles.ts               Снятие всех ролей + выдача роли ЧС (общий помощник для ЧС/чсп)
│   ├── questions.ts           Вопросы анкеты (5 полей) и апелляции (1 поле) — лимит Discord 5
│   ├── storage.ts             SQLite (node:sqlite): applications, appeals, counters, join_methods
│   ├── ui.ts                  Построение embed и кнопок
│   ├── types.ts               Общие типы
│   ├── deploy-commands.ts     Регистрация slash-команд
│   └── index.ts               Точка входа
├── docs/
│   ├── features.md                  Краткий обзор возможностей
│   └── verification-and-appeals.md  Полный разбор сценариев верификации и апелляций
├── config.example.json       Шаблон конфига (токен, роли, каналы, категория)
├── config.json               Реальный конфиг (не в git, монтируется в Docker как volume)
├── Dockerfile                Сборка образа (multi-stage, node:24-slim)
├── docker-compose.example.yml  Шаблон описания сервиса bot
├── docker-compose.yml        Реальное описание сервиса (не в git, своё имя image и container_name)
├── tsconfig.json             Настройки TypeScript
├── package.json              Зависимости и npm-скрипты
└── README.md
```

> Бот использует привилегированный intent **Server Members Intent** (`GuildMembers`) — включите его в Discord Developer Portal → Bot → Privileged Gateway Intents, иначе проверки ролей и синхронизация тега работать не будут.
>
> Для определения **способа вступления** (по какому инвайту зашёл участник) боту нужен intent `GuildInvites` (включается в коде) и право **«Управление сервером»** на сервере — без него поле «Способ вступления» в анкете всегда будет «Неизвестно».

## 2. Быстрый старт с Docker

### 2.1. Предварительные требования

- Установленный Docker (вместе с Docker Compose).

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

2. **Настрой конфиг** (заполни токен, роли, каналы, категорию):

    ```bash
    cp config.example.json config.json
    ```

3. **Создай docker-compose.yml** и задай свои `image` и `container_name`:

    ```bash
    cp docker-compose.example.yml docker-compose.yml
    ```

4. **Запусти бота:**

    ```bash
    docker compose up -d --build
    ```

    При старте контейнер автоматически регистрирует слеш-команды (`node --experimental-sqlite dist/deploy-commands.js`) и запускает бота. База SQLite сохраняется в `./data/bot.db` на хосте.

## 3. Управление контейнером

- **Логи в реальном времени** — `docker compose logs -f`
- **Остановить бота** — `docker compose stop`
- **Запустить ранее собранный контейнер** — `docker compose start`
- **Перезапустить** (после правки `config.json`) — `docker compose restart`
- **Пересобрать** (после изменений в коде или добавления команд) — `docker compose up -d --build`
- **Остановить и удалить контейнер** — `docker compose down`

> `config.json` смонтирован в контейнер как volume (read-only), база лежит в `./data/bot.db` и переживает пересборку образа. Перезапуск нужен при изменении `config.json`, а пересборка — при изменении кода или добавлении новых команд. Файлы `config.json` и `docker-compose.yml` не в git — это твои локальные копии шаблонов.
