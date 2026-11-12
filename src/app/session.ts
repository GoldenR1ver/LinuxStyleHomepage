import { homeDir } from '../kernel/auth'
import type { User } from '../kernel/types'
import type { Runtime } from './runtime'
import type { ShellCtx } from '../shell/context'

export function createShell(rt: Runtime, user: User, cwd: string): ShellCtx {
  const home = homeDir(user)
  return {
    user,
    cwd,
    env: {
      USER: user.name,
      LOGNAME: user.name,
      HOME: home,
      HOSTNAME: rt.site.hostname,
      PWD: cwd,
      OLDPWD: cwd,
      SHELL: '/bin/sh',
      TERM: 'xterm-256color',
      PATH: '/bin',
    },
    aliases: {
      ll: 'ls -l',
      la: 'ls -la',
      reset: 'clear',
    },
    history: [],
    rt,
    host: {
      async readStdin() {
        return ''
      },
      async askSecret() {
        return null
      },
      async pickFiles() {
        return null
      },
    },
    columns: 80,
    closing: false,
    line: '',
  }
}
