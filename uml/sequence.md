# Sequence diagram

One round, and where each gate fires. Checked against `REQ-SG-01`, `REQ-SG-16`
and `POST-01`.

```mermaid
sequenceDiagram
    actor H as 人
    participant A as AI
    participant I as intent/
    participant S as spec/
    participant T as tests/
    participant G as tools/gates
    participant V as vite build
    participant C as content/

    H->>I: write intent/intent.yaml, rules, judge, questions
    Note over I: five blocks present, every question has an owner
    I->>S: spec reads only intent
    S->>S: one shall per rule, no vague word
    G-->>S: G-WORD-01 at pre-commit
    G-->>S: G-REF-01 at pre-commit
    S->>S: decision table, const
    G-->>S: G-INV-01 at pr
    G-->>S: G-DT-01 at merge
    A->>T: one test file per source id
    T->>T: tests/MANIFEST.yaml registers every file
    G-->>T: G-REF-01 covers the manifest too
    G-->>T: G-TEST-01 at merge
    G-->>S: G-DEP-01 at pr, on src/kernel
    H->>V: npm run build
    V->>G: draftCheck.check(repo)
    alt content/ carries a draft trace
        G-->>V: one message per file
        V-->>H: stop, G-DRAFT-01, no asset emitted
    else content/ is clean
        V->>C: walk content/ only
        C-->>V: files
        V-->>H: fs assets plus an index, no architecture path
    end
```

Two branches that are deliberately absent

- No branch hands a draft to the site. `vite/content.ts` refuses to start emitting
  when `draftCheck` reports a trace, so the leak never becomes a URL.
- No branch writes during a check. Every gate reads files and returns an exit
  code; `npm test` renders the verdict, not the gate.
