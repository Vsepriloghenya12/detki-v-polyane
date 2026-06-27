# Детки в поляне

React/Vite PWA-приложение с серверным сохранением данных.

## Локальный запуск

```bash
npm install
npm run dev
```

Родители: http://localhost:5173/

Владелец: http://localhost:5173/owner

Без `DATABASE_URL` данные сохраняются локально в `server/data/state.json`.

Локальный пароль владельца: `detki-owner-dev`.

## Railway

1. Залить проект в GitHub.
2. Создать сервис в Railway из GitHub-репозитория.
3. Добавить PostgreSQL в проект Railway.
4. В переменных сервиса приложения должен быть `DATABASE_URL` от PostgreSQL.
5. Добавить обязательную переменную `OWNER_PASSWORD` с надежным паролем владельца.
6. Build command: `npm run build`.
7. Start command: `npm run start`.

На Railway данные сохраняются в PostgreSQL.
