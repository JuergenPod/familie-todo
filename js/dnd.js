// Drag-and-drop using SortableJS (loaded via CDN <script>).
// Falls back silently if Sortable is not available.

let wired = new WeakSet();

export function initDnd({ onReorder, onStatusChange } = {}) {
  const Sortable = window.Sortable;
  if (!Sortable) return;

  const containers = [
    document.getElementById('task-list-open'),
    document.getElementById('task-list-done'),
  ].filter(Boolean);

  for (const el of containers) {
    // Destroy previous instance if exists to avoid duplicates on re-render.
    if (el._sortable) {
      try { el._sortable.destroy(); } catch { /* ignore */ }
      el._sortable = null;
    }
    const instance = Sortable.create(el, {
      group: 'tasks',
      animation: 140,
      ghostClass: 'dragging',
      forceFallback: true,
      fallbackTolerance: 5,
      draggable: '.task',
      onEnd: (evt) => {
        const id = evt.item?.dataset?.taskId;
        if (!id) return;
        const targetStatus = evt.to?.dataset?.status;
        const prevStatus = evt.from?.dataset?.status;
        const statusChanged = targetStatus && prevStatus && targetStatus !== prevStatus;

        // Compute sort orders based on new positions in target list.
        const orderMap = {};
        const step = 10;
        evt.to.querySelectorAll('.task').forEach((node, idx) => {
          const tid = node.dataset.taskId;
          if (tid) orderMap[tid] = idx * step;
        });
        if (statusChanged && onStatusChange) onStatusChange(id, targetStatus);
        if (onReorder) onReorder(id, orderMap, statusChanged ? targetStatus : null);
      },
    });
    el._sortable = instance;
  }
}
