import { useEffect, useRef, useState } from 'react';
import { DEV_ITEM_MAX_COUNT } from '../../core/constants.js';
import { getUrlParams } from '../../core/urlParams.js';
import { ITEMS } from '../../data/loadData.js';
import { useCommandsStore } from '../stores/commandsStore.js';
import { useDevItemsStore } from '../stores/devItemsStore.js';
import { useMenuStore } from '../stores/menuStore.js';

function ItemWindow() {
  const dialog = useRef<HTMLDialogElement>(null);
  const commands = useCommandsStore((s) => s.commands);
  const [search, setSearch] = useState('');
  const [count, setCount] = useState(1);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  const query = search.trim().toLowerCase();
  const items = ITEMS.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(query));
  return (
    <dialog ref={dialog} id="dev-items" aria-labelledby="dev-items-title"
      onCancel={(e) => { e.preventDefault(); commands?.setDevItemsOpen(false); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); commands?.setDevItemsOpen(false); }
      }}>
      <div className="dev-items-header">
        <h2 id="dev-items-title">Dev items</h2>
        <button type="button" aria-label="Close dev items" onClick={() => commands?.setDevItemsOpen(false)}>×</button>
      </div>
      <p>Free resources, equipment and packaged buildings. Extras drop at your feet when your backpack or hands are full.</p>
      <div className="dev-items-filters">
        <label>Search items<input autoFocus type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Copper, shuttle, drill…" /></label>
        <label>Quantity<select value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {[1, 4, DEV_ITEM_MAX_COUNT].map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
      </div>
      <div className="dev-items-list">
        {items.map((item) => (
          <div className="dev-item-row" key={item.id}>
            <span className="dev-item-swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />
            <span>{item.name}</span>
            <button type="button" aria-label={`Give ${item.name}`} onClick={() => {
              commands?.devGiveItem(item.id, count);
              setMessage(`Requested ${count} × ${item.name}.`);
            }}>Give ×{count}</button>
          </div>
        ))}
        {items.length === 0 ? <p>No matching items.</p> : null}
      </div>
      <div className="dev-items-status" role="status">{message || 'Choose an item to add it. Escape closes.'}</div>
    </dialog>
  );
}

export function DevItemsPanel() {
  const commands = useCommandsStore((s) => s.commands);
  const open = useDevItemsStore((s) => s.open);
  const menu = useMenuStore((s) => s.view.kind);
  if (!getUrlParams().dev || !commands || menu !== 'none') return null;
  return <>
    <button type="button" id="dev-items-toggle" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => commands.setDevItemsOpen(true)}>Dev items</button>
    {open ? <ItemWindow /> : null}
  </>;
}
