import { ProcFS, type MountRow } from '../kernel/proc'
import type { Runtime } from './runtime'

/**
 * Attach the synthetic filesystem and declare the mount table.
 *
 * The three kinds of path are three mounts, and saying so out loud is what makes
 * `mount`, `df` and `/proc/mounts` agree with the implementation:
 *
 *   /      overlay  lowerdir = the build image, upperdir = this browser
 *   /proc  proc     generated on read, no bytes anywhere
 *   /tmp   tmpfs    session only, which is exactly what an ephemeral path is
 */
export function installProc(rt: Runtime) {
  rt.fs.setSynthetic(
    new ProcFS({
      hostname: rt.site.hostname,
      release: '6.1-home',
      machine: 'x86_64',
      boot: Date.now(),
      procs: () => rt.procs(),
      mounts: () => mountTable(),
    }),
  )
  // A tmpfs holds nothing across a reboot, and neither does this.
  rt.fs.markEphemeral('/tmp')
}

export function mountTable(): MountRow[] {
  return [
    { device: 'content', dir: '/', type: 'overlay', options: 'rw,lowerdir=/image,upperdir=local' },
    { device: 'proc', dir: '/proc', type: 'proc', options: 'ro,nosuid,nodev,noexec' },
    { device: 'tmpfs', dir: '/tmp', type: 'tmpfs', options: 'rw,nosuid,nodev,size=64m' },
  ]
}
