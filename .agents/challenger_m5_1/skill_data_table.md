# Copy of data-table-and-large-list.md
See H:/erppreflight/.agents/skills/data-table-and-large-list.md for authoritative source.
Core methodology:
- TanStack Table v8 + TanStack Virtual v3
- Backend pagination, multi-column sorting, and facet filtering bound to URL query parameters via TanStack Query.
- Virtualization via @tanstack/react-virtual limits active DOM footprint to ~30 rows regardless of dataset scale.
- Export actions (CSV, JSON, XLSX) must stream complete dataset, neutralize formula injections (CWE-1236).
