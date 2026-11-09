import type { MutationStep } from './types'

export interface Mutation {
  id: string
  ts: number
  user: string
  command: string
  reverted: boolean
  steps: MutationStep[]
}

export interface EventLog {
  id: string
  ts: number
  user: string
  role: 'root' | 'guest'
  action: 'login' | 'logout' | 'exec' | 'auth-fail'
  detail: string
  code?: number
}

export interface JournalState {
  events: EventLog[]
  mutations: Mutation[]
}

const DAY = 24 * 60 * 60 * 1000
const MAX_EVENTS = 2000
const MAX_MUTATIONS = 500

/**
 * Local log. Root writes store an inverse patch so they can be rolled back for a week.
 * Guest activity records commands, not keystrokes.
 */
export class Journal {
  constructor(
    private state: JournalState,
    private days: number,
    private now: () => number = Date.now,
    private nextId: () => string = defaultId,
  ) {
    if (!this.state.events) this.state.events = []
    if (!this.state.mutations) this.state.mutations = []
    this.prune()
  }

  recordEvent(input: Omit<EventLog, 'id' | 'ts'> & { ts?: number }): EventLog {
    const event: EventLog = {
      id: this.nextId(),
      ts: input.ts ?? this.now(),
      user: input.user,
      role: input.role,
      action: input.action,
      detail: input.detail,
      code: input.code,
    }
    this.state.events.push(event)
    this.prune()
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENTS)
    }
    return event
  }

  recordMutation(input: Omit<Mutation, 'id' | 'ts' | 'reverted'> & { ts?: number }): Mutation {
    const mutation: Mutation = {
      id: this.nextId(),
      ts: input.ts ?? this.now(),
      user: input.user,
      command: input.command,
      reverted: false,
      steps: input.steps,
    }
    this.state.mutations.push(mutation)
    this.prune()
    if (this.state.mutations.length > MAX_MUTATIONS) {
      this.state.mutations.splice(0, this.state.mutations.length - MAX_MUTATIONS)
    }
    return mutation
  }

  events(): EventLog[] {
    return [...this.state.events].reverse()
  }

  mutations(includeReverted = false): Mutation[] {
    return this.state.mutations.filter((item) => includeReverted || !item.reverted).reverse()
  }

  getMutation(id: string): Mutation | undefined {
    return this.state.mutations.find((item) => item.id === id)
  }

  /** This record and every later edit that has not been reverted. */
  rollbackSet(id: string): Mutation[] {
    const index = this.state.mutations.findIndex((item) => item.id === id)
    if (index < 0 || this.state.mutations[index]?.reverted) return []
    return this.state.mutations
      .slice(index)
      .filter((item) => !item.reverted)
      .reverse()
  }

  markReverted(id: string) {
    const item = this.getMutation(id)
    if (item) item.reverted = true
  }

  export(): JournalState {
    return structuredClone(this.state)
  }

  prune() {
    const cut = this.now() - this.days * DAY
    this.state.events = this.state.events.filter((item) => item.ts >= cut)
    this.state.mutations = this.state.mutations.filter((item) => item.ts >= cut)
  }
}

function defaultId(): string {
  return Math.random().toString(36).slice(2, 8)
}
