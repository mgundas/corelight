export function ControlsGuide() {
  return (
    <details className="controls-guide">
      <summary>Field guide <span>Controls & first steps</span></summary>
      <p>Stay near your habitat while you gather resin. Print tethers in your backpack, then extend an oxygen line before heading underground.</p>
      <dl>
        <div><dt><kbd>WASD</kbd> <kbd>Shift</kbd> <kbd>Space</kbd></dt><dd>Move, sprint, jump</dd></div>
        <div><dt><kbd>RMB</kbd> <kbd>Wheel</kbd></dt><dd>Hold to look, scroll to zoom</dd></div>
        <div><dt><kbd>Q</kbd> <kbd>LMB</kbd></dt><dd>Equip terrain tool, use brush</dd></div>
        <div><dt><kbd>X</kbd> <kbd>F</kbd> <kbd>Ctrl + wheel</kbd></dt><dd>Dig / add, hold to flatten, brush size</dd></div>
        <div><dt><kbd>LMB</kbd> <kbd>E</kbd></dt><dd>Tool stowed: grab / release, interact / pick up</dd></div>
        <div><dt><kbd>Tab</kbd> <kbd>1–8</kbd></dt><dd>Backpack printer, select a slot</dd></div>
        <div><dt><kbd>T</kbd> <kbd>L</kbd> <kbd>C</kbd></dt><dd>Place tether, headlamp, cable tool</dd></div>
        <div><dt><kbd>E</kbd> hold</dt><dd>Pack an empty machine</dd></div>
      </dl>
      <p>Drag backpack items to reorder, feed a station, or drop into the world. Press Esc to pause; if the pointer is locked, release it with Esc first.</p>
      <div className="guide-debug">Survey tools: F1 stats · F3 free fly · F4 wireframe · B chunk bounds</div>
    </details>
  );
}
