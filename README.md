# Детки в поляне

React/Vite PWA-приложение с серверным сохранением данных.

## Локальный запуск

```bash
npm install
npm run dev
```

Единый вход для родителей и воспитателя: http://localhost:5173/

Без `DATABASE_URL` данные сохраняются локально в `server/data/state.json`.

Локальный логин воспитателя: `admin`.

Локальный пароль воспитателя: `detki-owner-dev`.

## Railway

1. Залить проект в GitHub.
2. Создать сервис в Railway из GitHub-репозитория.
3. Добавить PostgreSQL в проект Railway.
4. В переменных сервиса приложения должен быть `DATABASE_URL` от PostgreSQL.
5. Добавить переменную `OWNER_LOGIN` с логином воспитателя.
6. Добавить обязательную переменную `OWNER_PASSWORD` с надежным паролем воспитателя.
7. Build command: `npm run build`.
8. Start command: `npm run start`.

На Railway данные сохраняются в PostgreSQL.
