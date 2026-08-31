# Triage labels

| Canonical role    | Local status      | Meaning                                   |
| ----------------- | ----------------- | ----------------------------------------- |
| `needs-triage`    | `needs-triage`    | A maintainer must evaluate the work       |
| `needs-info`      | `needs-info`      | Work is waiting for reporter information  |
| `ready-for-agent` | `ready-for-agent` | Fully specified and safe for an AFK agent |
| `in-progress`     | `in-progress`     | Atomically claimed by an active worker    |
| `ready-for-human` | `ready-for-human` | Requires human judgment or implementation |
| `wontfix`         | `wontfix`         | The work will not be actioned             |

Use the status string exactly in local packets and, when labels are available, on their GitHub projections. The local packet remains authoritative.
