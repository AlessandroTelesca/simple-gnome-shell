import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isActorValid} from './frames.js';
import {EdgeTab} from './tab.js';

// The clock Hide Top Bar: Multi Monitors (hidetopbar-multimonitor@alessandrot) shows on a monitor while that monitor's
// panel is hidden: the uiGroup child of CLOCK_NAME, holding the tab the clock sits on, and inside the tab the actor of
// BODY_NAME, the tab without its flares into the screen edge. BACKED_CLASS on the tab tells it to leave the tab
// unpainted, which is that extension's published way of having another extension draw it. Without this the tab keeps
// its own fixed dark color.
const CLOCK_NAME = 'hidetopbar-mm-clock';
const BODY_NAME = 'hidetopbar-mm-clock-body';
const BACKED_CLASS = 'liquid-glass-backed';

function findByName(root, name) {
    if (root.get_name() === name)
        return root;
    for (const child of root.get_children()) {
        const found = findByName(child, name);
        if (found)
            return found;
    }
    return null;
}

class ClockTab {
    constructor(settings, frames, clock, body) {
        this._clock = clock;
        this._body = body;
        this._holder = body.get_parent();
        this._holder.add_style_class_name(BACKED_CLASS);
        this._tab = new EdgeTab(settings);
        this._removeFrames = frames.add(() => this._sync());
    }

    _sync() {
        const clock = this._clock, body = this._body;
        if (!isActorValid(clock) || !isActorValid(body))
            return;
        const [x, y] = body.get_transformed_position();
        const [w, h] = body.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(clock);
        if (!clock.visible || !clock.mapped || clock.opacity === 0 || !body.mapped || !monitor ||
            ![x, y].every(Number.isFinite) || !(w > 1) || !(h > 1)) {
            this._tab.hide();
            return;
        }
        // A panel at the bottom of its monitor hides behind the bottom edge, and its clock grows out of that.
        const side = y + h / 2 > monitor.y + monitor.height / 2 ? 'bottom' : 'top';
        this._tab.place([x, y, w, h], side, monitor, clock, h / 2, clock.get_paint_opacity());
    }

    destroy() {
        this._removeFrames();
        if (isActorValid(this._holder))
            this._holder.remove_style_class_name(BACKED_CLASS);
        this._tab.destroy();
    }
}

/** The tab behind every hidden clock. */
export class HiddenClocks {
    constructor(settings, frames) {
        this._settings = settings;
        this._frames = frames;
        this._clocks = new Map();
        const uiGroup = Main.layoutManager.uiGroup;
        this._ids = [
            uiGroup.connect('child-added', (_group, child) => this._add(child)),
            uiGroup.connect('child-removed', (_group, child) => this._remove(child)),
        ];
        this._settingsId = settings.connect('changed::hidden-clock', () => this._apply());
        this._apply();
    }

    _apply() {
        for (const child of [...this._clocks.keys()])
            this._remove(child);
        for (const child of Main.layoutManager.uiGroup.get_children())
            this._add(child);
    }

    _add(child) {
        if (child.get_name() !== CLOCK_NAME || this._clocks.has(child) || !this._settings.get_boolean('hidden-clock'))
            return;
        const body = findByName(child, BODY_NAME);
        if (body?.get_parent())
            this._clocks.set(child, new ClockTab(this._settings, this._frames, child, body));
    }

    _remove(child) {
        this._clocks.get(child)?.destroy();
        this._clocks.delete(child);
    }

    destroy() {
        const uiGroup = Main.layoutManager.uiGroup;
        for (const id of this._ids)
            uiGroup.disconnect(id);
        this._settings.disconnect(this._settingsId);
        for (const child of [...this._clocks.keys()])
            this._remove(child);
    }
}
