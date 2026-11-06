import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {EdgeBar} from './bar.js';
import {isActorValid} from './frames.js';
import {pinToEdge} from './layout.js';

const TRANSPARENT = 'simple-gnome-shell-transparent';
const SIDES = ['top', 'bottom', 'left', 'right'];
// Dash to Dock can rebuild a dock's actors a little after adding its container.
const RESCAN_MS = 1000;

function findDash(actor) {
    if (actor.get_name() === 'dashtodockDashContainer')
        return actor;
    for (const child of actor.get_children()) {
        const found = findDash(child);
        if (found)
            return found;
    }
    return null;
}

/** The shape behind one of Dash to Dock's docks. */
class Dock extends EdgeBar {
    constructor(settings, frames, root, dash) {
        super(settings, 'dock-radius', 'dock-flare');
        this._root = root;
        this._dash = dash;
        dash.add_style_class_name(TRANSPARENT);
        this._ownStyle = dash.get_style();
        // Dash to Dock's background sits beside the dash's container, in the dash.
        this._backgrounds = (dash.get_parent()?.get_children() ?? []).filter(child =>
            child.has_style_class_name?.('dash-background'));
        this._appliedSide = null;
        this._removeFrames = frames.add(() => this._sync());
    }

    growsFrom(source, key) {
        return key === 'menus' && this.drawn && (this._side === 'top' || this._side === 'bottom') &&
            this._settings.get_boolean('dock-menus-grow') &&
            isActorValid(source) && source.mapped && isActorValid(this._dash) && this._dash.contains(source);
    }

    _sync() {
        const root = this._root, dash = this._dash;
        if (!isActorValid(root) || !isActorValid(dash))
            return;
        const source = this._backgrounds[0] ?? dash;
        // Dash to Dock colors this one with an inline style and resets it as its theme changes, so it is kept hidden.
        for (const background of this._backgrounds) {
            if (background.opacity !== 0)
                background.opacity = 0;
        }
        // Dash to Dock slides by relayout. This lays the stage out now, so the reads below see this frame's position.
        source.get_allocation_box();
        this.shape.stackBelow(root);
        const monitor = Main.layoutManager.monitors[root.monitorIndex ?? Main.layoutManager.primaryIndex];
        const side = SIDES.find(name => root.has_style_class_name(name));
        if (!monitor || !side || !dash.mapped) {
            this.setBody(monitor, side ?? 'bottom', null, 0);
            return;
        }
        if (side !== this._appliedSide) {
            this._appliedSide = side;
            const own = this._ownStyle?.trim().replace(/;$/, '');
            const margin = `margin-${side}: 0px;`;
            dash.set_style(own ? `${own}; ${margin}` : margin);
        }
        const [x, y] = source.get_transformed_position();
        const [w, h] = source.get_transformed_size();
        if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0))
            return;
        const body = pinToEdge([x - monitor.x, y - monitor.y, w, h], side, monitor.width, monitor.height);
        // Only a sliver of a hidden dock is left on the screen.
        const thickness = side === 'left' || side === 'right' ? body[2] : body[3];
        this.setBody(monitor, side, thickness > 1 ? body : null, root.opacity);
    }

    destroy() {
        this._removeFrames();
        super.destroy();
        if (isActorValid(this._dash)) {
            this._dash.remove_style_class_name(TRANSPARENT);
            this._dash.set_style(this._ownStyle);
        }
        // The background may go first when Dash to Dock tears a dock down.
        for (const background of this._backgrounds) {
            if (isActorValid(background))
                background.opacity = 255;
        }
    }
}

/** Keeps a shape behind every dock Dash to Dock has, which it rebuilds on settings and monitor changes. */
export class Docks {
    constructor(settings, frames) {
        this._settings = settings;
        this._frames = frames;
        this._docks = new Map();
        this._idleId = 0;
        this._timeoutId = 0;
        const uiGroup = Main.layoutManager.uiGroup;
        const schedule = () => this._schedule();
        const ids = ['child-added', 'child-removed'].map(signal => uiGroup.connect(signal, schedule));
        const settingsId = settings.connect('changed::dock-enabled', schedule);
        const extensionsId = Main.extensionManager.connect('extension-state-changed', schedule);
        this._disconnects = [
            () => ids.forEach(id => uiGroup.disconnect(id)),
            () => settings.disconnect(settingsId),
            () => Main.extensionManager.disconnect(extensionsId),
        ];
        this._scan();
    }

    _schedule() {
        if (!this._idleId) {
            this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idleId = 0;
                this._scan();
                return GLib.SOURCE_REMOVE;
            });
        }
        if (this._timeoutId)
            return;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESCAN_MS, () => {
            this._timeoutId = 0;
            this._scan();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scan() {
        const wanted = new Map();
        if (this._settings.get_boolean('dock-enabled')) {
            for (const child of Main.layoutManager.uiGroup.get_children()) {
                if (child.get_name() !== 'dashtodockContainer')
                    continue;
                const dash = findDash(child);
                if (dash)
                    wanted.set(dash, child);
            }
        }
        for (const [dash, entry] of [...this._docks]) {
            if (!wanted.has(dash))
                this._release(dash, entry);
        }
        for (const [dash, root] of wanted) {
            if (this._docks.has(dash))
                continue;
            const entry = {dock: new Dock(this._settings, this._frames, root, dash), destroyId: 0};
            entry.destroyId = dash.connect('destroy', () => {
                entry.destroyId = 0;
                this._release(dash, entry);
            });
            this._docks.set(dash, entry);
        }
    }

    _release(dash, entry) {
        this._docks.delete(dash);
        if (entry.destroyId)
            dash.disconnect(entry.destroyId);
        entry.dock.destroy();
    }

    destroy() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._idleId = this._timeoutId = 0;
        for (const disconnect of this._disconnects)
            disconnect();
        this._disconnects = [];
        for (const [dash, entry] of [...this._docks])
            this._release(dash, entry);
    }
}
