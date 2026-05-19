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

## Railway

1. Залить проект в GitHub.
2. Создать сервис в Railway из GitHub-репозитория.
3. Добавить PostgreSQL в проект Railway.
4. В переменных сервиса приложения должен быть `DATABASE_URL` от PostgreSQL.
5. Build command: `npm run build`.
6. Start command: `npm run start`.

На Railway данные сохраняются в PostgreSQL.
