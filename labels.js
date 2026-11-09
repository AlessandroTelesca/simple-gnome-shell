import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {isActorValid} from './frames.js';
import {BarGrowth, animationsEnabled} from './growth.js';

const TRANSPARENT = 'simple-gnome-shell-transparent';
const DASH_NAME = 'dashtodockDashContainer';

// How often a dock is looked over again for items it added, while the pointer is on it (ms).
const RESCAN_MS = 1000;

function dashOf(actor) {
    for (let a = actor; a; a = a.get_parent()) {
        if (a.get_name?.() === DASH_NAME)
            return a;
    }
    return null;
}

// Dash to Dock's item containers in `dash`: the actors that own a name label.
function dockItems(dash) {
    const items = [];
    const walk = actor => {
        if (actor.label instanceof St.Label && typeof actor.showLabel === 'function' &&
            typeof actor.hideLabel === 'function') {
            items.push(actor);
            return;
        }
        for (const child of actor.get_children())
            walk(child);
    };
    walk(dash);
    return items;
}

function actorRect(actor) {
    if (!isActorValid(actor) || !actor.mapped)
        return null;
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(w >= 1) || !(h >= 1))
        return null;
    return [x, y, w, h];
}

/** The name label of one dock item, which grows out of the dock in place of Dash to Dock's fade. */
class LabelGrowth {
    constructor(settings, frames, item) {
        this._item = item;
        this._label = item.label;
        this._showing = false;
        this._drawn = false;
        this._growth = new BarGrowth({
            key: 'menus',
            content: () => isActorValid(this._label) ? this._label : null,
            shown: () => isActorValid(this._label) && this._label.mapped,
            scale: () => 1,
            source: () => this._source(),
            button: () => actorRect(this._source()),
            radius: () => settings.get_double('surface-radius'),
            // The growth fades the label in and out itself.
            hold: () => this._label.remove_transition('opacity'),
            closed: () => {
                this._setDrawn(false);
                if (!this._showing && isActorValid(this._label))
                    this._label.hide();
            },
        });
        item.showLabel = () => this._show();
        item.hideLabel = () => this._hide();
        this._removeFrames = frames.add(() => this._sync());
    }

    _source() {
        const item = this._item;
        if (!isActorValid(item))
            return null;
        return isActorValid(item.child) && item.child.mapped ? item.child : item;
    }

    _show() {
        // Dash to Dock places the label and starts its fade, which the growth then takes over.
        Object.getPrototypeOf(this._item).showLabel.call(this._item);
        this._showing = true;
        if (!isActorValid(this._label) || !this._label.visible || !animationsEnabled())
            return;
        this._setDrawn(this._growth.start(true));
    }

    _hide() {
        this._showing = false;
        if (this._growth.holding && animationsEnabled() && isActorValid(this._label)) {
            this._label.remove_all_transitions();
            if (this._growth.start(false))
                return;
        }
        this._growth.release();
        this._setDrawn(false);
        if (isActorValid(this._label))
            Object.getPrototypeOf(this._item).hideLabel.call(this._item);
    }

    // At rest, the shape follows the label and the dock, and lets the label go when the dock goes.
    _sync() {
        if (!this._showing || this._growth.animating || !isActorValid(this._label) || !this._label.mapped)
            return;
        this._setDrawn(this._growth.holdAtRest());
    }

    // Whether the dock draws the label's background, rather than the theme.
    _setDrawn(drawn) {
        if (drawn === this._drawn || !isActorValid(this._label))
            return;
        this._drawn = drawn;
        if (drawn)
            this._label.add_style_class_name(TRANSPARENT);
        else
            this._label.remove_style_class_name(TRANSPARENT);
    }

    destroy() {
        this._removeFrames();
        this._growth.release();
        this._setDrawn(false);
        if (isActorValid(this._item)) {
            delete this._item.showLabel;
            delete this._item.hideLabel;
        }
        if (!this._showing && isActorValid(this._label))
            this._label.hide();
    }
}

/**
 * Makes the name labels of the docks' apps grow out of the dock, as the dock's menus do. A dock's items are hooked as
 * the pointer comes onto it: moving from one app to the next, Dash to Dock shows the next name at once.
 */
export class Labels {
    constructor(settings, frames) {
        this._settings = settings;
        this._frames = frames;
        this._items = new Map();
        this._scanned = new WeakMap();
        this._eventId = global.stage.connect('captured-event', (_stage, event) => {
            const type = event.type();
            if (type === Clutter.EventType.MOTION || type === Clutter.EventType.ENTER)
                this._scan(dashOf(global.stage.get_event_actor(event)));
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _scan(dash) {
        if (!dash)
            return;
        const now = GLib.get_monotonic_time();
        if (now - (this._scanned.get(dash) ?? -Infinity) < RESCAN_MS * 1000)
            return;
        this._scanned.set(dash, now);
        for (const item of dockItems(dash))
            this._hook(item);
    }

    _hook(item) {
        if (!item || this._items.has(item))
            return;
        const growth = new LabelGrowth(this._settings, this._frames, item);
        const destroyId = item.connect('destroy', () => {
            this._items.delete(item);
            growth.destroy();
        });
        this._items.set(item, {growth, destroyId});
    }

    destroy() {
        global.stage.disconnect(this._eventId);
        for (const [item, {growth, destroyId}] of this._items) {
            item.disconnect(destroyId);
            growth.destroy();
        }
        this._items.clear();
    }
}
