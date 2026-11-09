import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isActorValid} from './frames.js';

const DASH_TO_DOCK = 'dash-to-dock@micxgx.gmail.com';
const DASH_NAME = 'dashtodockDashContainer';
// How often the pointer is looked at while it is on a dock or a preview is up (ms).
const POLL_MS = 50;
// How long the pointer rests before a preview opens, moves to another app, or closes (ms).
const OPEN_MS = 250;
const SWITCH_MS = 80;
const CLOSE_MS = 300;

function dashOf(actor) {
    for (let a = actor; a; a = a.get_parent()) {
        if (a.get_name?.() === DASH_NAME)
            return a;
    }
    return null;
}

// The Dash to Dock app icon `actor` is in, or null.
function appIconOf(actor) {
    for (let a = actor; a; a = a.get_parent()) {
        if (a.get_name?.() === DASH_NAME)
            return null;
        if (a.app && typeof a.getInterestingWindows === 'function' && typeof a.shouldShowTooltip === 'function')
            return a;
    }
    return null;
}

function windowCount(icon) {
    try {
        return icon.getInterestingWindows().length;
    } catch {
        return 0;
    }
}

/**
 * Hovering an app on a Dash to Dock dock opens its window previews in place of its name. They are Dash to Dock's own
 * preview menu, opened without a grab or keyboard focus, so the pointer can move on along the dock and the focused
 * window keeps the keyboard. Being a popup menu, it grows out of the dock like the dock's other menus.
 */
export class Previews {
    constructor(settings) {
        this._settings = settings;
        this._menuClass = null;
        this._menus = new Map();
        this._patched = new Set();
        this._open = null;
        this._pending = undefined;
        this._pendingSince = 0;
        this._suppressed = null;
        this._pollId = 0;
        this._destroyed = false;
        this._eventId = global.stage.connect('captured-event', (_stage, event) => this._onEvent(event));
        this._settingsId = settings.connect('changed::dock-previews', () => {
            if (!this._enabled)
                this._close();
        });
        this._loadMenuClass();
    }

    get _enabled() {
        return this._menuClass !== null && this._settings.get_boolean('dock-previews');
    }

    // Dash to Dock's preview menu, from the very module it runs, which keeps its settings and dock position.
    async _loadMenuClass() {
        const path = Main.extensionManager.lookup(DASH_TO_DOCK)?.path;
        if (!path)
            return;
        try {
            const uri = GLib.filename_to_uri(GLib.build_filenamev([path, 'windowPreview.js']), null);
            const module = await import(uri);
            if (!this._destroyed)
                this._menuClass = module.WindowPreviewMenu ?? null;
        } catch (e) {
            logError(e, '[Simple GNOME Shell] Dash to Dock\'s window previews could not be loaded');
        }
    }

    _onEvent(event) {
        if (!this._enabled)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        if (type !== Clutter.EventType.MOTION && type !== Clutter.EventType.ENTER &&
            type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;
        const actor = global.stage.get_event_actor(event);
        const dash = dashOf(actor);
        if (!dash && !this._open)
            return Clutter.EVENT_PROPAGATE;
        const icon = dash ? appIconOf(actor) : null;
        if (icon)
            this._patchTooltip(icon);
        // A click on an app does what Dash to Dock does with it, and its preview stays away until the pointer leaves.
        if (icon && (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN)) {
            this._suppressed = icon;
            this._close();
        }
        this._startPolling();
        return Clutter.EVENT_PROPAGATE;
    }

    // The app's name gives way to its previews while it has windows.
    _patchTooltip(icon) {
        if (this._patched.has(icon))
            return;
        this._patched.add(icon);
        const previews = this;
        icon.shouldShowTooltip = function () {
            const show = Object.getPrototypeOf(this).shouldShowTooltip.call(this);
            return show && !(previews._enabled && previews._suppressed !== this && windowCount(this) > 0);
        };
        icon.connectObject('destroy', () => this._patched.delete(icon), this);
    }

    _unpatchTooltips() {
        for (const icon of this._patched) {
            if (!isActorValid(icon))
                continue;
            delete icon.shouldShowTooltip;
            icon.disconnectObject(this);
        }
        this._patched.clear();
    }

    _startPolling() {
        if (this._pollId)
            return;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            if (this._poll())
                return GLib.SOURCE_CONTINUE;
            this._pollId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    // Decides which app's previews should be up for where the pointer is, and changes to it once the pointer has
    // rested there long enough. True while it should keep looking.
    _poll() {
        if (!this._enabled) {
            this._close();
            return false;
        }
        const [x, y] = global.get_pointer();
        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        const dash = dashOf(actor);
        const icon = dash ? appIconOf(actor) : null;
        if (this._suppressed && icon !== this._suppressed)
            this._suppressed = null;
        const openMenu = this._open ? this._menus.get(this._open) : null;
        const inMenu = openMenu && isActorValid(openMenu.actor) && openMenu.actor.contains(actor);

        let target = null;
        // Another menu, the overview or a dialog has the screen: the previews stay out of their way.
        const free = Main.modalCount === 0;
        if (free && icon && icon !== this._suppressed && icon.mapped && windowCount(icon) > 0)
            target = icon;
        else if (free && this._open && (inMenu || (dash && !icon) || icon === this._open))
            target = this._open;

        const now = GLib.get_monotonic_time();
        if (target === this._open) {
            this._pending = undefined;
        } else if (target !== this._pending) {
            this._pending = target;
            this._pendingSince = now;
        } else {
            const delay = !target ? CLOSE_MS : this._open ? SWITCH_MS : OPEN_MS;
            if ((now - this._pendingSince) / 1000 >= delay) {
                this._pending = undefined;
                if (target)
                    this._show(target);
                else
                    this._close();
            }
        }
        return Boolean(dash || this._open || this._pending !== undefined);
    }

    _menuFor(icon) {
        let menu = this._menus.get(icon);
        if (menu && isActorValid(menu.actor))
            return menu;
        menu = new this._menuClass(icon);
        // Nothing to hold on to: no grab is taken.
        menu.blockSourceEvents = false;
        menu.connect('open-state-changed', (_menu, open) => {
            if (!open && this._open === icon)
                this._closed(icon);
        });
        menu.connect('destroy', () => {
            if (this._menus.get(icon) === menu)
                this._menus.delete(icon);
            if (this._open === icon)
                this._closed(icon);
        });
        this._menus.set(icon, menu);
        return menu;
    }

    _show(icon) {
        this._close();
        let menu;
        try {
            menu = this._menuFor(icon);
            // What WindowPreviewMenu.popup() does, short of taking the keyboard focus.
            menu._redisplay();
            this._open = icon;
            // Keeps a dock that hides by itself shown, and the app's name hidden, as for its other menus.
            icon.emit('menu-state-changed', true);
            menu.open(BoxPointer.PopupAnimation.FULL);
        } catch (e) {
            this._open = null;
            logError(e, '[Simple GNOME Shell] window previews failed');
        }
    }

    _close() {
        const icon = this._open;
        if (!icon)
            return;
        const menu = this._menus.get(icon);
        this._closed(icon);
        if (menu?.isOpen)
            menu.close(BoxPointer.PopupAnimation.FULL);
    }

    _closed(icon) {
        if (this._open !== icon)
            return;
        this._open = null;
        if (isActorValid(icon))
            icon.emit('menu-state-changed', false);
    }

    destroy() {
        this._destroyed = true;
        global.stage.disconnect(this._eventId);
        this._settings.disconnect(this._settingsId);
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
        this._close();
        for (const menu of this._menus.values())
            menu.destroy();
        this._menus.clear();
        this._unpatchTooltips();
    }
}
