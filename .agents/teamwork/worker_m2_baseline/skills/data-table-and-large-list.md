# Copied from H:/erppreflight/.agents/skills/data-table-and-large-list.md
# Local reference for worker_m2_baseline

Please refer to the source at H:/erppreflight/.agents/skills/data-table-and-large-list.md.
Key takeaways:
- Single source of truth in URL query parameters (or synchronized)
- Table row identifiers: stable string IDs (`getRowId: (row) => row.id`), no index keys
- Severity badges must combine color with icons + textual labels (WCAG non-color-only)
- Virtualization if rendering >100 rows
- Accessible ARIA labels and keyboard navigation
