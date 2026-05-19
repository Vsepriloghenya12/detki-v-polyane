import { spawn } from 'node:child_process'

const run = command => {
  const child = spawn(command, { stdio: 'inherit', shell: true })
  child.on('exit', code => {
    if (code) process.exit(code)
  })
  return child
}

const server = run('node server/index.js')
const vite = run('vite --host 0.0.0.0')

const stop = () => {
  server.kill()
  vite.kill()
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
