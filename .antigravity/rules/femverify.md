# FemVerify-BOT — правила для работы с кодовой базой

## Абсолютные правила

- **Никогда не пиши комментарии** ни в одном файле (`.ts`, `.json`, `Dockerfile` и т.д.). Единственное исключение — `docker-compose.example.yml`. Пиши самодокументирующийся код (понятные имена, короткие функции).
- **Документация описывает только Docker-воркфлоу.** `README.md`, `CLAUDE.md` и `docs/` не документируют локальную разработку (хотя она работает). Не описывай локальную разработку как неподдерживаемую.
- **Не выдумывай `npm test` / `npm run lint`** — ни тесты, ни линтер не настроены.

## Архитектурные ограничения

- **Используй `claim*` функции для смены статусов**, а не `updateApplication`/`saveApplication`. Если `claim*` вернул `null` — действие уже обработано, просто выйди.
- **Исключение:** `/выдатьчсп` (`chspReason.ts`) использует `upsertBlacklistedApplication` — это форс-апсерт. Не «фикси» его на `claim*`.
- **ЧСЗ/ЧСА** хранятся в таблице `special_blacklists`, а не в `applications`. Используй `upsertSpecialBlacklist`/`removeSpecialBlacklist`.
- **Discord модалки: максимум 5 полей.** `verifyQuestions` уже на лимите.
- **UI меняй только в `ui.ts`**, не инлайн в хендлерах.
- **Перед изменением логики верификации/апелляций** — прочитай `docs/verification-and-appeals.md`.

## Конфигурация

- **Конфиг-файлов на диске нет** — подключение к БД через `DB_*` env, всё остальное в MySQL.
- **`ALLOWED_GUILD_IDS`** в `index.ts` — хардкод-вайтлист серверов; бот покидает остальные.
- **`OWNER_IDS`** в `permissions.ts` — хардкод, не в БД.
- **Per-guild настройки** — таблица `guild_settings` (ключ `(guildId, key)`). После правки — `docker compose restart`.

## Базы данных и ORM

- Проект использует **и** сырой `mysql2` (для DDL/миграций в `initStorage`), **и** `drizzle-orm` (для DML-запросов в `storage.ts`).
- Схемы Drizzle — в `schema.ts`. При добавлении таблицы: (1) схема в `schema.ts`, (2) `CREATE TABLE IF NOT EXISTS` в `initStorage()`, (3) `addColumnIfMissing`/`addIndexIfMissing` для миграций.

## Команды и пермишены

- Три уровня: **owner** ⊇ **ststaff** ⊇ **staff**. Право Discord «Администратор» само по себе ничего не даёт.
- `/выдатьчсз`, `/снятьчсз`, `/выдатьчса`, `/снятьчса` — фабрика `buildSpecialBlacklistCommand` в `specialBlacklistHelper.ts`. Новый ЧС-тип = однострочный файл команды + расширение `getRoleAndName`.
- Все шесть ЧС-команд (ЧСП/ЧСЗ/ЧСА add/remove) требуют `ststaff` и проверяют `canManageByHierarchy`.
- **ЧСП глобальный** (через `sync.ts`), **ЧСЗ/ЧСА локальные** (per-guild).

## Защита от обхода

- `chsaProtection.ts` автоматически восстанавливает роли ЧС, если их сняли вручную в Discord. Не отключай.
- `voiceKick.ts` кикает из войса при получении роли ЧСП. Работает и при заходе в войс с ролью, и при получении роли в войсе.

## Деплой

- Пересборка после кода: `docker compose up -d --build`
- Рестарт после env/конфига в БД: `docker compose restart`
- Регистрация slash-команд автоматическая при старте.
