# Playbook: Accessibility & Inclusive Design (WCAG 2.2 AA)

> **Binding Authority**: Part 14.24, Part 22.16 & AGENTS.md (Cardinal Axiom 1)  
> **Scope**: All frontend pages, components, dialogs, charts, tables, and canvas graphs.

---

## 1. Cardinal Invariants
1. **Never Color Alone**: Severity levels (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`) must pair color with textual labels, distinctive icons, or ARIA attributes.
2. **Keyboard Traversal**: Every interactive element (buttons, links, dialog triggers, tabs, table rows) must be fully navigable via `Tab`, `Arrow`, `Enter`, `Space`, and dismissible via `Escape`.
3. **Motion Restraint**: Respect `prefers-reduced-motion: reduce`. Disable automatic transitions and spinning animations when requested by user OS settings.
4. **Accessible Equivalents**: Visual canvases (@xyflow/react) and analytics charts (Apache ECharts) must provide accessible data table alternatives with screen-reader friendly DOM structure.

---

## 2. Implementation Checklist
- [ ] Contrast ratio >= 4.5:1 for normal text, 3:1 for large text and UI components.
- [ ] Dialogs trap focus properly and restore focus to trigger button upon close.
- [ ] Tables use semantic `<caption>`, `<thead>`, `<th>`, and `<tbody>` elements.
- [ ] Form inputs possess explicit `<label>` tags with matching `htmlFor` identifiers.
- [ ] Automated accessibility audits pass with 0 axe-core / Playwright violations.
