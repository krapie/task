<!-- mycelium:begin:projects/task -->
<!-- Managed by Mycelium. Do not edit directly. -->

# projects/task — Project Knowledge

## Task App — Settled Patterns & Watch-Outs

### UI Layout Conventions
- **3-column layouts** are the established pattern for multi-level hierarchies (e.g., Year | Half | General goals). Prefer this over toggles for side-by-side comparison.
- **Full-width buttons below panels** are used for add/create actions in task lists (e.g., daily/bonus task add button).
- **Tab sorting**: Year tabs sort ascending with the '+' button positioned on the right.
- **Goal rollup**: When displaying hierarchical goals (annual ↔ half-year ↔ general), merge H1/H2 items into the annual period as read-only rollup rows.

### Mobile Quirks — iOS Safari Auto-Zoom
iOS Safari auto-zooms input fields with font-size < 16px. Apply this override in mobile media queries:
```css
.add-task-input, .task-edit-input {
  font-size: 16px !important; /* prevent iOS Safari auto-zoom */
}
```
Use this same CSS specificity pattern for any form inputs that need the fix.

### Deployment & ArgoCD Monitoring
- **ArgoCD polling is slow** (3-minute cycle). For urgent syncs, manually trigger a hard refresh via annotation instead of waiting:
  ```
  argocd.argoproj.io/refresh=hard
  ```
- **Post-deployment verification checklist**: (1) Confirm ArgoCD sync status shows deployed image tag, (2) Verify `/api/health` returns `{"ok":true}`, (3) Check logs for errors after rollout completes.
- Health checks must pass before considering deployment complete.
<!-- mycelium:end:projects/task -->
