# UML, INT-HOME round 5

Three diagrams, each read off `intent/prototype.md`. These describe the
architecture, not a screen: since round 3 nothing in `intent/`, `spec/`,
`tests/`, `uml/` or `tools/` is published, so there is no UI to draw.

| Diagram | Answers | Source in the spec |
| --- | --- | --- |
| [uml/state.md](state.md) | how one round moves from step 1 to step 9, and where it rolls back | `REQ-SG-04`, `REQ-SG-08` |
| [uml/sequence.md](sequence.md) | the order of one round, and where each gate fires | `REQ-SG-01`, `REQ-SG-16`, `POST-01` |
| [uml/dependency.md](dependency.md) | which zone may read which, and what may never be published | `REQ-SG-01`, `REQ-SG-02`, `DEP-01` |

Reading rules

- A diagram that disagrees with the prototype is fixed by changing the prototype
  first, then the picture.
- These three files enter review, not the build. `G-REF-01` checks that the links
  above resolve; no test reads the diagrams for content.
