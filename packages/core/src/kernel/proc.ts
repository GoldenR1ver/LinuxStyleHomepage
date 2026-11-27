import type { User } from './types'

/**
 * `/proc`: the third kind of path.
 *
 * `image` is bytes compiled into the build, `local` is bytes this browser wrote,
 * and `/proc` is bytes that do not exist until someone reads them. A synthetic
 * filesystem answers two questions — which names are in a directory, and what a
 * file says — and the VFS plugs it in beside the other two layers. Nothing is
 * stored, nothing is persisted, and a write is refused, exactly as on Linux.
 */

export interface MountRow {
  device: string
  dir: string
  type: string
  options: string
}

export interface ProcSource {
  hostname: string
  release: string
  machine: string
  /** Milliseconds since the page loaded. */
  boot: number
  procs: () => { pid: number; user: string; cwd: string; win: string; active: boolean }[]
  mounts: () => MountRow[]
}

export interface Synthetic {
  /** The directory this filesystem owns, such as `/proc`. */
  readonly root: string
  /** Names in a synthetic directory, or null when the path is not one. */
  list(path: string, user: User): string[] | null
  /** Content of a synthetic file, or null when the path is not one. */
  file(path: string, user: User): string | null
}

const ROOT = ['cpuinfo', 'meminfo', 'mounts', 'self', 'uptime', 'version']

export class ProcFS implements Synthetic {
  readonly root = '/proc'

  constructor(private readonly source: ProcSource) {}

  list(path: string, user: User): string[] | null {
    if (path === '/proc') return [...ROOT]
    if (path === '/proc/self' || path === `/proc/${user.uid}`) return ['status']
    return null
  }

  file(path: string, user: User): string | null {
    const at = this.source
    switch (path) {
      case '/proc/cpuinfo':
        return cpuinfo(at.machine)
      case '/proc/meminfo':
        return meminfo()
      case '/proc/mounts':
        return `${at.mounts()
          .map((row) => `${row.device} ${row.dir} ${row.type} ${row.options} 0 0`)
          .join('\n')}\n`
      case '/proc/uptime':
        return `${uptimeSeconds(at.boot)} ${idleSeconds(at.boot)}\n`
      case '/proc/version':
        return `Linux version ${at.release} (home@localhost) #1 SMP Home\n`
      case '/proc/self/status':
      case `/proc/${user.uid}/status`:
        return status(user, at)
      default:
        return null
    }
  }
}

function uptimeSeconds(boot: number): string {
  return (Math.max(0, Date.now() - boot) / 1000).toFixed(2)
}

/** This machine never idles, so the idle figure tracks the uptime figure. */
function idleSeconds(boot: number): string {
  return uptimeSeconds(boot)
}

function status(user: User, source: ProcSource): string {
  const rows = [
    `Name:\t${user.name}`,
    'State:\tR (running)',
    'Tgid:\t1',
    'Pid:\t1',
    `PPid:\t0`,
    `Uid:\t${user.uid}\t${user.uid}\t${user.uid}\t${user.uid}`,
    `Gid:\t${user.gid}\t${user.gid}\t${user.gid}\t${user.gid}`,
    `Groups:\t${user.groups.join(' ')}`,
    `Threads:\t1`,
    `VmRSS:\t${Math.round(procsBytes(source) / 1024)}\tkB`,
    `hostname\t${source.hostname}`,
    '',
  ]
  return rows.join('\n')
}

function procsBytes(source: ProcSource): number {
  return Math.max(1, source.procs().length) * 4096
}

function cpuinfo(machine: string): string {
  return [
    'processor\t: 0',
    'vendor_id\t: HomeLinux',
    'cpu family\t: 6',
    'model name\t: Home Linux Virtual CPU',
    'cpu MHz\t\t: 1000.000',
    'cache size\t: 4096 KB',
    `arch\t\t: ${machine}`,
    'flags\t\t: dac_override dac_read_search fowner fsetid chown setuid setgid',
    '',
    'processor\t: 1',
    'vendor_id\t: HomeLinux',
    'cpu family\t: 6',
    'model name\t: Home Linux Virtual CPU',
    'cpu MHz\t\t: 1000.000',
    'cache size\t: 4096 KB',
    `arch\t\t: ${machine}`,
    'flags\t\t: dac_override dac_read_search fowner fsetid chown setuid setgid',
    '',
  ].join('\n')
}

/** Honest numbers for a machine whose memory is the page. */
function meminfo(): string {
  // `performance.memory` is a Chrome extension, not a standard; read it through
  // a narrow cast so a browser without it still works.
  const heap = (() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
    return memory?.usedJSHeapSize ?? 0
  })()
  const used = Math.round(heap / 1024)
  const total = 1048576
  return [
    `MemTotal:\t ${total} kB`,
    `MemFree:\t ${Math.max(0, total - used)} kB`,
    `MemAvailable:\t ${Math.max(0, total - used)} kB`,
    `Buffers:\t 0 kB`,
    `Cached:\t\t 0 kB`,
    `SwapTotal:\t 0 kB`,
    `SwapFree:\t 0 kB`,
    '',
  ].join('\n')
}
