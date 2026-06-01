# VerifyBOT

Discord-бот для верификации участников через анкеты, с модерацией и аппеляциями.

## Возможности

- **Верификация**: `/verify` (только админ) размещает embed с кнопкой. Участник заполняет анкету (modal), заявка падает в канал модерации.
- **Модерация** — 4 кнопки под заявкой:
  - **Принять** → выдаётся роль верифицированного + ЛС участнику.
  - **Отклонить** → модалка с причиной → ЛС-embed с отказом.
  - **Задать вопрос** → создаётся приватный канал (участник + модерация) с кнопкой-ссылкой на анкету и кнопкой удаления канала.
  - **ЧС** → модалка с причиной → выдаётся роль ЧСП + ЛС-embed с причиной.
- **Аппеляция**: `/appeal` (только админ) размещает embed с кнопкой. Участник из ЧС подаёт форму, она падает в канал аппеляций с кнопками «Принять амнистию» (снимает роль ЧС) и «Отказать».
- **Тег сервера (Server Tag)**:
  - **Автовыдача роли** — участникам, которые носят тег этого сервера (`guildId` из конфига), автоматически выдаётся роль `roles.serverTag`; при снятии тега роль убирается. Синхронизация идёт по событиям (вход на сервер, изменение участника/пользователя) и одним полным проходом при старте бота. Если `roles.serverTag` не задана — автовыдача отключена.
  - **`/tag`** — выводит embed со статистикой: сколько участников носят тег сервера и сколько всего участников (боты не учитываются).

## Структура

```
src/
  commands/        /verify, /appeal (только админ), /tag
  serverTag.ts     детект тега сервера + автовыдача/снятие роли
  buttons/
    verifyStart      открытие анкеты
    review           4 кнопки модерации (approve/reject/question/blacklist)
    questionClose    удаление приватного канала-вопроса
    appealStart      открытие формы аппеляции
    appealReview     амнистия / отказ
  modals/
    verifySubmit     приём анкеты
    reviewReason     причина отказа / ЧС
    appealSubmit     приём аппеляции
  handlers/        автозагрузка + роутер interactionCreate
  config.ts        чтение/валидация config.json
  questions.ts     вопросы анкеты и аппеляции (до 5 полей — лимит Discord)
  storage.ts       SQLite (встроенный node:sqlite): applications + appeals
  ui.ts            построение embed и кнопок
  types.ts         общие типы
  deploy-commands.ts  регистрация slash-команд
  index.ts         точка входа
```

## Требования

- **Node.js ≥ 22.5** (нужен встроенный модуль `node:sqlite`). На 22.x запускается с флагом `--experimental-sqlite` (уже прописан в npm-скриптах). На Node 24+ работает без флага.

## Запуск (локально / разработка)

1. `npm install`
2. Скопируйте `config.example.json` → `config.json`, заполните токен, ID ролей, каналов и категории.
3. `npm run deploy` — регистрация slash-команд.
4. `npm run dev` (разработка) или `npm run build && npm start`.

## Запуск на Linux-сервере

Пример для Ubuntu 22.04/24.04 / Debian 12. От пользователя без root.

```bash
# 1. Node.js 24 (LTS) через NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2. Клонировать проект
git clone <ваш-репозиторий> femverify-bot
cd femverify-bot

# 3. Установить зависимости и собрать
npm ci
npm run build

# 4. Создать config.json
cp config.example.json config.json
nano config.json   # вписать token, clientId, guildId, ID ролей/каналов/категории

# 5. Зарегистрировать slash-команды (один раз и при изменениях)
npm run deploy

# 6. Запустить
npm start
```

## Запуск в Docker (рекомендуется для сервера)

Docker сам перезапускает контейнер при падении и при ребуте хоста — отдельный systemd не нужен.

```bash
# 1. Установить Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sudo sh

# Если работаете НЕ под root — добавьте текущего пользователя в группу docker,
# иначе `docker` команды потребуют sudo:
#   sudo usermod -aG docker $USER && newgrp docker
# Под root этот шаг пропускается.

# 2. Клонировать и настроить config.json
git clone <ваш-репозиторий> femverify-bot && cd femverify-bot
cp config.example.json config.json
nano config.json   # config.json подключается в контейнер как volume (см. docker-compose.yml)

# 3. Зарегистрировать slash-команды (разово, до запуска контейнера)
docker compose run --rm bot node dist/deploy-commands.js

# 4. Собрать образ и запустить
docker compose up -d --build

# Логи / статус / рестарт
docker compose logs -f
docker compose ps
docker compose restart
docker compose down            # остановить
docker compose up -d --build   # обновить после git pull
```

База SQLite лежит в `./data/bot.db` на хосте (примонтирована как volume), поэтому переживает пересборку образа.

`restart: unless-stopped` в `docker-compose.yml` обеспечивает:
- автоматический рестарт при крэше;
- автоподнятие при перезагрузке сервера;
- остановку только по явной команде `docker compose stop/down`.

### Альтернатива: автозапуск через systemd (без Docker)

Создайте `/etc/systemd/system/femverify-bot.service`:

```ini
[Unit]
Description=VerifyBOT Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=verifybot
WorkingDirectory=/home/verifybot/femverify-bot
ExecStart=/usr/bin/node --experimental-sqlite dist/index.js
Restart=on-failure
RestartSec=5
# Настройки читаются из config.json в WorkingDirectory.
# При необходимости укажите путь явно: Environment=CONFIG_PATH=/home/verifybot/femverify-bot/config.json

[Install]
WantedBy=multi-user.target
```

Активация:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now femverify-bot
sudo systemctl status femverify-bot
sudo journalctl -u femverify-bot -f   # просмотр логов
```

База SQLite создаётся в `./data/bot.db` рядом с проектом — убедитесь, что у пользователя сервиса есть права на запись в эту директорию.

## Требования Discord

- В Developer Portal включить интент **Server Members Intent** (для выдачи ролей).
- Бот должен иметь права: Manage Roles, Manage Channels, и роль бота выше управляемых ролей.

## Настройка вопросов

Редактируйте `src/questions.ts` — `verifyQuestions` и `appealQuestions`. Максимум 5 полей на форму.
