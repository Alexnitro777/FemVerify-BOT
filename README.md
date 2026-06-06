# FemVerify-BOT

Discord-бот для верификации участников через анкеты, с модерацией заявок и апелляциями. Дополнительно автоматически выдаёт роль за тег сервера (Server Tag). Команды — слеш-команды (`/верификация`, `/апелляция` — админ; `/анкеты`, `/амнистии`, `/тег` — модерация), данные хранятся в SQLite через встроенный модуль `node:sqlite`.

> Подробный разбор всех сценариев верификации и апелляций — в [`docs/verification-and-appeals.md`](docs/verification-and-appeals.md). Список известных багов — в [`BUGS.md`](BUGS.md).

## 1. Структура проекта

```
FemVerify-BOT/
├── src/
│   ├── commands/              Слеш-команды
│   │   ├── verify.ts          /верификация (admin) — размещает кнопку анкеты
│   │   ├── appeal.ts          /апелляция (admin) — размещает кнопку апелляции
│   │   ├── forms.ts           /анкеты (mod) — список непринятых анкет
│   │   ├── amnesties.ts       /амнистии (mod) — список непринятых апелляций
│   │   └── tag.ts             /тег (mod) — статистика по тегу сервера
│   ├── buttons/               Кнопки
│   │   ├── verifyStart.ts     Старт анкеты (verify:start)
│   │   ├── review.ts          4 решения по анкете (approve/reject/question/blacklist)
│   │   ├── appealStart.ts     Старт апелляции (appeal:start)
│   │   ├── appealReview.ts    3 действия по апелляции (amnesty/deny/question)
│   │   └── questionClose.ts   Закрытие канала-вопроса
│   ├── modals/                Модалки
│   │   ├── verifySubmit.ts    Отправка анкеты
│   │   ├── appealSubmit.ts    Отправка апелляции
│   │   └── reviewReason.ts    Причина отклонения / ЧС
│   ├── handlers/              Автозагрузка обработчиков (loader) и роутер interactionCreate
│   ├── roleTag.ts             Детект тега сервера + автовыдача/снятие роли
│   ├── leaveCleanup.ts        Обработка выхода участника (статус left)
│   ├── questionCleanup.ts     Автоудаление просроченных каналов-вопросов (TTL 24 ч)
│   ├── questionRestore.ts     Возврат кнопки «Задать вопрос» при закрытии канала
│   ├── applicationCleanup.ts  Автозакрытие анкет по TTL (48 ч → expired)
│   ├── config.ts              Чтение и валидация config.json
│   ├── permissions.ts         Проверка прав (admin / mod) по ролям из конфига
│   ├── questions.ts           Вопросы анкеты и апелляции (до 5 полей — лимит Discord)
│   ├── storage.ts             Хранилище SQLite (node:sqlite): applications + appeals + counters
│   ├── ui.ts                  Построение embed и кнопок
│   ├── types.ts               Общие типы
│   ├── deploy-commands.ts     Регистрация slash-команд
│   └── index.ts               Точка входа
├── docs/
│   └── verification-and-appeals.md  Разбор всех сценариев верификации и апелляций
├── config.example.json       Шаблон конфига (токен, роли, каналы, категория)
├── config.json               Реальный конфиг (не в git, монтируется в Docker как volume)
├── BUGS.md                   Список известных багов и пограничных случаев
├── Dockerfile                Сборка образа
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
    
2. **Настрой конфиг:**
    
    ```bash
    cp config.example.json config.json
    ```
    
3. **Создай docker-compose.yml:**
    
    ```bash
    cp docker-compose.example.yml docker-compose.yml
    ```
    
    Открой `docker-compose.yml` и задай свои значения `image` и `container_name` (по умолчанию в шаблоне стоят плейсхолдеры `your-image-name:latest` и `your-container-name`).
    
4. **Запусти бота:**
    
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

> `config.json` смонтирован в контейнер как volume (read-only), база лежит в `./data/bot.db` и переживает пересборку образа. Перезапуск нужен при изменении `config.json`, а пересборка — при изменении кода или добавлении новых команд. Файлы `config.json` и `docker-compose.yml` не в git — это твои локальные копии шаблонов.
>
