import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('packaged client registers keyed main + list entry and releases owned resources', async () => {
  let descriptor;
  const styles = new Set();
  const unloadListeners = new Set();
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { descriptor = value; } },
      addEventListener(type, listener) { assert.equal(type, 'beforeunload'); unloadListeners.add(listener); },
      removeEventListener(type, listener) { assert.equal(type, 'beforeunload'); assert.equal(unloadListeners.delete(listener), true); }
    },
    document: { createElement() { return { dataset: {}, remove() { styles.delete(this); } }; }, head: { append(style) { styles.add(style); } } }
  };
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(descriptor.id, 'dsh-task-shelf');
  assert.equal(styles.size, 0, 'loading the bundle must not inject styles before apply');
  const client = descriptor.factory(name => { assert.equal(name, 'react'); return { createElement() {} }; });
  const registrations = new Map();
  for (let cycle = 0; cycle < 20; cycle++) {
    const disposers = [];
    const ctx = {
      effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose; },
      uiWorkspace: {},
      slots: {
        inject(name, fn) { const dispose = fn(); disposers.push(dispose); return dispose; },
        register(options, component) {
          assert.equal(typeof component, 'function');
          // DSH 0.2.1-rc.3: main is a keyed slot; panellist is a list slot.
          const identity = options.name === 'main' ? options.key : options.id;
          assert.equal(identity, 'dsh-task-shelf');
          assert.ok(!registrations.has(options.name), 'duplicate registration');
          registrations.set(options.name, options);
          return () => registrations.delete(options.name);
        }
      }
    };
    client.apply(ctx);
    assert.equal(styles.size, 1); assert.equal(registrations.size, 2);
    assert.equal(unloadListeners.size, 1, 'plugin-wide draft guard must not accumulate across reloads');
    const event = new Event('beforeunload', { cancelable: true });
    for (const listener of unloadListeners) listener(event);
    assert.equal(event.defaultPrevented, false, 'empty plugin must not prevent closing');
    disposers.reverse().forEach(dispose => dispose());
    assert.equal(styles.size, 0); assert.equal(registrations.size, 0);
    assert.equal(unloadListeners.size, 0, 'unloading the plugin must remove its draft guard');
  }
});
