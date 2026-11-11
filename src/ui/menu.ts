// Main + pause menus (M06). Pure DOM: no World access, no gameplay
// mutation — every button calls back into main.ts, which owns the session.

export interface MainMenuOptions {
  hasSave: boolean;
  error?: string | null;
  onContinue(): void;
  onNewGame(): void;
}

export interface PauseMenuOptions {
  onResume(): void;
  onSaveNow(): void;
  onQuitToMenu(): void;
}

function makeOverlay(id: string, title: string, subtitle: string): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.id = id;
  const heading = document.createElement('h1');
  heading.textContent = title;
  const sub = document.createElement('div');
  sub.className = 'menu-sub';
  sub.textContent = subtitle;
  const body = document.createElement('div');
  body.className = 'menu-buttons';
  root.append(heading, sub, body);
  document.body.appendChild(root);
  return { root, body };
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/** Full-screen title menu. Returns a dispose function. */
export function showMainMenu(opts: MainMenuOptions): () => void {
  const { root, body } = makeOverlay('menu', 'Corelight', 'A small game about digging holes on small planets');
  if (opts.error) {
    const err = document.createElement('div');
    err.className = 'menu-error';
    err.textContent = opts.error;
    body.appendChild(err);
  }
  if (opts.hasSave) {
    body.appendChild(makeButton('Continue', opts.onContinue));
  }
  body.appendChild(makeButton(opts.hasSave ? 'New game (overwrites save)' : 'New game', opts.onNewGame));
  const settingsNote = document.createElement('div');
  settingsNote.className = 'menu-note';
  settingsNote.textContent = 'Settings: coming in a later milestone (M16 polish).';
  settingsNote.hidden = true;
  body.appendChild(makeButton('Settings', () => {
    settingsNote.hidden = !settingsNote.hidden;
  }));
  body.appendChild(settingsNote);
  return () => {
    root.remove();
  };
}

/** Pause menu over a frozen session. Returns a dispose function. */
export function showPauseMenu(opts: PauseMenuOptions): () => void {
  const { root, body } = makeOverlay('pause-menu', 'Paused', 'The world is holding its breath');
  body.appendChild(makeButton('Resume', opts.onResume));
  const saveButton = makeButton('Save now', () => {
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    opts.onSaveNow();
    // storeSave is async in the session; show confirmation briefly.
    window.setTimeout(() => {
      saveButton.textContent = 'Saved!';
      window.setTimeout(() => {
        saveButton.disabled = false;
        saveButton.textContent = 'Save now';
      }, 1200);
    }, 150);
  });
  body.appendChild(saveButton);
  body.appendChild(makeButton('Quit to menu', opts.onQuitToMenu));
  return () => {
    root.remove();
  };
}
