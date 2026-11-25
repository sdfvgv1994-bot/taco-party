/**
 * Frontend Block Registry (前端積木架構核心).
 * Each feature block registers metadata, slot mount/unmount hooks, and optional dependencies.
 */
export class BlockRegistry {
  constructor(context) {
    this.context = context;
    /** @type {Map<string, { def: object, mounted: boolean, cleanup: Function|null }>} */
    this.blocks = new Map();
    this.listeners = new Set();
  }

  register(blockDef) {
    if (!blockDef?.id) {
      throw new Error('Block definition must include an id');
    }
    this.blocks.set(blockDef.id, {
      def: blockDef,
      mounted: false,
      cleanup: null
    });
    return this;
  }

  bootEnabledBlocks() {
    const { enabledBlocks } = this.context.store.getState();
    for (const [id, entry] of this.blocks.entries()) {
      const shouldEnable = entry.def.required || enabledBlocks[id] !== false;
      if (shouldEnable) {
        this.enable(id, { persist: false });
      }
    }
    this._notify();
  }

  enable(id, { persist = true } = {}) {
    const entry = this.blocks.get(id);
    if (!entry || entry.mounted) return;

    const cleanup = entry.def.mount(this.context) || null;
    entry.mounted = true;
    entry.cleanup = typeof cleanup === 'function' ? cleanup : null;

    if (persist) {
      const prev = this.context.store.getState().enabledBlocks;
      this.context.store.setState({
        enabledBlocks: { ...prev, [id]: true }
      });
    }
    this._notify();
  }

  disable(id) {
    const entry = this.blocks.get(id);
    if (!entry || !entry.mounted || entry.def.required) return;

    try {
      if (entry.cleanup) entry.cleanup();
      if (typeof entry.def.unmount === 'function') entry.def.unmount(this.context);
    } finally {
      entry.mounted = false;
      entry.cleanup = null;
      if (entry.def.slotId) {
        const slot = document.getElementById(entry.def.slotId);
        if (slot) slot.innerHTML = '';
      }
    }

    const prev = this.context.store.getState().enabledBlocks;
    this.context.store.setState({
      enabledBlocks: { ...prev, [id]: false }
    });
    this._notify();
  }

  getList() {
    return Array.from(this.blocks.values()).map(({ def, mounted }) => ({
      id: def.id,
      name: def.name,
      icon: def.icon || '🧱',
      version: def.version || '1.0.0',
      description: def.description || '',
      required: Boolean(def.required),
      mounted
    }));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify() {
    for (const fn of this.listeners) fn(this.getList());
  }
}
